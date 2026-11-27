/**
 * Pre-fills the shared translation cache from scripts/prefill/lines.jsonl.
 *
 * Each line goes through the live path itself, translateLine() in src/server/translate.ts with source
 * "ai" and the hosted target: same cache lookup and key, same prompt, context and sanitizer (llm.ts),
 * and the same cache write. Dialogue is translated in play order with the context the server would have
 * sent (the line's `prev`, with the Turkish this run or the cache already has for those lines), so the
 * work runs as independent chains (a video's lines split wherever 120 s pass without a line), several
 * chains at a time. Lines the live path never caches (a sentence continued from the previous card) are
 * still translated, because later lines need them as context; they cost tokens but write nothing.
 *
 * Budget: cost is counted from the usage tokens each reply returns, at Haiku 5.5 prices ($0.10/M input,
 * $0.50/M output, prompts under 100K tokens). Before a call starts, its worst case (estimated prompt plus
 * the 200-token reply cap) is reserved, so the total never passes --budget-usd, which covers this run and
 * every earlier run recorded in the state file.
 *
 * Resume: every finished line is appended to the state file (default scripts/prefill/state.local, git
 * ignored); a rerun skips those lines and reuses their Turkish as context.
 *
 * Keys and DATABASE_URL come only from the environment and are never printed. Like the server, importing
 * the database module applies pending migrations from ./drizzle to that database.
 *
 * Usage:
 *   pnpm dlx tsx scripts/prefill/translate.mts --dry-run
 *   DATABASE_URL=... ANTHROPIC_API_KEY_PRIMARY=... pnpm dlx tsx scripts/prefill/translate.mts [--budget-usd 20]
 * Flags: --lines <file> --state <file> --budget-usd <n> --concurrency <n> --limit <n> --allow-local
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

type Kind = "dialogue" | "objective"
type Line = { kind: Kind; en: string; prev: string[]; video: string; t: number }
type Done = { id: string; kind: Kind; en: string; tr: string; tokensIn: number; tokensOut: number; cached: boolean; cacheable: boolean }

const GAME = "gta6" as const
// Claude Haiku 5.5 list prices for prompts up to 100K tokens. Update them if Anthropic's pricing changes.
const PRICED_MODEL = "claude-haiku-5-5"
const USD_PER_IN = 0.1 / 1e6
const USD_PER_OUT = 0.5 / 1e6
/** max_tokens of the live call (claudeTranslate in llm.ts). */
const MAX_OUT = 200
/** Conservative prompt size estimate (English-heavy prompt, Turkish context): characters per token. */
const CHARS_PER_TOKEN = 3

const args = process.argv.slice(2)
const opt = (name: string, def: string) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def
}
const has = (name: string) => args.includes(name)
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const LINES = opt("--lines", here("./lines.jsonl"))
const STATE = opt("--state", here("./state.local"))
const BUDGET = Number(opt("--budget-usd", "20"))
const CONCURRENCY = Math.max(1, Number(opt("--concurrency", "4")))
const LIMIT = Number(opt("--limit", "0"))
const DRY = has("--dry-run")

if (!Number.isFinite(BUDGET) || BUDGET <= 0) throw new Error("--budget-usd must be a positive number")
if (!DRY && !process.env.DATABASE_URL && !has("--allow-local")) {
  throw new Error("DATABASE_URL is not set. Pass --allow-local to write into the local PGlite database instead.")
}
// A dry run without a database must not create or migrate the local dev database.
if (DRY && !process.env.DATABASE_URL) process.env.PGLITE_DIR = mkdtempSync(`${tmpdir()}/prefill-dry-`)

const { isContinuation, normalizeKey, translateLine, hostedTarget } = await import("../../src/server/translate.ts")
const { SYSTEM } = await import("../../src/server/llm.ts")
const { db, dbReady, schema } = await import("../../src/server/db/index.ts")
const { eq } = await import("drizzle-orm")

const id = (kind: Kind, en: string) => `${kind}|${normalizeKey(en)}`
const cacheKey = (kind: Kind, en: string) => (kind === "objective" ? `${GAME}:obj:${normalizeKey(en)}` : `${GAME}:${normalizeKey(en)}`)
const usd = (tin: number, tout: number) => tin * USD_PER_IN + tout * USD_PER_OUT

// ---- Inputs and state -------------------------------------------------------------------------------
let lines: Line[] = readFileSync(LINES, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Line)
// On small-font captures the engine files some dialogue as an objective ("Hey, you ready to go?").
// The objective prompt would turn those into commands, so they aren't pre-filled; live play still reads them.
// Real objectives are short commands with no final period ("Drive to the marina").
const looksLikeDialogue = (en: string) =>
  /^[a-z]/.test(en) ||
  /[?!,.@]$|[?!,@]/.test(en) ||
  en.trim().split(/\s+/).length < 2 ||
  /\b(?:I|I'm|I'll|me|my|you|you're|your|we|we're|us|they|they'll|he|she|it's)\b/i.test(en)
lines = lines.filter((l) => l.kind !== "objective" || !looksLikeDialogue(l.en))
if (LIMIT > 0) lines = lines.slice(0, LIMIT)

const done = new Map<string, Done>()
if (existsSync(STATE)) {
  for (const l of readFileSync(STATE, "utf8").split("\n").filter(Boolean)) {
    const d = JSON.parse(l) as Done
    done.set(d.id, d)
  }
}
let spentBefore = 0
for (const d of done.values()) spentBefore += usd(d.tokensIn, d.tokensOut)

/** Turkish known for a line (this run, earlier runs, or the cache), for use as context. */
const trById = new Map<string, string>()
for (const d of done.values()) if (d.tr) trById.set(d.id, d.tr)

const useDb = !DRY || Boolean(process.env.DATABASE_URL)
const cached = new Set<string>()
if (useDb) {
  await dbReady
  const rows = await db
    .select({ key: schema.translation.key, tr: schema.translation.tr })
    .from(schema.translation)
    .where(eq(schema.translation.game, GAME))
  const byKey = new Map(rows.map((r) => [r.key, r.tr]))
  for (const l of lines) {
    const tr = byKey.get(cacheKey(l.kind, l.en))
    if (tr === undefined) continue
    cached.add(id(l.kind, l.en))
    if (!trById.has(id(l.kind, l.en))) trById.set(id(l.kind, l.en), tr)
  }
  // Context lines that were deduplicated away still have their row in the cache.
  for (const l of lines) {
    for (const p of l.prev) {
      const tr = byKey.get(cacheKey("dialogue", p))
      if (tr !== undefined && !trById.has(id("dialogue", p))) trById.set(id("dialogue", p), tr)
    }
  }
}

const todo = lines.filter((l) => !done.has(id(l.kind, l.en)) && !cached.has(id(l.kind, l.en)))
const isCacheable = (l: Line) => l.kind === "objective" || !isContinuation(l.en, l.prev.at(-1))

/** Context as the server builds it: earlier dialogue with known Turkish (the server keeps only delivered lines). */
function contextFor(l: Line): { en: string; tr: string }[] {
  if (l.kind !== "dialogue") return []
  return l.prev.flatMap((en) => {
    const tr = trById.get(id("dialogue", en))
    return tr ? [{ en, tr }] : []
  })
}

/** Prompt the live call sends, for the worst-case estimate (Turkish of context lines guessed when unknown). */
function estimateIn(l: Line): number {
  const ctx = l.kind === "dialogue" ? l.prev.map((en) => `EN: ${en}\nTR: ${trById.get(id("dialogue", en)) ?? en + "xxxxx"}`).join("\n") : ""
  const user = `${ctx ? `<previous>\n${ctx}\n</previous>\n\n` : ""}<line>${l.en}</line>`
  return Math.ceil((SYSTEM(GAME, l.kind).length + user.length) / CHARS_PER_TOKEN) + 10
}
/** Expected (not worst-case) reply size: Turkish runs about 2.5 characters a token. */
const estimateOut = (l: Line) => Math.ceil((l.en.length * 1.1) / 2.5) + 2

// ---- Report -----------------------------------------------------------------------------------------
const cacheableTodo = todo.filter(isCacheable).length
let estIn = 0
let estOut = 0
for (const l of todo) {
  estIn += estimateIn(l)
  estOut += estimateOut(l)
}
console.log(
  [
    `lines ${lines.length} (dialogue ${lines.filter((l) => l.kind === "dialogue").length}, objective ${lines.filter((l) => l.kind === "objective").length})`,
    `already done ${done.size}, already in cache ${useDb ? cached.size : "not checked (no DATABASE_URL)"}`,
    `to translate ${todo.length}: ${cacheableTodo} will be cached, ${todo.length - cacheableTodo} are continuations (context only)`,
    `estimate: ~${(estIn / 1e6).toFixed(2)}M input + ~${(estOut / 1e6).toFixed(3)}M output tokens = ~$${usd(estIn, estOut).toFixed(3)}`,
    `budget $${BUDGET.toFixed(4)}, spent in earlier runs $${spentBefore.toFixed(4)}`,
  ].join("\n"),
)
if (DRY) process.exit(0)

const hosted = hostedTarget()
if (!hosted || hosted.provider !== "claude") throw new Error("No Claude key in the environment (ANTHROPIC_API_KEY_PRIMARY / ANTHROPIC_API_KEY).")
if (hosted.model !== PRICED_MODEL) throw new Error(`Model is ${hosted.model}; the budget is priced for ${PRICED_MODEL}. Unset CLAUDE_MODEL.`)
const target = hosted

// ---- Run --------------------------------------------------------------------------------------------
/** Chains of lines that share context: one video, no gap over 120 s. */
const chains: Line[][] = []
for (const l of todo) {
  const last = chains.at(-1)?.at(-1)
  if (last && last.video === l.video && l.t - last.t <= 120) chains.at(-1)!.push(l)
  else chains.push([l])
}

let spent = spentBefore
let reserved = 0
let stopped = ""
let finished = 0
let failures = 0
let consecutiveFailures = 0
const written: Line[] = []
const started = Date.now()

async function translateOne(l: Line): Promise<void> {
  const worst = usd(estimateIn(l), MAX_OUT)
  if (spent + reserved + worst > BUDGET) {
    stopped ||= `budget: $${spent.toFixed(4)} spent, next line could cost up to $${worst.toFixed(5)}`
    return
  }
  reserved += worst
  const cacheable = isCacheable(l)
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await translateLine({ game: GAME, en: l.en, kind: l.kind, previous: contextFor(l), target })
        spent += usd(r.tokensIn, r.tokensOut)
        const d: Done = { id: id(l.kind, l.en), kind: l.kind, en: l.en, tr: r.tr, tokensIn: r.tokensIn, tokensOut: r.tokensOut, cached: r.cached, cacheable }
        done.set(d.id, d)
        if (r.tr) trById.set(d.id, r.tr)
        appendFileSync(STATE, JSON.stringify(d) + "\n")
        if (r.tr && cacheable && !r.cached) written.push(l)
        consecutiveFailures = 0
        return
      } catch (e) {
        const status = (e as { status?: number }).status
        if (attempt >= 3 || (status !== undefined && status < 500 && status !== 429)) throw e
        await new Promise((res) => setTimeout(res, 5000 * (attempt + 1)))
      }
    }
  } catch (e) {
    failures++
    consecutiveFailures++
    const status = (e as { status?: number }).status
    console.warn(`  failed (${status ?? "error"}): ${l.en.slice(0, 60)}`)
    if (consecutiveFailures >= 10) stopped ||= "10 failures in a row (keys out of credit or API down?)"
  } finally {
    reserved -= worst
    finished++
    if (finished % 100 === 0) {
      const mins = (Date.now() - started) / 60000
      console.log(`  ${finished}/${todo.length} lines, $${spent.toFixed(4)} spent, ${mins.toFixed(1)} min`)
    }
  }
}

const queue = [...chains]
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let chain = queue.shift(); chain && !stopped; chain = queue.shift()) {
      for (const l of chain) {
        if (stopped) break
        await translateOne(l)
      }
    }
  }),
)

// translateLine writes the cache row without waiting for it; make sure every row landed before exiting.
await new Promise((res) => setTimeout(res, 3000))
// Covers earlier runs too (a run that died before this step left rows unwritten).
let backfilled = 0
const have = new Set(
  (await db.select({ key: schema.translation.key }).from(schema.translation).where(eq(schema.translation.game, GAME))).map((r) => r.key),
)
for (const d of done.values()) {
  if (!d.cacheable || !d.tr) continue
  const key = cacheKey(d.kind, d.en)
  if (have.has(key)) continue
  await db.insert(schema.translation).values({ key, game: GAME, en: d.en, tr: d.tr, source: "ai", model: target.model }).onConflictDoNothing()
  have.add(key)
  backfilled++
}

console.log(
  [
    stopped ? `stopped early: ${stopped}` : "all lines processed",
    `translated ${finished - failures}, failed ${failures}, new cache rows ${written.length}${backfilled ? ` (${backfilled} written by the backfill)` : ""}`,
    `spent this run $${(spent - spentBefore).toFixed(4)}, total $${spent.toFixed(4)} of $${BUDGET.toFixed(4)}`,
  ].join("\n"),
)
process.exit(0)
