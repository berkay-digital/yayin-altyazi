import { and, eq, gte, sql } from "drizzle-orm"
import { db, schema } from "./db"
import { getSubscription } from "./billing"
import { publish } from "./hub"
import { planInfo } from "./plan"
import { hostedTarget, translateLine, TranslateError, type ChatTarget, type LineKind, type TranslateResult } from "./translate"
import { similarity } from "@/engine/text"

const similarText = (a: string, b: string) => similarity(a, b) >= 0.7
const fold = (s: string) => s.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/[̀-ͯ]/g, "")
/** OCR of a Turkish line we just delivered (the capture includes the overlay), not game text. */
const isOwnText = (en: string, recentTr: string[]) => recentTr.some((tr) => similarity(fold(en), fold(tr)) >= 0.6)
import { countWords, LINES_PER_MINUTE, parseSettings, type Entitlement, type OverlaySettings } from "@/shared/settings"
import { noteLine, noteLineError } from "./live-status"
import { count, peek } from "./rate-limit"

type Profile = typeof schema.profile.$inferSelect

export async function profileByOverlayToken(token: string): Promise<Profile | null> {
  const [p] = await db.select().from(schema.profile).where(eq(schema.profile.overlayToken, token))
  return p ?? null
}

export async function profileByUser(userId: string): Promise<Profile | null> {
  const [p] = await db.select().from(schema.profile).where(eq(schema.profile.userId, userId))
  return p ?? null
}

function today() {
  return new Date().toISOString().slice(0, 10)
}

async function minutesThisMonth(userId: string) {
  const start = today().slice(0, 8) + "01"
  const [row] = await db
    .select({ m: sql<number>`coalesce(sum(${schema.usageDay.activeMinutes}), 0)` })
    .from(schema.usageDay)
    .where(and(eq(schema.usageDay.userId, userId), gte(schema.usageDay.day, start)))
  return Number(row?.m ?? 0)
}

/**
 * Without billing every account is open. With billing, usage is metered in active minutes (minutes with
 * at least one delivered line): the trial has trialMinutes, the paid plan is unlimited up to
 * fairUseMinutes a month.
 */
export async function entitlementFor(profile: Profile): Promise<Entitlement> {
  const plan = planInfo()
  if (!plan.billing) return { active: true, plan: "open", trialMinutesLeft: 0 }
  const sub = await getSubscription(profile.userId)
  const trialMinutesLeft = Math.max(0, plan.trialMinutes - profile.trialMinutesUsed)
  if (sub?.live) {
    const used = await minutesThisMonth(profile.userId)
    const ok = used < plan.fairUseMinutes
    return { active: ok, plan: "paid", trialMinutesLeft, monthMinutesUsed: used, reason: ok ? undefined : "fair_use" }
  }
  if (trialMinutesLeft > 0) return { active: true, plan: "trial", trialMinutesLeft }
  return { active: false, plan: null, trialMinutesLeft: 0, reason: "trial_over" }
}

/** The model to call, or why the overlay can't translate right now. */
export function pickTarget(ent: Entitlement): { target: ChatTarget } | { error: Entitlement["reason"] | "not_configured" } {
  if (!ent.active) return { error: ent.reason ?? "trial_over" }
  const target = hostedTarget()
  return target ? { target } : { error: "not_configured" }
}

type Recent = { en: string; tr: string; at: number }[]
type Gate = { at: number; profile: Profile; settings: OverlaySettings; ent: Entitlement }
const g = globalThis as unknown as {
  __recent?: Map<string, Recent>
  __beats?: Map<string, { at: number; ai: boolean }>
  __gates?: Map<string, Gate>
  __meters?: Map<string, { minute: number; lines: number }>
}
const recent = (g.__recent ??= new Map())
const beats = (g.__beats ??= new Map())
const gates = (g.__gates ??= new Map())
const meters = (g.__meters ??= new Map())

/**
 * Counts a delivered line toward the account's active minutes. Returns true when it opens a new billable
 * minute: the first line of a clock minute, or one past LINES_PER_MINUTE in the same minute.
 */
function meterLine(userId: string, now: number): boolean {
  const minute = Math.floor(now / 60_000)
  const m = meters.get(userId)
  if (m && m.minute === minute && m.lines < LINES_PER_MINUTE) {
    m.lines++
    return false
  }
  meters.set(userId, { minute, lines: 1 })
  return true
}
const gl = globalThis as unknown as { __lastObjective?: Map<string, string> }
const lastObjective = (gl.__lastObjective ??= new Map())

/** Conversation context sent with each line: the last few lines, from the current scene only. */
const CONTEXT_LINES = 8
const CONTEXT_MS = 120_000

/**
 * Profile, settings and plan check for a line, reused for a few seconds. Lines arrive every second or
 * two while a scene plays, and these three lookups don't change that fast; dashboard edits still apply
 * within GATE_MS, and the trial counter is checked again at least that often.
 */
const GATE_MS = 5_000
async function gateFor(token: string): Promise<Gate | null> {
  const hit = gates.get(token)
  if (hit && Date.now() - hit.at < GATE_MS) return hit
  const profile = await profileByOverlayToken(token)
  if (!profile) {
    gates.delete(token)
    return null
  }
  const gate = { at: Date.now(), profile, settings: parseSettings(profile.settings), ent: await entitlementFor(profile) }
  gates.set(token, gate)
  return gate
}

async function bumpUsage(
  userId: string,
  patch: Partial<Record<"minutes" | "aiMinutes" | "activeMinutes" | "lines" | "words" | "cacheHits" | "tokensIn" | "tokensOut", number>>,
) {
  const u = schema.usageDay
  const values = {
    userId,
    day: today(),
    minutes: 0,
    aiMinutes: 0,
    activeMinutes: 0,
    lines: 0,
    words: 0,
    cacheHits: 0,
    tokensIn: 0,
    tokensOut: 0,
    ...patch,
  }
  const set: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    const col = u[k as keyof typeof patch]
    set[k] = sql`${col} + ${v}`
  }
  await db.insert(u).values(values).onConflictDoUpdate({ target: [u.userId, u.day], set })
}

/**
 * Early reads. The overlay sends a line as soon as OCR first reads it, marked provisional, and again once
 * the reader has confirmed it on the next frames. The provisional call starts the translation without
 * billing, context or display; the confirming call picks up that same (often still running) translation,
 * so the confirmation wait overlaps with the model call. Reads that are never confirmed (fade transitions)
 * are never billed.
 */
const PENDING_MS = 15_000
type Pending = { at: number; job: Promise<TranslateResult>; done?: boolean }
const gp = globalThis as unknown as { __pending?: Map<string, Pending> }
const pending = (gp.__pending ??= new Map())

/**
 * Early reads aren't billed, so a script could call /line with provisional:true forever for free
 * translations. Real overlays confirm nearly all of theirs; a link whose early reads mostly expire
 * unconfirmed loses early reads for the hour (confirmed lines still work, just ~0.2 s slower).
 */
const UNCONFIRMED_PER_HOUR = 120

function sweepPending(now: number) {
  for (const [k, p] of pending) {
    if (now - p.at <= PENDING_MS) continue
    pending.delete(k)
    count(`unconfirmed:${k.split("|")[0]}`, 3_600_000)
  }
}

/** Charges a new active minute when this line opens one, and updates the cached plan state. */
async function chargeMinute(gate: Gate, now: number) {
  const { profile } = gate
  if (!meterLine(profile.userId, now)) return
  void bumpUsage(profile.userId, { activeMinutes: 1 }).catch(() => {})
  if (gate.ent.plan === "trial") {
    const { trialMinutes } = planInfo()
    const [row] = await db
      .update(schema.profile)
      .set({ trialMinutesUsed: sql`least(${trialMinutes}, ${schema.profile.trialMinutesUsed} + 1)` })
      .where(eq(schema.profile.userId, profile.userId))
      .returning({ used: schema.profile.trialMinutesUsed })
      .catch(() => [])
    const left = Math.max(0, trialMinutes - (row?.used ?? trialMinutes - gate.ent.trialMinutesLeft + 1))
    gate.ent = left > 0 ? { ...gate.ent, trialMinutesLeft: left } : { active: false, plan: null, trialMinutesLeft: 0, reason: "trial_over" }
  } else if (gate.ent.plan === "paid") {
    const { fairUseMinutes } = planInfo()
    const used = (gate.ent.monthMinutesUsed ?? 0) + 1
    gate.ent = used < fairUseMinutes ? { ...gate.ent, monthMinutesUsed: used } : { ...gate.ent, active: false, monthMinutesUsed: used, reason: "fair_use" }
  }
}

export async function handleLine(
  token: string,
  en: string,
  kind: LineKind = "dialogue",
  provisional = false,
) {
  const gate = await gateFor(token)
  if (!gate) return { status: 404, body: { error: "not_found" } }
  const { profile, settings, ent } = gate
  const picked = pickTarget(ent)
  if ("error" in picked) {
    if (!provisional) noteLineError(token, en, picked.error ?? "not_configured")
    return { status: 402, body: { error: picked.error, entitlement: ent } }
  }

  const now = Date.now()
  sweepPending(now)
  const prev: Recent = (recent.get(token) ?? []).filter((p: Recent[number]) => now - p.at < CONTEXT_MS).slice(-CONTEXT_LINES)
  const delivered = [...prev.map((p) => p.tr), ...(lastObjective.get(token) ? [lastObjective.get(token)!] : [])]
  if (isOwnText(en, delivered)) return { status: 200, body: { tr: "", own: true } }
  const pendingKey = `${token}|${kind}|${en}`
  const start = () => translateLine({ game: settings.game, en, kind, previous: prev, target: picked.target })
  try {
    if (provisional) {
      // The reply carries no text: the overlay only uses early reads to start the work, and returning
      // the translation would turn this unbilled path into a free translation API.
      if (pending.has(pendingKey)) return { status: 202, body: { provisional: true } }
      // Early reads still being translated for this link (finished ones wait for their confirmation).
      const inFlight = [...pending].filter(([k, p]) => k.startsWith(`${token}|`) && !p.done).length
      if (inFlight >= 3 || peek(`unconfirmed:${token}`, 3_600_000) >= UNCONFIRMED_PER_HOUR) {
        return { status: 202, body: { provisional: true, skipped: true } }
      }
      const job = start()
      const entry: Pending = { at: now, job }
      job.then(
        () => (entry.done = true),
        () => pending.delete(pendingKey),
      )
      pending.set(pendingKey, entry)
      return { status: 202, body: { provisional: true } }
    }
    const early = pending.get(pendingKey)
    pending.delete(pendingKey)
    const r = await (early?.job ?? start())
    if (r.tr) {
      await chargeMinute(gate, Date.now())
      // Objectives aren't part of the conversation, so they stay out of the dialogue context.
      if (kind === "dialogue") {
        // A re-read of the line just sent (better OCR of the same card) replaces it instead of piling up.
        const last = prev.at(-1)
        const base = last && now - last.at < 4_000 && similarText(last.en, en) ? prev.slice(0, -1) : prev
        recent.set(token, [...base, { en, tr: r.tr, at: Date.now() }].slice(-CONTEXT_LINES))
      }
      if (kind === "objective") lastObjective.set(token, r.tr)
      publish(profile.viewToken, { type: kind === "objective" ? "objective" : "line", en, tr: r.tr, at: Date.now() })
    }
    noteLine(token, { en, tr: r.tr, ms: r.ms, cached: r.cached })
    beats.set(token, { at: beats.get(token)?.at ?? 0, ai: true })
    void bumpUsage(profile.userId, {
      lines: 1,
      words: r.tr ? countWords(en) : 0,
      cacheHits: r.cached ? 1 : 0,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
    }).catch(() => {})
    return { status: 200, body: { tr: r.tr, cached: r.cached, source: r.source, ms: r.ms } }
  } catch (err) {
    // A failed early read is reported when (if) the line is confirmed.
    if (provisional) return { status: 502, body: { error: "upstream", provisional: true } }
    if (err instanceof TranslateError) {
      const reason = err.status === 429 ? "rate_limited" : "upstream"
      console.warn(`[line] translate failed: ${err.status} ${err.body.slice(0, 160)}`)
      noteLineError(token, en, reason)
      return { status: 502, body: { error: reason } }
    }
    console.warn("[line] translate failed:", err)
    noteLineError(token, en, "upstream")
    return { status: 502, body: { error: "upstream" } }
  }
}

export async function handleClear(token: string) {
  const profile = await profileByOverlayToken(token)
  if (!profile) return
  publish(profile.viewToken, { type: "clear", at: Date.now() })
}

/** Called about once a minute while the overlay is open. Records overlay minutes for stats only. */
export async function handleBeat(token: string) {
  const profile = await profileByOverlayToken(token)
  if (!profile) return { status: 404, body: { error: "not_found" } }
  const now = Date.now()
  const b = beats.get(token)
  if (!b || now - b.at >= 55_000) {
    beats.set(token, { at: now, ai: b?.ai ?? false })
    await bumpUsage(profile.userId, { minutes: 1, aiMinutes: b?.ai ? 1 : 0 })
  }
  const ent = await entitlementFor(profile)
  return { status: 200, body: { entitlement: ent } }
}
