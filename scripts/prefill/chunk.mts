/**
 * Runs the overlay's SubtitleReader over one time range of a video and writes every confirmed line.
 *
 * The reader is the real one (src/engine/reader.ts), fed frames on video time instead of a timer: ffmpeg
 * scales each frame to 1920 wide (what the overlay asks OBS for), converts it to RGBA and crops the default
 * GTA region, a stand-in OffscreenCanvas hands that crop to preprocessFrame, and performance.now() returns
 * the frame's video time so the reader's clear and re-read windows behave as they do live. OCR is awaited
 * before the next frame, which is the overlay's behavior when OCR keeps up with 5 grabs a second.
 *
 * Lines are written for frames in [start, end). The reader starts `lead` seconds earlier so it is warmed
 * up (objective band learned, current card known) and runs a few seconds past `end` so a card shown just
 * before `end` is still confirmed; the neighbouring chunks own those lines.
 *
 * Usage: pnpm dlx tsx scripts/prefill/chunk.mts <video> <start s> <end s> <out.jsonl>
 */
import { spawn } from "node:child_process"
import { appendFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { createOcr, type OcrEngine } from "../../src/engine/ocr.ts"
import { regionToPixels } from "../../src/engine/preprocess.ts"
import { SubtitleReader } from "../../src/engine/reader.ts"
import { DEFAULT_SETTINGS, type EngineSettings } from "../../src/engine/types.ts"
import { DEFAULT_REGION } from "../../src/shared/settings.ts"

const [, , video, startArg, endArg, out] = process.argv
const START = Number(startArg)
const END = Number(endArg)
const LEAD = 15
const TAIL = 3
const FW = 1920
const FH = 1080
const settings: EngineSettings = { ...DEFAULT_SETTINGS, region: DEFAULT_REGION, readObjectives: true }
const FPS = settings.fps
const px = regionToPixels(settings.region, FW, FH)
const FRAME = px.w * px.h * 4

// The reader reads the clock through performance.now(); drive it with video time.
let clock = 0
Object.defineProperty(globalThis.performance, "now", { value: () => clock, configurable: true, writable: true })

/** The frame handed to the reader: full-frame size, but only the region's pixels (all that is ever read). */
type FakeFrame = { width: number; height: number; crop: Uint8Array }
class FakeCanvas {
  width: number
  height: number
  private src: Uint8Array | null = null
  constructor(w: number, h: number) {
    this.width = w
    this.height = h
  }
  getContext() {
    return {
      drawImage: (f: FakeFrame, sx: number, sy: number, sw: number, sh: number) => {
        if (sx !== px.x || sy !== px.y || sw !== px.w || sh !== px.h) throw new Error(`unexpected crop ${sx},${sy} ${sw}x${sh}`)
        this.src = f.crop
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: this.src!, width: w, height: h }),
      imageSmoothingQuality: "high",
    }
  }
}
;(globalThis as unknown as { OffscreenCanvas: unknown }).OffscreenCanvas = FakeCanvas

const baseOcr = await createOcr({
  workerOptions: {
    workerPath: undefined,
    corePath: undefined,
    langPath: fileURLToPath(new URL("../../public/tesseract", import.meta.url)),
    cachePath: `${tmpdir()}/yayinaltyazi-tesscache`,
    gzip: true,
  },
})
// Track the OCR call in flight so each frame can wait for it.
let inflight: Promise<unknown> | null = null
const ocr: OcrEngine = {
  recognize: (img, clean) => {
    const p = baseOcr.recognize(img, clean)
    inflight = p.catch(() => {})
    return p
  },
  setPsm: (p) => baseOcr.setPsm(p),
  terminate: () => baseOcr.terminate(),
}

let frame: FakeFrame | null = null
const reader = new SubtitleReader({ grab: async () => frame as never, close: () => {} } as never, settings, { ocr })
writeFileSync(out, "")
let lines = 0
reader.on({
  onLine: (l) => {
    const t = clock / 1000
    if (t < START || t >= END) return
    lines++
    appendFileSync(
      out,
      JSON.stringify({ t: Math.round(t * 10) / 10, kind: l.kind, en: l.text, update: l.update, replaces: l.replaces, conf: Math.round(l.confidence) }) +
        "\n",
    )
  },
  onError: (e) => console.error(`[chunk ${START}] reader error`, e),
})
// Start the reader without its timer: frames are pushed below.
const r = reader as unknown as { running: boolean; processFrame(now: number): Promise<void>; ocrBusy: boolean }
r.running = true

const settle = () => new Promise<void>((res) => setImmediate(res))
async function step(t: number, rgba: Uint8Array) {
  clock = t * 1000
  frame = { width: FW, height: FH, crop: rgba }
  await r.processFrame(clock)
  // Wait for OCR (and the reads it chains, like the objective after the dialogue) to finish.
  for (let i = 0; i < 20 && (r.ocrBusy || inflight); i++) {
    const p = inflight
    inflight = null
    if (p) await p
    await settle()
    await settle()
  }
}

const from = Math.max(0, START - LEAD)
const dur = END + TAIL - from
const ff = spawn(
  "ffmpeg",
  [
    "-loglevel", "error", "-threads", "2", "-ss", String(from), "-t", String(dur), "-i", video,
    "-vf", `fps=${FPS},scale=${FW}:${FH}:flags=bicubic,format=rgba,crop=${px.w}:${px.h}:${px.x}:${px.y}`,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ],
  { stdio: ["ignore", "pipe", "inherit"] },
)
let idx = 0
let buf: Buffer = Buffer.alloc(0)
for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
  buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
  while (buf.length >= FRAME) {
    const rgba = new Uint8Array(buf.subarray(0, FRAME))
    buf = buf.subarray(FRAME)
    await step(from + idx / FPS, rgba)
    idx++
  }
}
await baseOcr.terminate()
console.log(`[chunk ${START}-${END}] frames ${idx}, lines ${lines}`)
