/**
 * Shared types for the subtitle reading engine.
 *
 * Frames come in (from OBS or a <video>), clean English subtitle lines come out.
 */

/** A rectangle in fractions (0..1) of the frame size. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

export interface EngineSettings {
  /** Where subtitles appear, as fractions of the frame. */
  region: Region
  /** Frames grabbed per second. */
  fps: number
  /**
   * Minimum luma (0..255) for a pixel to count as subtitle ink. Only used when
   * `adaptiveInk` is off; adaptive mode measures the ink and sets it per frame.
   */
  lumaThreshold: number
  /**
   * Measure how bright the subtitle ink really is on each frame and place the
   * threshold below it (two analysis passes). Needed for thin gray fonts like
   * GTA 6's and for darker captures. See ADAPTIVE in preprocess.ts.
   */
  adaptiveInk: boolean
  /**
   * Also accept bright saturated colors (yellow or light blue speaker names)
   * as ink. Their luma is lower than white, so they are tested on the
   * brightest channel instead.
   */
  colorInk: boolean
  /**
   * Ink must sit next to something at least this much darker (the outline or
   * drop shadow). Rejects large bright background areas like sky or snow.
   */
  minContrast: number
  /**
   * Subtitles are horizontally centered in the region. Text rows whose center
   * is far from the region center (HUD money counters, street names, minimap)
   * are ignored. Turn off for games with left-aligned subtitles.
   */
  centeredText: boolean
  /** Fraction of the region that must be ink for "text present". */
  minInkRatio: number
  /** Frames a changed signature must persist before its OCR result is emitted. */
  stableFrames: number
  /**
   * Start OCR on the first frame of a change and only emit once the change is
   * confirmed stable. Saves roughly one OCR duration of latency.
   */
  speculativeOcr: boolean
  /** How long the region must stay empty before onClear fires. */
  clearAfterMs: number
  /** Lines whose mean word confidence is below this (0..100) are dropped. */
  minConfidence: number
  /** Similarity (0..1) above which two OCR results are the same line. */
  sameLineSimilarity: number
  /** Target x-height in pixels of the image handed to Tesseract. */
  targetTextHeight: number
  /** Also read the mission objective line (bold, under the dialogue) as its own track. */
  readObjectives: boolean
}

/** Dialogue plus the mission objective line under it (same as the dashboard default). */
export const GTA_REGION: Region = { x: 0.12, y: 0.8, w: 0.76, h: 0.19 }

export const DEFAULT_SETTINGS: EngineSettings = {
  region: GTA_REGION,
  // Five grabs a second: a new line is seen 100 ms after it appears on average, and confirmed 200 ms later.
  fps: 5,
  lumaThreshold: 190,
  adaptiveInk: true,
  colorInk: true,
  minContrast: 45,
  centeredText: true,
  minInkRatio: 0.0008,
  stableFrames: 2,
  speculativeOcr: true,
  clearAfterMs: 600,
  minConfidence: 40,
  sameLineSimilarity: 0.85,
  targetTextHeight: 30,
  readObjectives: true,
}

export type LineKind = "dialogue" | "objective"

/** Where the English text sits, as fractions of the whole frame. */
export interface TextBox {
  x: number
  y: number
  w: number
  h: number
  /** Glyph height (about the x-height) as a fraction of the frame height. */
  glyph: number
}

export interface SubtitleLine {
  /** Clean text, two-line subtitles joined with a space. */
  text: string
  /** Dialogue subtitle or mission objective. */
  kind: LineKind
  /** Where the English text was on screen (for covering it). */
  box?: TextBox
  /** Mean word confidence, 0..100. */
  confidence: number
  /** Time the OCR call took. */
  ocrMs: number
  /** performance.now() when the line was emitted. */
  at: number
  /** performance.now() of the first frame that showed this subtitle. */
  firstSeenAt: number
  /**
   * True when this replaces the previous line (same subtitle read better, or a
   * word-by-word subtitle that kept growing). The consumer should swap the
   * last rendered line instead of adding a new one.
   */
  update: boolean
  /** Text of the line this one replaces, when update is true. */
  replaces?: string
}

export interface DebugInfo {
  /** Time spent grabbing and preprocessing this frame. */
  frameMs: number
  grabMs: number
  /** Fraction of region pixels that are kept ink. */
  ink: number
  /** Signature differs from the previous frame. */
  changed: boolean
  /** Frames the current signature has been seen. */
  stableCount: number
  ocrBusy: boolean
  /** The binarized image as handed to Tesseract (black text on white). */
  preview: HTMLCanvasElement | OffscreenCanvas | null
  /** The raw crop, for side-by-side display. */
  crop: HTMLCanvasElement | OffscreenCanvas | null
  /** OCR output for this frame if OCR ran, including dropped results. */
  ocr?: { raw: string; text: string | null; confidence: number; ms: number; dropped?: string }
}

export interface ReaderEvents {
  onLine?: (line: SubtitleLine) => void
  /**
   * The first read of a new line, before it is confirmed on the following frames. Start slow work
   * (translation) here; show nothing until onLine. It may never be confirmed (a fade transition).
   */
  onProvisional?: (read: { text: string; kind: LineKind }) => void
  /** The track's text has been gone for clearAfterMs. */
  onClear?: (kind: LineKind) => void
  onDebug?: (info: DebugInfo) => void
  /** Every OCR result, kept or dropped. Cheap, unlike onDebug, so it can stay on while streaming. */
  onOcr?: (result: { raw: string; text: string | null; confidence: number; kind: LineKind }) => void
  onError?: (error: unknown) => void
}

/** Anything a 2D canvas can draw. */
export type FrameImage = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement
