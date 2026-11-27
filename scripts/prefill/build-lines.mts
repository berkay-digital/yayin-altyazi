/**
 * Builds scripts/prefill/lines.jsonl from the per-video outputs of extract.mts.
 *
 * Every line the reader confirmed is a line an overlay would post, so each one is kept, including the
 * reader's updates (a better re-read or a longer version of the card): the first read was posted too.
 * `prev` is the context the server would send with it (handleLine in src/server/overlay.ts): up to 8
 * earlier dialogue lines from the last 120 s, where a line within 4 s of the previous one and similar to
 * it replaces it. Objectives get no context. Repeats of the same cache key keep their first occurrence,
 * and lines whose key would be too short to cache are dropped.
 *
 * Usage: pnpm dlx tsx scripts/prefill/build-lines.mts <out.jsonl> <video.jsonl>...
 */
import { readFileSync, writeFileSync } from "node:fs"
import { similarity } from "../../src/engine/text.ts"

type Raw = { video: string; t: number; kind: "dialogue" | "objective"; en: string; update: boolean; conf: number }
export type PrefillLine = { kind: "dialogue" | "objective"; en: string; prev: string[]; video: string; t: number }

// Same as CONTEXT_LINES / CONTEXT_MS and the re-read rule in src/server/overlay.ts.
const CONTEXT_LINES = 8
const CONTEXT_MS = 120_000
const REPLACE_MS = 4_000

/** Copy of normalizeKey in src/server/translate.ts (importing that module opens the database). */
export function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const [, , out, ...inputs] = process.argv
const seen = new Set<string>()
const result: PrefillLine[] = []
const stats = { read: 0, short: 0, repeats: 0, dialogue: 0, objective: 0 }

for (const file of inputs) {
  const raws = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Raw)
    .sort((a, b) => a.t - b.t)
  let recent: { en: string; at: number }[] = []
  for (const r of raws) {
    stats.read++
    const at = r.t * 1000
    const ctx = recent.filter((p) => at - p.at < CONTEXT_MS).slice(-CONTEXT_LINES)
    const norm = normalizeKey(r.en)
    const key = `${r.kind === "objective" ? "obj:" : ""}${norm}`
    if (r.kind === "dialogue") {
      const last = ctx.at(-1)
      const base = last && at - last.at < REPLACE_MS && similarity(last.en, r.en) >= 0.7 ? ctx.slice(0, -1) : ctx
      recent = [...base, { en: r.en, at }].slice(-CONTEXT_LINES)
    }
    if (norm.length < 2) {
      stats.short++
      continue
    }
    if (seen.has(key)) {
      stats.repeats++
      continue
    }
    seen.add(key)
    stats[r.kind]++
    result.push({ kind: r.kind, en: r.en, prev: r.kind === "dialogue" ? ctx.map((p) => p.en) : [], video: r.video, t: r.t })
  }
}

writeFileSync(out, result.map((l) => JSON.stringify(l)).join("\n") + "\n")
console.log(
  `read ${stats.read}, kept ${result.length} (dialogue ${stats.dialogue}, objective ${stats.objective}), repeats ${stats.repeats}, too short ${stats.short}`,
)
