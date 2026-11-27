import { and, eq, like, notLike, sql } from "drizzle-orm"
import { db, schema } from "./db"
import { CLAUDE_MODEL, claudeRouter } from "./claude"
import { chatTranslate, type ChatTarget, type LineKind } from "./llm"
import { levenshtein } from "@/engine/text"
import type { GameId } from "@/shared/settings"

export { TranslateError, chatTranslate, type ChatTarget, type LineKind } from "./llm"

export type TranslateResult = {
  tr: string
  cached: boolean
  source: "ai" | "human" | "cache"
  tokensIn: number
  tokensOut: number
  ms: number
}

export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * A line that finishes a sentence started on the previous card ("but he drives like a bitch, so...")
 * only translates well with that previous card, so it is neither served from nor written to the shared
 * cache, where it could meet a different context.
 */
export function isContinuation(en: string, prevEn: string | undefined): boolean {
  if (/^[a-z]/.test(en.trim())) return true
  if (!prevEn) return false
  return /(?:,|\.\.\.|…|-|—)\s*["']?$/.test(prevEn.trim()) && !/^[A-Z][a-z]*[.!?]/.test(en.trim())
}

/* ---------- Near-miss cache lookups ----------
 * OCR rarely reads a line exactly the same way twice ("Add soc al links", "Add social links"). A missed
 * exact key falls back to the closest cached line, accepted only when the difference looks like OCR noise:
 * a letter or two in a long line, never a different number, negation or pronoun. */

const FUZZY_MIN_CHARS = 15
const FUZZY_MIN_WORDS = 4
const NEGATION = /^(?:not|no|never|nothing|nobody|none|cannot|nope|without|.*n't)$/
/** Short common words where one letter changes the meaning ("he"/"she", "his"/"her", "can"/"can't"). */
const MEANINGFUL = new Set(
  "he she he's she's him her his hers we they you i i'm me my your our their them us it its it's this that these those here there a an the to too can could will would was were is are now then yes did do does have has had go get got".split(
    " ",
  ),
)

/** OCR-confusable letters folded together, spaces dropped (split or merged words). */
const skeleton = (s: string) =>
  s.replace(/ /g, "").replace(/rn/g, "m").replace(/vv/g, "w").replace(/[il1|!]/g, "l").replace(/0/g, "o").replace(/5/g, "s")

export function closeEnough(a: string, b: string): boolean {
  if (a.replace(/\D/g, "") !== b.replace(/\D/g, "")) return false
  const ta = a.split(" ")
  const tb = b.split(" ")
  const neg = (t: string[]) => t.filter((w) => NEGATION.test(w)).join(" ")
  if (neg(ta) !== neg(tb)) return false
  const ka = skeleton(a)
  const kb = skeleton(b)
  // Only split/merged words and look-alike letters ("th is" for "this", "Llsten" for "Listen").
  if (ka === kb) return true
  // A real letter difference: never when it touches a short meaningful word ("he"/"she", "his"/"her").
  const sa = new Set(ta)
  const sb = new Set(tb)
  for (const w of [...ta.filter((w) => !sb.has(w)), ...tb.filter((w) => !sa.has(w))]) if (MEANINGFUL.has(w)) return false
  const len = Math.max(ka.length, kb.length)
  const allowed = len >= 40 ? 2 : len >= 18 ? 1 : 0
  return allowed > 0 && Math.abs(ka.length - kb.length) <= allowed && levenshtein(ka, kb) <= allowed
}

async function nearHit(game: GameId, kind: LineKind, norm: string, key: string) {
  if (norm.length < FUZZY_MIN_CHARS || norm.split(" ").length < FUZZY_MIN_WORDS) return null
  const t = schema.translation
  const prefix = kind === "objective" ? `${game}:obj:` : `${game}:`
  const rows = await db
    .select({ key: t.key, tr: t.tr })
    .from(t)
    .where(
      and(
        sql`${t.key} % ${key}`,
        like(t.key, `${prefix}%`),
        kind === "dialogue" ? notLike(t.key, `${game}:obj:%`) : undefined,
      ),
    )
    .orderBy(sql`similarity(${t.key}, ${key}) desc`)
    .limit(5)
  return rows.find((r) => closeEnough(norm, r.key.slice(prefix.length))) ?? null
}

const inflight = new Map<string, Promise<TranslateResult>>()

/** The configured model: Claude when a key is set, else an OpenAI-compatible endpoint (AI_BASE_URL). */
export function hostedTarget(): ChatTarget | null {
  if (claudeRouter()) return { provider: "claude", model: CLAUDE_MODEL }
  const { AI_BASE_URL, AI_API_KEY, AI_MODEL } = process.env
  if (!AI_BASE_URL || !AI_API_KEY || !AI_MODEL) return null
  let extraBody: Record<string, unknown> | undefined
  try {
    extraBody = process.env.AI_EXTRA_BODY ? JSON.parse(process.env.AI_EXTRA_BODY) : undefined
  } catch {
    extraBody = undefined
  }
  return { baseUrl: AI_BASE_URL, apiKey: AI_API_KEY, model: AI_MODEL, extraBody }
}

const bumpHits = (key: string) =>
  void db
    .update(schema.translation)
    .set({ hits: sql`${schema.translation.hits} + 1` })
    .where(eq(schema.translation.key, key))
    .catch(() => {})

/**
 * Cache first (shared across all streamers): the exact line, then a near miss from OCR noise. Otherwise
 * the model. Concurrent identical lines share one call.
 */
export function translateLine(opts: {
  game: GameId
  en: string
  kind: LineKind
  previous: { en: string; tr: string }[]
  target: ChatTarget
}): Promise<TranslateResult> {
  const norm = normalizeKey(opts.en)
  const key = opts.kind === "objective" ? `${opts.game}:obj:${norm}` : `${opts.game}:${norm}`
  const prevEn = opts.previous.at(-1)?.en
  const cacheable = opts.kind === "objective" || !isContinuation(opts.en, prevEn)
  const flightKey = cacheable ? key : `${key}|${prevEn ?? ""}`
  const existing = inflight.get(flightKey)
  if (existing) return existing.then((r) => ({ ...r, cached: true, tokensIn: 0, tokensOut: 0 }))

  const started = Date.now()
  const job = (async (): Promise<TranslateResult> => {
    const hit = (tr: string) => ({ tr, cached: true, source: "cache" as const, tokensIn: 0, tokensOut: 0, ms: Date.now() - started })
    if (cacheable) {
      const [exact] = await db.select({ tr: schema.translation.tr }).from(schema.translation).where(eq(schema.translation.key, key))
      if (exact) {
        bumpHits(key)
        return hit(exact.tr)
      }
      const near = await nearHit(opts.game, opts.kind, norm, key).catch(() => null)
      if (near) {
        bumpHits(near.key)
        // Remember this spelling too, so the next identical misread is an exact hit.
        void db
          .insert(schema.translation)
          .values({ key, game: opts.game, en: opts.en, tr: near.tr, source: "ai", model: `alias:${near.key}` })
          .onConflictDoNothing()
          .catch(() => {})
        return hit(near.tr)
      }
    }
    const out = await chatTranslate(opts.target, opts.game, opts.en, opts.previous, opts.kind)
    const tr = out.tr === "-" ? "" : out.tr
    if (tr && cacheable && norm.length >= 2) {
      // Don't hold the reply for the write.
      void db
        .insert(schema.translation)
        .values({ key, game: opts.game, en: opts.en, tr, source: "ai", model: opts.target.model })
        .onConflictDoNothing()
        .catch(() => {})
    }
    return { tr, cached: false, source: "ai", tokensIn: out.tokensIn, tokensOut: out.tokensOut, ms: Date.now() - started }
  })()
  inflight.set(flightKey, job)
  void job.then(
    () => inflight.delete(flightKey),
    () => inflight.delete(flightKey),
  )
  return job
}
