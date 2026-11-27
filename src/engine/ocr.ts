/**
 * Tesseract.js v7 wrapper. All assets are self-hosted under /tesseract/
 * (see scripts/copy-tesseract-assets.mjs). The library is imported lazily so
 * this module is safe to import during SSR.
 *
 * No SharedArrayBuffer is used, so pages need no COOP/COEP headers.
 */

import type Tesseract from "tesseract.js"
import { encodePgm, type GrayImage } from "./preprocess.ts"
import { cleanOcrLines, type CleanOptions, type OcrLineInput } from "./text.ts"

/** Page segmentation modes worth trying for 1-2 subtitle lines. */
export const PSM = {
  SINGLE_BLOCK: "6",
  SINGLE_LINE: "7",
  SPARSE_TEXT: "11",
  RAW_LINE: "13",
} as const
export type PsmValue = (typeof PSM)[keyof typeof PSM]

/** Printable characters that appear in English subtitles. */
export const SUBTITLE_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?'\"-:;()&$%/#@+*"

export interface OcrOptions {
  /** Base URL of the self-hosted assets. Default "/tesseract/". */
  basePath?: string
  psm?: PsmValue
  /** Restrict output characters. Empty string disables the whitelist. */
  whitelist?: string
  /**
   * IndexedDB cache key for the language data. Change it when the model file
   * changes so browsers drop the old copy.
   */
  cachePath?: string
  /** Raw tesseract.js worker options; overrides the paths above (used by tests in Node). */
  workerOptions?: Partial<Tesseract.WorkerOptions>
}

export interface OcrResult {
  /** Raw Tesseract text. */
  raw: string
  /** Cleaned single line, or null if dropped. */
  text: string | null
  /** Mean word confidence 0..100 of the kept words. */
  confidence: number
  ms: number
  /** Why the result was dropped, when text is null. */
  dropped?: string
}

export interface OcrEngine {
  recognize(image: GrayImage, clean?: CleanOptions): Promise<OcrResult>
  setPsm(psm: PsmValue): Promise<void>
  terminate(): Promise<void>
}

export const MODEL_CACHE_KEY = "yayinaltyazi-eng-fast-v1"
const OCR_TIMEOUT_MS = 8000

interface TessWordJson {
  text: string
  confidence: number
}
interface TessLineJson {
  words: TessWordJson[]
  text: string
}
interface TessParagraphJson {
  lines: TessLineJson[]
}
interface TessBlockJson {
  paragraphs: TessParagraphJson[]
}

function toLines(blocks: TessBlockJson[] | null): OcrLineInput[] {
  const lines: OcrLineInput[] = []
  for (const b of blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        lines.push({ words: (l.words ?? []).map((w) => ({ text: w.text, confidence: w.confidence })) })
      }
    }
  }
  return lines
}

function imageInput(img: GrayImage): Blob | Uint8Array {
  const pgm = encodePgm(img)
  if (typeof window !== "undefined" && typeof Blob !== "undefined") {
    return new Blob([pgm as BlobPart], { type: "image/x-portable-graymap" })
  }
  // Node (offline tests): tesseract.js takes a Buffer.
  const NodeBuffer = (globalThis as unknown as { Buffer?: { from(a: Uint8Array): Uint8Array } }).Buffer
  return NodeBuffer ? NodeBuffer.from(pgm) : pgm
}

export async function createOcr(opts: OcrOptions = {}): Promise<OcrEngine> {
  const mod = await import("tesseract.js")
  const T = (mod as unknown as { default?: typeof Tesseract }).default ?? (mod as unknown as typeof Tesseract)
  const base = (opts.basePath ?? "/tesseract/").replace(/\/?$/, "/")
  const merged: Partial<Tesseract.WorkerOptions> = {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    gzip: true,
    cachePath: opts.cachePath ?? MODEL_CACHE_KEY,
    workerBlobURL: false,
    ...opts.workerOptions,
  }
  // Undefined entries would override tesseract.js defaults, so drop them.
  const workerOptions = Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  ) as Partial<Tesseract.WorkerOptions>
  const whitelist = opts.whitelist ?? SUBTITLE_WHITELIST
  let psm: PsmValue = opts.psm ?? PSM.SINGLE_BLOCK
  const make = async () => {
    const w = await T.createWorker("eng", 1 /* OEM.LSTM_ONLY */, workerOptions)
    await w.setParameters({
      tessedit_pageseg_mode: psm as Tesseract.PSM,
      tessedit_char_whitelist: whitelist,
      preserve_interword_spaces: "0",
      user_defined_dpi: "300",
    })
    return w
  }
  let worker = await make()

  /**
   * A subtitle image reads in tens of milliseconds. If one call hangs (a wedged WASM worker), the reader
   * would wait on it forever and subtitles would silently stop, so give up and start a fresh worker.
   */
  const recognizeWithTimeout = async (input: Tesseract.ImageLike) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("OCR timed out")), OCR_TIMEOUT_MS)
    })
    try {
      return await Promise.race([worker.recognize(input, {}, { text: true, blocks: true }), timeout])
    } catch (e) {
      if (e instanceof Error && e.message === "OCR timed out") {
        const stuck = worker
        worker = await make()
        void stuck.terminate().catch(() => {})
      }
      throw e
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async recognize(image, clean) {
      const t0 = performance.now()
      const res = await recognizeWithTimeout(imageInput(image) as Tesseract.ImageLike)
      const ms = performance.now() - t0
      const raw = (res.data.text ?? "").trim()
      const lines = toLines(res.data.blocks as unknown as TessBlockJson[] | null)
      const cleaned = cleanOcrLines(lines, clean)
      if (!cleaned) {
        return { raw, text: null, confidence: res.data.confidence ?? 0, ms, dropped: raw ? "garbage or low confidence" : "empty" }
      }
      return { raw, text: cleaned.text, confidence: cleaned.confidence, ms }
    },
    async setPsm(next) {
      psm = next
      await worker.setParameters({ tessedit_pageseg_mode: next as Tesseract.PSM })
    },
    async terminate() {
      await worker.terminate()
    },
  }
}
