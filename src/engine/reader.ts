/**
 * SubtitleReader: grabs frames at a fixed rate, finds subtitle text, OCRs it
 * when it changes, and emits clean lines.
 *
 * Two tracks run side by side: dialogue, and the mission objective line games
 * draw under it (bold, see classifyBlocks). Each has its own change detection,
 * cache and clear timer, so an objective that stays up for a minute doesn't
 * hold back the dialogue changing above it, and the two never merge.
 *
 * Rules:
 * - Never two OCR calls at once. Frames that arrive while OCR runs are still
 *   analyzed (cheap) but never queue another OCR. Dialogue goes first.
 * - Never OCR the same signature twice (a small cache of recent results).
 * - A change must be seen on `stableFrames` frames before it is emitted. With
 *   `speculativeOcr` the OCR starts on the first frame and the result waits
 *   for confirmation, which hides most of the OCR time. That early result is
 *   also reported as provisional, so translation can start before confirmation.
 * - Text that grows (word-by-word reveal) waits one extra frame, and a later
 *   longer version is emitted as an update of the previous line.
 * - After `clearAfterMs` without text, onClear fires once per track.
 */

import type { FrameSource } from "./frame-source.ts"
import { createOcr, type OcrEngine, type OcrOptions, type OcrResult } from "./ocr.ts"
import {
  grayToCanvas,
  preprocessFrame,
  signatureMass,
  signatureContainment,
  signatureDistance,
  type BlockKind,
  type GrayImage,
  type ObjectiveBand,
  type PreprocessResult,
} from "./preprocess.ts"
import { isExtension, similarity } from "./text.ts"
import {
  DEFAULT_SETTINGS,
  type DebugInfo,
  type EngineSettings,
  type ReaderEvents,
  type SubtitleLine,
  type TextBox,
} from "./types.ts"

/**
 * Signature distance above which two frames show different text. Measured on
 * GTA V footage through a 1280px JPEG screenshot: the same line on a moving
 * background stays under ~0.12, different lines start around 0.3.
 */
const CHANGE_DISTANCE = 0.2
/** Stricter distance for reusing a cached OCR result (a wrong hit emits wrong text). */
const CACHE_DISTANCE = 0.12
/**
 * If the text drifted this much between the speculative OCR frame and the
 * confirming frame (a crossfade or fade-in was caught), read it once more.
 */
const REREAD_DISTANCE = 0.08
const CACHE_SIZE = 12

interface Candidate {
  sig: Float32Array
  firstSeenAt: number
  stableCount: number
  growing: boolean
  /** OCR result for this candidate, once known. */
  result: OcrResult | null
  /** Signature of the frame that was OCRed. */
  ocrSig: Float32Array | null
  ocrStarted: boolean
  /** Already re-read once because the text settled after a speculative OCR. */
  reread: boolean
  handled: boolean
  /** The early read was already reported as provisional. */
  provisionalSent: boolean
  /** Where the text sits in the frame, from the latest frame. */
  box: TextBox | undefined
}

interface Emitted {
  text: string
  confidence: number
  at: number
}

interface Track {
  kind: BlockKind
  candidate: Candidate | null
  cache: { sig: Float32Array; result: OcrResult }[]
  last: Emitted | null
  emptySince: number | null
  cleared: boolean
  latestImage: GrayImage | null
}

const KINDS: BlockKind[] = ["dialogue", "objective"]

/**
 * A second read this close to the previous one, shortly after it and with no
 * clear in between, is the same subtitle read again (often a bad first read
 * over a bright background) and replaces it instead of adding a line.
 */
const REREAD_SIMILARITY = 0.7
const REREAD_WINDOW_MS = 2500
/** Mean word confidence an early read needs before translation starts on it. */
const PROVISIONAL_MIN_CONFIDENCE = 75

export interface SubtitleReaderOptions {
  /** Use an existing OCR engine (shared or preloaded). Created on start() otherwise. */
  ocr?: OcrEngine
  ocrOptions?: OcrOptions
}

function newTrack(kind: BlockKind): Track {
  return { kind, candidate: null, cache: [], last: null, emptySince: null, cleared: true, latestImage: null }
}

export class SubtitleReader {
  private settings: EngineSettings
  private events: ReaderEvents = {}
  private ocr: OcrEngine | null
  private ownsOcr: boolean
  private ocrOptions?: OcrOptions
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private cropCanvas: HTMLCanvasElement | OffscreenCanvas | undefined
  private previewCanvas: HTMLCanvasElement | OffscreenCanvas | undefined

  private tracks: Record<BlockKind, Track> = { dialogue: newTrack("dialogue"), objective: newTrack("objective") }
  private ocrBusy = false
  /**
   * Where a clearly bold objective line was last seen (crop rows). Objectives always sit in the same
   * place, so text there is an objective even while it fades and isn't bold yet.
   */
  private objectiveBand: ObjectiveBand | null = null

  constructor(
    private source: FrameSource,
    settings: Partial<EngineSettings> = {},
    opts: SubtitleReaderOptions = {},
  ) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings }
    this.ocr = opts.ocr ?? null
    this.ownsOcr = !opts.ocr
    this.ocrOptions = opts.ocrOptions
  }

  on(events: ReaderEvents): this {
    this.events = { ...this.events, ...events }
    return this
  }

  set onLine(fn: ReaderEvents["onLine"]) {
    this.events.onLine = fn
  }
  set onClear(fn: ReaderEvents["onClear"]) {
    this.events.onClear = fn
  }
  set onDebug(fn: ReaderEvents["onDebug"]) {
    this.events.onDebug = fn
  }
  set onError(fn: ReaderEvents["onError"]) {
    this.events.onError = fn
  }

  get isRunning(): boolean {
    return this.running
  }

  getSettings(): EngineSettings {
    return { ...this.settings }
  }

  /** Load the OCR engine (if needed) and start the frame loop. */
  async start(): Promise<void> {
    if (this.running) return
    if (!this.ocr) this.ocr = await createOcr(this.ocrOptions)
    this.running = true
    this.resetState()
    this.schedule(0)
  }

  /** Stop the loop. Terminates the OCR engine if the reader created it. */
  async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.ownsOcr && this.ocr) {
      const ocr = this.ocr
      this.ocr = null
      await ocr.terminate()
    }
  }

  updateSettings(patch: Partial<EngineSettings>): void {
    const regionChanged = patch.region && JSON.stringify(patch.region) !== JSON.stringify(this.settings.region)
    this.settings = { ...this.settings, ...patch }
    // Anything that changes the mask invalidates signatures.
    if (
      regionChanged ||
      patch.lumaThreshold !== undefined ||
      patch.adaptiveInk !== undefined ||
      patch.colorInk !== undefined ||
      patch.minContrast !== undefined
    ) {
      for (const t of Object.values(this.tracks)) {
        t.candidate = null
        t.cache = []
      }
      if (regionChanged) this.objectiveBand = null
    }
  }

  private resetState(): void {
    this.tracks = { dialogue: newTrack("dialogue"), objective: newTrack("objective") }
    this.objectiveBand = null
  }

  private schedule(delay: number): void {
    if (!this.running) return
    this.timer = setTimeout(() => void this.tick(), delay)
  }

  private async tick(): Promise<void> {
    if (!this.running) return
    const started = performance.now()
    try {
      await this.processFrame(started)
    } catch (err) {
      this.events.onError?.(err)
    }
    const interval = 1000 / Math.max(0.5, this.settings.fps)
    const spent = performance.now() - started
    this.schedule(Math.max(0, interval - spent))
  }

  private async processFrame(now: number): Promise<void> {
    const t0 = performance.now()
    const frame = await this.source.grab()
    const grabMs = performance.now() - t0
    if (!frame) return
    let pre: PreprocessResult
    try {
      pre = preprocessFrame(frame, this.settings, this.cropCanvas, this.objectiveBand)
    } finally {
      if (typeof ImageBitmap !== "undefined" && frame instanceof ImageBitmap) frame.close()
    }
    this.cropCanvas = pre.crop
    const frameMs = performance.now() - t0
    const bold = pre.reads.find((r) => r.kind === "objective" && r.boldObjective && r.analysis.bbox)
    if (bold?.analysis.bbox) this.objectiveBand = { y0: bold.analysis.bbox.y0, y1: bold.analysis.bbox.y1 }

    let changed = false
    for (const kind of KINDS) {
      if (kind === "objective" && !this.settings.readObjectives) continue
      const read = pre.reads.find((r) => r.kind === kind)
      const present = read !== undefined && read.image !== null && read.analysis.inkRatio >= this.settings.minInkRatio
      changed = this.observe(this.tracks[kind], present ? read : null, now) || changed
    }
    this.maybeStartOcr()
    for (const kind of KINDS) this.maybeEmit(this.tracks[kind])

    if (this.events.onDebug) {
      const d = this.tracks.dialogue
      const info: DebugInfo = {
        frameMs,
        grabMs,
        ink: pre.analysis.inkRatio,
        changed,
        stableCount: d.candidate?.stableCount ?? 0,
        ocrBusy: this.ocrBusy,
        preview: pre.ocrImage ? (this.previewCanvas = grayToCanvas(pre.ocrImage, this.previewCanvas)) : null,
        crop: pre.crop,
      }
      this.events.onDebug(info)
    }
  }

  /** Feed one frame's block (or its absence) to a track. Returns true if the track's text changed. */
  private observe(track: Track, read: PreprocessResult["reads"][number] | null, now: number): boolean {
    if (!read) {
      const changed = track.candidate !== null
      track.candidate = null
      track.emptySince ??= now
      if (!track.cleared && now - track.emptySince >= this.settings.clearAfterMs) {
        track.cleared = true
        track.last = null
        this.events.onClear?.(track.kind)
      }
      return changed
    }
    track.emptySince = null
    track.latestImage = read.image
    const sig = read.analysis.signature
    const cand = track.candidate
    const box = this.frameBox(read.analysis)
    if (!cand || signatureDistance(cand.sig, sig) > CHANGE_DISTANCE) {
      const growing =
        cand !== null && signatureMass(sig) > signatureMass(cand.sig) && signatureContainment(cand.sig, sig) >= 0.85
      const cached = track.cache.find((c) => signatureDistance(c.sig, sig) <= CACHE_DISTANCE)
      track.candidate = {
        sig,
        firstSeenAt: now,
        stableCount: 1,
        growing,
        result: cached?.result ?? null,
        ocrSig: cached ? sig : null,
        ocrStarted: cached !== undefined,
        reread: false,
        handled: false,
        provisionalSent: cached !== undefined,
        box,
      }
      return true
    }
    cand.stableCount++
    cand.sig = sig
    cand.box = box ?? cand.box
    return false
  }

  /** A block's text box in whole-frame fractions. */
  private frameBox(a: PreprocessResult["analysis"]): TextBox | undefined {
    const b = a.bbox
    if (!b) return undefined
    const R = this.settings.region
    return {
      x: R.x + (b.x0 / a.width) * R.w,
      y: R.y + (b.y0 / a.height) * R.h,
      w: ((b.x1 - b.x0 + 1) / a.width) * R.w,
      h: ((b.y1 - b.y0 + 1) / a.height) * R.h,
      glyph: (a.glyphHeight / a.height) * R.h,
    }
  }

  private requiredFrames(c: Candidate): number {
    return Math.max(1, this.settings.stableFrames + (c.growing ? 1 : 0))
  }

  private maybeStartOcr(): void {
    if (this.ocrBusy || !this.ocr) return
    for (const kind of KINDS) {
      const track = this.tracks[kind]
      const c = track.candidate
      if (!c || c.ocrStarted || !track.latestImage) continue
      if (!this.settings.speculativeOcr && c.stableCount < this.requiredFrames(c)) continue
      this.runOcr(track, c, track.latestImage)
      return
    }
  }

  private runOcr(track: Track, c: Candidate, image: GrayImage): void {
    c.ocrStarted = true
    this.ocrBusy = true
    const sig = c.sig
    c.ocrSig = sig
    const ocr = this.ocr!
    void ocr
      .recognize(image, { minConfidence: this.settings.minConfidence })
      .then((result) => {
        track.cache.push({ sig, result })
        if (track.cache.length > CACHE_SIZE) track.cache.shift()
        const cur = track.candidate
        if (cur && signatureDistance(cur.sig, sig) <= CHANGE_DISTANCE) {
          cur.result = result
          this.maybeProvisional(track, cur)
        } else if (cur === c) {
          // Candidate drifted while OCR ran; read again on the next frame.
          c.ocrStarted = false
        }
        if (result) this.events.onOcr?.({ raw: result.raw, text: result.text, confidence: result.confidence, kind: track.kind })
        if (this.events.onDebug && result && track.kind === "dialogue") {
          this.events.onDebug({
            frameMs: 0,
            grabMs: 0,
            ink: 0,
            changed: false,
            stableCount: cur?.stableCount ?? 0,
            ocrBusy: false,
            preview: null,
            crop: null,
            ocr: { raw: result.raw, text: result.text, confidence: result.confidence, ms: result.ms, dropped: result.dropped },
          })
        }
      })
      .catch((err: unknown) => {
        c.ocrStarted = false
        this.events.onError?.(err)
      })
      .finally(() => {
        this.ocrBusy = false
        // Emit right away if the candidate is already confirmed, instead of
        // waiting for the next frame.
        if (this.running) {
          for (const kind of KINDS) this.maybeEmit(this.tracks[kind])
          this.maybeStartOcr()
        }
      })
  }

  /**
   * Report an early read that isn't confirmed yet, once per candidate, unless it repeats the line on
   * screen. Low-confidence early reads are mostly fade frames that never get confirmed, so they're skipped.
   */
  private maybeProvisional(track: Track, c: Candidate): void {
    if (c.provisionalSent || c.handled || !c.result?.text) return
    if (c.result.confidence < PROVISIONAL_MIN_CONFIDENCE) return
    if (c.stableCount >= this.requiredFrames(c)) return
    c.provisionalSent = true
    const last = track.last
    if (last && similarity(last.text, c.result.text) >= this.settings.sameLineSimilarity) return
    this.events.onProvisional?.({ text: c.result.text, kind: track.kind })
  }

  private maybeEmit(track: Track): void {
    const c = track.candidate
    if (!c || c.handled || !c.result) return
    if (c.stableCount < this.requiredFrames(c)) return
    if (!c.reread && c.ocrSig && signatureDistance(c.ocrSig, c.sig) > REREAD_DISTANCE) {
      c.reread = true
      c.result = null
      c.ocrStarted = false
      this.maybeStartOcr()
      return
    }
    c.handled = true
    const r = c.result
    if (!r.text) return
    const now = performance.now()
    const base: Omit<SubtitleLine, "update" | "replaces"> = {
      text: r.text,
      kind: track.kind,
      box: c.box,
      confidence: r.confidence,
      ocrMs: r.ms,
      at: now,
      firstSeenAt: c.firstSeenAt,
    }
    const last = track.last
    if (last) {
      const sim = similarity(last.text, r.text)
      if (sim >= this.settings.sameLineSimilarity) {
        // Same subtitle read again. Only worth an update if clearly better.
        const better = r.confidence >= last.confidence + 5 && r.text.length >= last.text.length
        if (better && r.text !== last.text) {
          track.last = { text: r.text, confidence: r.confidence, at: now }
          track.cleared = false
          this.events.onLine?.({ ...base, update: true, replaces: last.text })
        }
        return
      }
      if (isExtension(last.text, r.text) || (sim >= REREAD_SIMILARITY && now - last.at < REREAD_WINDOW_MS)) {
        track.last = { text: r.text, confidence: r.confidence, at: now }
        track.cleared = false
        this.events.onLine?.({ ...base, update: true, replaces: last.text })
        return
      }
    }
    track.last = { text: r.text, confidence: r.confidence, at: now }
    track.cleared = false
    this.events.onLine?.({ ...base, update: false })
  }
}
