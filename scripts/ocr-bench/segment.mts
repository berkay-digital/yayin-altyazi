/**
 * Splits gameplay footage into subtitle events for the dialogue benchmark. Write the matching truth.json
 * (see dialogue.mts) into the same directory afterwards.
 *
 * Reads the subtitle region at 4 fps with ffmpeg, finds bright text with a deliberately loose detector
 * (independent of the engine's filters, so engine misses still show up), groups frames with the same text
 * into events and saves, per event, two raw RGBA frames of the region.
 *
 * Usage: pnpm dlx tsx scripts/ocr-bench/segment.mts <video.mp4> <setDir>
 */
import { spawn } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { computeSignature, signatureDistance } from "../../src/engine/preprocess.ts"

const [, , video, outDir] = process.argv
const FW = 1920
const FH = 1080
const FPS = 4
// Subtitle region on a 1080p frame (ffmpeg crops of yuv420p video must be even).
export const SET_REGION = { x: 268, y: 908, w: 1382, h: 152 }
const { x: X, y: Y, w: W, h: H } = SET_REGION
const FRAME = W * H * 4
mkdirSync(`${outDir}/raw`, { recursive: true })

/** Loose ink: bright pixel with something clearly darker within 3 px. */
function looseMask(rgba: Uint8Array) {
  const n = W * H
  const luma = new Uint8Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) luma[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8
  const mask = new Uint8Array(n)
  let count = 0
  let x0 = W
  let x1 = -1
  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      const i = y * W + x
      const v = luma[i]
      if (v < 185) continue
      let mn = 255
      for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) mn = Math.min(mn, luma[(y + dy) * W + x + dx])
      if (v - mn < 70) continue
      mask[i] = 1
      count++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
    }
  }
  const centered = x1 >= 0 && Math.abs((x0 + x1) / 2 - W / 2) < W * 0.15
  return { mask, count, present: count >= 120 && centered }
}

type Ev = { frames: Uint8Array[]; sig: Float32Array; start: number; end: number }
const events: { id: number; start: number; end: number }[] = []
let cur: Ev | null = null
let idx = 0

function flush() {
  if (!cur) return
  const e = cur
  cur = null
  if (e.frames.length < 3) return // under ~0.75 s: flicker or transition
  const id = events.length
  events.push({ id, start: e.start, end: e.end })
  const pick = [e.frames[Math.floor(e.frames.length / 3)], e.frames[Math.floor((2 * e.frames.length) / 3)]]
  pick.forEach((f, k) => writeFileSync(`${outDir}/raw/e${String(id).padStart(3, "0")}_${k}.rgba`, f))
}

const ff = spawn("ffmpeg", ["-loglevel", "error", "-i", video, "-vf", `fps=${FPS},crop=${W}:${H}:${X}:${Y}`, "-f", "rawvideo", "-pix_fmt", "rgba", "-"])
let buf = Buffer.alloc(0)
ff.stdout.on("data", (chunk: Buffer) => {
  buf = Buffer.concat([buf, chunk])
  while (buf.length >= FRAME) {
    const rgba = new Uint8Array(buf.subarray(0, FRAME))
    buf = buf.subarray(FRAME)
    const t = idx / FPS
    idx++
    const { mask, present } = looseMask(rgba)
    if (!present) {
      flush()
      continue
    }
    const sig = computeSignature(mask, W, H)
    if (cur && signatureDistance(cur.sig, sig) <= 0.3) {
      cur.frames.push(rgba)
      cur.end = t
      cur.sig = sig
    } else {
      flush()
      cur = { frames: [rgba], sig, start: t, end: t }
    }
  }
})
ff.on("close", () => {
  flush()
  writeFileSync(`${outDir}/events.json`, JSON.stringify(events, null, 1))
  console.log(`frames ${idx}, events ${events.length}`)
  void FW
  void FH
})
