/**
 * Dialogue OCR benchmark on a ground-truth set: segment.mts output plus a hand-written truth.json in the
 * same directory, one entry per event in events.json order: the exact dialogue line, "" for an event with
 * no subtitle, or "SKIP". Game text is copyrighted: keep the set out of git.
 *
 * For every event and both saved frames, runs exactly what the reader runs per frame (analyzeAndRender,
 * Tesseract, cleanup) and scores the dialogue read: character error rate, share of lines read
 * near-perfectly (>= 95% similar), misses, and false readings on frames without a subtitle.
 *
 * Flags: --show (list failures), --old (the pre-adaptive settings), --limited (simulate a capture card in
 * limited range), --dim (12% darker capture).
 * Reference on the GTA 6 prologue: CER 0.5%, near-perfect 98%, missed 0, false readings 0/18 (old settings: 15.7%, 23%).
 *
 * Usage: pnpm dlx tsx scripts/ocr-bench/dialogue.mts <setDir> [flags]
 */
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { analyzeAndRender } from "../../src/engine/preprocess.ts"
import { createOcr } from "../../src/engine/ocr.ts"
import { levenshtein, normalizeForCache } from "../../src/engine/text.ts"
import { DEFAULT_SETTINGS, type EngineSettings } from "../../src/engine/types.ts"

const [, , setDir, ...flags] = process.argv
const W = 1382
const H = 152
const settings: EngineSettings = flags.includes("--old")
  ? { ...DEFAULT_SETTINGS, adaptiveInk: false, lumaThreshold: 190, minContrast: 60 }
  : DEFAULT_SETTINGS
const truth = JSON.parse(readFileSync(`${setDir}/truth.json`, "utf8")) as string[]
const ocr = await createOcr({
  workerOptions: {
    workerPath: undefined,
    corePath: undefined,
    langPath: fileURLToPath(new URL("../../public/tesseract", import.meta.url)),
    cachePath: `${tmpdir()}/yayinaltyazi-tesscache`,
    gzip: true,
  },
})

let chars = 0
let errs = 0
let good = 0
let lines = 0
let missed = 0
let falsePos = 0
let empties = 0
const rows: string[] = []
for (let id = 0; id < truth.length; id++) {
  const t = truth[id]
  if (t === "SKIP") continue
  for (const k of [0, 1]) {
    const data = new Uint8Array(readFileSync(`${setDir}/raw/e${String(id).padStart(3, "0")}_${k}.rgba`))
    if (flags.includes("--limited")) for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = 16 + Math.round((data[i] * 219) / 255)
    if (flags.includes("--dim")) for (let i = 0; i < data.length; i++) if (i % 4 !== 3) data[i] = Math.round(data[i] * 0.88)
    const { reads } = analyzeAndRender({ data, width: W, height: H }, settings, 1080)
    const d = reads.find((r) => r.kind === "dialogue")
    let got = ""
    if (d?.image && d.analysis.inkRatio >= settings.minInkRatio) {
      got = (await ocr.recognize(d.image, { minConfidence: settings.minConfidence })).text ?? ""
    }
    if (t === "") {
      empties++
      if (got) {
        falsePos++
        rows.push(`FP   e${id}_${k}: ${got}`)
      }
      continue
    }
    lines++
    const nt = normalizeForCache(t)
    const dist = levenshtein(nt, normalizeForCache(got))
    chars += nt.length
    errs += Math.min(dist, nt.length)
    if (!got) missed++
    if (1 - dist / Math.max(nt.length, 1) >= 0.95) good++
    else rows.push(`${got ? "BAD " : "MISS"} e${id}_${k}: "${got}"  <-  "${t}"`)
  }
}
await ocr.terminate()
console.log(
  `CER ${((100 * errs) / chars).toFixed(1)}%  near-perfect ${good}/${lines} (${((100 * good) / lines).toFixed(0)}%)  missed ${missed}  false readings ${falsePos}/${empties}`,
)
if (flags.includes("--show")) for (const r of rows) console.log("  " + r)
