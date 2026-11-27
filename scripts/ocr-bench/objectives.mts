/**
 * Dialogue + mission objective benchmark on hand-checked frames of a gameplay video, read with the
 * dashboard's default subtitle area. Checks that each frame's dialogue and objective come out as the right
 * kind with the right text.
 *
 * The cases file is a JSON array you write by hand while watching the video, one entry per checked frame:
 *   [{ "t": 25.0, "d": "dialogue line", "o": "objective line" }, { "t": 181.5 }]
 * t is the time in seconds, d/o the expected dialogue/objective text, "?" prints the read without scoring,
 * and a missing d/o means nothing should be read there. Game text is copyrighted: keep the file out of git.
 *
 * Usage: pnpm dlx tsx scripts/ocr-bench/objectives.mts <video.mp4> <cases.json>
 */
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { analyzeAndRender } from "../../src/engine/preprocess.ts"
import { createOcr } from "../../src/engine/ocr.ts"
import { similarity } from "../../src/engine/text.ts"
import { DEFAULT_SETTINGS } from "../../src/engine/types.ts"
import { DEFAULT_REGION } from "../../src/shared/settings.ts"

const [, , video, casesFile] = process.argv
const even = (v: number) => 2 * Math.round(v / 2)
const R = DEFAULT_REGION
const X = even(R.x * 1920)
const Y = even(R.y * 1080)
const W = even(R.w * 1920)
const H = even(R.h * 1080)

// d/o: expected dialogue/objective text; "?" = print only; missing = nothing expected.
const cases = JSON.parse(readFileSync(casesFile, "utf8")) as { t: number; d?: string; o?: string }[]

const ocr = await createOcr({
  workerOptions: {
    workerPath: undefined,
    corePath: undefined,
    langPath: fileURLToPath(new URL("../../public/tesseract", import.meta.url)),
    cachePath: `${tmpdir()}/yayinaltyazi-tesscache`,
    gzip: true,
  },
})
let ok = 0
let total = 0
for (const c of cases) {
  const raw = execFileSync(
    "ffmpeg",
    ["-loglevel", "error", "-ss", String(c.t), "-i", video, "-frames:v", "1", "-vf", `crop=${W}:${H}:${X}:${Y}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { maxBuffer: 64 << 20 },
  )
  const { reads } = analyzeAndRender({ data: new Uint8Array(raw), width: W, height: H }, DEFAULT_SETTINGS, 1080)
  const got: Record<string, string> = {}
  for (const r of reads) {
    if (!r.image) continue
    const res = await ocr.recognize(r.image, { minConfidence: DEFAULT_SETTINGS.minConfidence })
    got[r.kind] = res.text ?? `(dropped: ${res.raw})`
  }
  for (const kind of ["dialogue", "objective"] as const) {
    const want = kind === "dialogue" ? c.d : c.o
    const have = got[kind]
    if (want === "?") {
      console.log(`info ${c.t}s ${kind.padEnd(9)} ${JSON.stringify(have ?? null)}`)
      continue
    }
    total++
    const pass = want ? Boolean(have) && similarity(want, have) >= 0.85 : !have
    if (pass) ok++
    console.log(`${pass ? "ok  " : "FAIL"} ${c.t}s ${kind.padEnd(9)} got ${JSON.stringify(have ?? null)}  want ${JSON.stringify(want ?? null)}`)
  }
}
await ocr.terminate()
console.log(`${ok}/${total} checks pass`)
