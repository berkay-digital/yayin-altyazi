import Anthropic from "@anthropic-ai/sdk"
import { claudeRouter } from "./claude"
import { GENERIC_CONTEXT, GTA6_CONTEXT } from "./glossary/gta6"
import type { GameId } from "@/shared/settings"

/** The Claude keys, or an OpenAI-compatible endpoint used when no Claude key is set (AI_BASE_URL). */
export type ChatTarget =
  | { provider?: "openai"; baseUrl: string; apiKey: string; model: string; extraBody?: Record<string, unknown> }
  | { provider: "claude"; model: string }

/** Dialogue subtitles, or the mission objective line games draw under them. */
export type LineKind = "dialogue" | "objective"

const COMMON_RULES = `- Reply with only the Turkish translation of the text inside the tags, on one line. No tags, quotes, labels, notes, explanations or English.
- The English was read off the screen by OCR, so letters can be missing or wrong ("Jeson" for "Jason", "wan: a" for "want a", "t-at" for "that"). Silently work out what was meant and translate that. Never mention OCR, errors, the input or yourself.
- If the line is too broken to understand at all, output exactly: -`

export const SYSTEM = (game: GameId, kind: LineKind = "dialogue") =>
  kind === "objective"
    ? `You translate on-screen mission objectives of a video game into Turkish for a Turkish livestream audience.
${game === "gta6" ? GTA6_CONTEXT : GENERIC_CONTEXT}

Rules:
- This is a short instruction to the player, not dialogue. Translate it as a short, plain Turkish instruction in the imperative ("Go with the prison guard" -> "Gardiyanla git", "Lose the cops" -> "Polisleri ek").
- A controller button icon in the line is read as a stray character ("Use - to aim at the teller", "Press 8 to threaten"). Leave the character out: "Use - to aim at the teller" -> "Veznedara nişan al", "Press 8 to threaten the teller" -> "Veznedarı tehdit etmek için tuşa bas".
${COMMON_RULES}`
    : `You translate live English video game subtitles into Turkish for a Turkish livestream audience.
${game === "gta6" ? GTA6_CONTEXT : GENERIC_CONTEXT}

Rules:
- Natural spoken Turkish as young Turkish gamers and streamers talk, not textbook Turkish. Match the speaker's tone.
- Keep swearing and insults at the same strength in natural Turkish equivalents. Do not soften or censor.
- Keep slang as slang (e.g. "bro" can become "kanka", "man" can be dropped or "lan" depending on tone).
- Keep it short enough to read in a subtitle. Same meaning, fewer words if possible.
- <previous> holds the conversation so far. Stay consistent with it: same names and nicknames, same "sen"/"siz", same tone. If the <line> continues a sentence from the previous line, continue it so the two read as one Turkish sentence.
- Translate only the <line>.
${COMMON_RULES}`

/**
 * A reply that talks about the input instead of translating it, or that is far longer than any
 * translation of it could be, is dropped rather than shown on stream.
 */
export function sanitizeTranslation(en: string, raw: string): string {
  let tr = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? ""
  tr = tr
    .replace(/<\/?(line|objective|previous)>/gi, "")
    .replace(/^(TR|Türkçe|Turkish)\s*:\s*/i, "")
    .replace(/^["“'«]+|["”'»]+$/g, "")
    .trim()
  // A stutter before the real text ("o o o o, o gün ...", "o o o giydiğim ..."). "o" is also a real word,
  // so a run ending in a comma is cut at the comma, otherwise only before a longer word.
  tr = tr
    .replace(/^(?:\p{L}\s+){2,}\p{L},\s*/u, "")
    .replace(/^(?:\p{L}\s+){3,}(?=\p{L}{2,})/u, "")
    // "o o gün ..." -> "o gün ...": the same one-letter word repeated at the start.
    .replace(/^(\p{L})(?:\s+\1)+(?=\s|$)/u, "$1")
    .trim()
  if (/^\p{L}?[.!?]?$/u.test(tr) && en.trim().split(/\s+/).length >= 2) return ""
  if (tr === "-" || !tr) return ""
  if (/\bOCR\b|\bhatal[ıi] (?:okuma|metin)|anlaml[ıi] bir (?:cümle|şey) değil|çevrilemez|translat|the (?:input|line|text)\b/i.test(tr)) return ""
  if (tr.length > en.length * 2.5 + 30) return ""
  if (COMMENTARY_START.test(tr)) return ""
  // Degenerate output ("o o o o i o"): mostly one-letter words.
  const words = tr.split(/\s+/).filter(Boolean)
  if (words.length >= 3 && words.filter((w) => w.replace(/[^\p{L}]/gu, "").length <= 1).length / words.length >= 0.6) return ""
  // The English echoed back (a line long enough that it can't be the same in both languages).
  if (en.length >= 12 && tr.toLowerCase().includes(en.toLowerCase())) return ""
  return tr
}

/** Replies that open by talking about the line or the task instead of translating it. */
const COMMENTARY_START =
  /^(?:Bu (?:metin|satır|cümle|ifade|girdi)|Verilen (?:metin|satır)|Üzgünüm|Maalesef|Çeviri:|Not:|Sorry|I |I'm |The |This |Here|Translation)/i

export async function chatTranslate(
  target: ChatTarget,
  game: GameId,
  en: string,
  previous: { en: string; tr: string }[],
  kind: LineKind = "dialogue",
): Promise<{ tr: string; tokensIn: number; tokensOut: number }> {
  // Tagged input, not an "EN: ... TR:" completion: with that format, a line starting lowercase (a sentence
  // continued from the previous card, or a first word lost to OCR) made Haiku stutter ("o o o o, o gün...").
  const context = kind === "dialogue" ? previous.map((p) => `EN: ${p.en}\nTR: ${p.tr}`).join("\n") : ""
  const tag = kind === "objective" ? "objective" : "line"
  const user = `${context ? `<previous>\n${context}\n</previous>\n\n` : ""}<${tag}>${en}</${tag}>`
  if (target.provider === "claude") {
    const out = await claudeTranslate(target.model, game, kind, user)
    return { ...out, tr: sanitizeTranslation(en, out.tr) }
  }
  // AI_BASE_URL comes from the server's own environment, so a local model (Ollama, LM Studio, vLLM) works too.
  const res = await fetch(`${target.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({
      ...target.extraBody,
      model: target.model,
      temperature: 0.3,
      max_tokens: 300,
      messages: [
        { role: "system", content: SYSTEM(game, kind) },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new TranslateError(res.status, body.slice(0, 300))
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const tr = sanitizeTranslation(en, data.choices?.[0]?.message?.content ?? "")
  return { tr, tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0 }
}

/** Hosted translation on Claude through the primary/backup key router. */
async function claudeTranslate(
  model: string,
  game: GameId,
  kind: LineKind,
  user: string,
): Promise<{ tr: string; tokensIn: number; tokensOut: number }> {
  const router = claudeRouter()
  if (!router) throw new TranslateError(503, "no Claude key configured")
  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model,
    // A subtitle line is short; a low cap also stops a runaway reply early.
    max_tokens: 200,
    system: SYSTEM(game, kind),
    // A subtitle is a one-line job: no thinking, lowest effort, for the fastest reply.
    thinking: { type: "disabled" },
    output_config: { effort: "low" },
    messages: [{ role: "user", content: user }],
  }
  let response: Anthropic.Message
  try {
    response = await hedged((signal) => router.create(params, { signal }))
  } catch (error) {
    if (error instanceof Anthropic.APIError) throw new TranslateError(error.status ?? 502, error.message.slice(0, 300))
    throw new TranslateError(502, String(error).slice(0, 300))
  }
  const tokensIn = response.usage.input_tokens
  const tokensOut = response.usage.output_tokens
  // Game dialogue can trip a safety classifier; Haiku has no server-side fallback, so skip the line.
  if (response.stop_reason === "refusal") {
    console.warn(`[claude] refused a subtitle line (${response.stop_details?.category ?? "no category"})`)
    return { tr: "", tokensIn, tokensOut }
  }
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("")
  return { tr: text, tokensIn, tokensOut }
}

/**
 * Replies take 0.6 to 1.0 s; an occasional one stalls for seconds. If the first call isn't back after
 * HEDGE_MS, a second identical call starts and whichever answers first wins (the other is cancelled).
 * Costs a fraction of a cent, and only on the slow tail.
 */
const HEDGE_MS = 1_500
async function hedged<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const a = new AbortController()
  const b = new AbortController()
  const first = call(a.signal)
  first.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  const slow = new Promise<typeof SLOW>((resolve) => (timer = setTimeout(() => resolve(SLOW), HEDGE_MS)))
  try {
    const winner = await Promise.race([first, slow])
    if (winner !== SLOW) return winner as T
    const second = call(b.signal)
    second.catch(() => {})
    try {
      return await Promise.any([first, second])
    } catch {
      // Both failed: report the first call's error.
      throw await first.then(
        () => new Error("unreachable"),
        (e: unknown) => e,
      )
    }
  } finally {
    clearTimeout(timer)
    a.abort()
    b.abort()
  }
}
const SLOW = Symbol("slow")

export class TranslateError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`translate failed: ${status} ${body}`)
  }
}

