/**
 * Frame preprocessing: crop the subtitle region, find subtitle ink, and render
 * a clean black-on-white image for Tesseract.
 *
 * Game subtitles are white (sometimes yellow or light blue) text with a dark
 * outline or drop shadow, drawn over anything. The pipeline:
 *
 * 1. Candidate ink: bright pixels (luma above the threshold, or for colored
 *    ink, a bright saturated channel).
 * 2. Local contrast: a candidate only stays if something clearly darker sits
 *    within a few pixels (the outline). This removes the inside of bright
 *    background areas like sky, snow or a white shirt.
 * 3. Connected components: drop specks, components touching the crop border
 *    (background objects that continue outside the region), and components too
 *    tall or wide to be glyphs.
 * 4. Rows: group kept components into text lines and drop rows that do not
 *    look like a line of text (too few components, wrong height).
 *
 * The analysis functions are pure (typed arrays only) so they run the same in
 * the browser, a worker, or Node for offline tests.
 */

import type { EngineSettings, FrameImage, Region } from "./types.ts"

/** Minimal ImageData shape (RGBA, 4 bytes per pixel). */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export interface GrayImage {
  data: Uint8Array
  width: number
  height: number
}

export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface CropAnalysis {
  width: number
  height: number
  /** 1 where a pixel is kept subtitle ink. */
  mask: Uint8Array
  /** Per-pixel ink brightness: luma, or the brightest channel for colored ink. */
  value: Uint8Array
  /** Kept ink pixels divided by crop area. */
  inkRatio: number
  /** Number of kept components (roughly glyphs). */
  glyphs: number
  /** Bounding box of kept ink, or null when empty. */
  bbox: Box | null
  /** Median kept glyph height in crop pixels (roughly the x-height). */
  glyphHeight: number
  /** Downsampled ink density grid for change detection. */
  signature: Float32Array
  /** Kept text blocks, top to bottom (at most two: dialogue and an objective line). */
  blocks: TextBlock[]
}

/** One block of kept text: a subtitle card or a mission objective line. */
export interface TextBlock {
  /** Rows of the crop the block owns (its text plus room for accents and descenders). */
  y0: number
  y1: number
  bbox: Box
  glyphHeight: number
  /** Kept ink pixels in the block. */
  ink: number
  /** Mean horizontal stroke run of the ink divided by glyph height: about 0.2 regular, higher for bold. */
  stroke: number
  /** Share of the block's ink that is colored (keywords in objectives). */
  colorRatio: number
}

/** Settings used by analysis. A subset of EngineSettings. */
export type AnalyzeSettings = Pick<EngineSettings, "lumaThreshold" | "colorInk" | "minContrast" | "centeredText">

export const SIGNATURE_COLS = 160
export const SIGNATURE_ROWS = 16

/**
 * Pixel scale relative to a 1080p frame. Glyph size limits are expressed for
 * 1080p and scaled by this, so a 720p screenshot works with the same settings.
 */
function frameScale(frameHeight: number): number {
  return frameHeight / 1080
}

/** Separable sliding-window minimum with radius r (window 2r+1). */
function minFilter(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(src.length)
  const out = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let m = 255
      const a = Math.max(0, x - r)
      const b = Math.min(w - 1, x + r)
      for (let k = a; k <= b; k++) {
        const v = src[row + k]
        if (v < m) m = v
      }
      tmp[row + x] = m
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let m = 255
      const a = Math.max(0, y - r)
      const b = Math.min(h - 1, y + r)
      for (let k = a; k <= b; k++) {
        const v = tmp[k * w + x]
        if (v < m) m = v
      }
      out[y * w + x] = m
    }
  }
  return out
}

interface Component {
  x0: number
  y0: number
  x1: number
  y1: number
  area: number
  /** Pixels at full subtitle brightness (see `strong` in analyzeCrop). */
  strong: number
  touchesBorder: boolean
  keep: boolean
}

/**
 * Label 8-connected components of `bin`. Returns the label image (0 = none,
 * label i+1 = components[i]) and the component stats.
 */
function labelComponents(
  bin: Uint8Array,
  w: number,
  h: number,
  strong: Uint8Array,
): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(w * h)
  const comps: Component[] = []
  const stack = new Int32Array(w * h)
  for (let start = 0; start < bin.length; start++) {
    if (!bin[start] || labels[start]) continue
    const id = comps.length + 1
    const c: Component = {
      x0: w,
      y0: h,
      x1: -1,
      y1: -1,
      area: 0,
      strong: 0,
      touchesBorder: false,
      keep: true,
    }
    let sp = 0
    stack[sp++] = start
    labels[start] = id
    while (sp > 0) {
      const p = stack[--sp]
      const x = p % w
      const y = (p - x) / w
      c.area++
      c.strong += strong[p]
      if (x < c.x0) c.x0 = x
      if (x > c.x1) c.x1 = x
      if (y < c.y0) c.y0 = y
      if (y > c.y1) c.y1 = y
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.touchesBorder = true
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= w) continue
          const q = ny * w + nx
          if (bin[q] && !labels[q]) {
            labels[q] = id
            stack[sp++] = q
          }
        }
      }
    }
    comps.push(c)
  }
  return { labels, comps }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Find subtitle ink in an RGBA crop.
 *
 * @param frameHeight height of the full frame the crop came from, used to
 *   scale size limits.
 * @param inkPeak brightness of the subtitle fill (255 for pure white). The
 *   "solid core" and split thresholds are placed relative to it, so text that
 *   tops out lower (thin anti-aliased fonts, limited-range capture) still counts.
 */
export function analyzeCrop(img: RgbaImage, settings: AnalyzeSettings, frameHeight: number, inkPeak = 255): CropAnalysis {
  const { width: w, height: h, data } = img
  const n = w * h
  const s = frameScale(frameHeight)
  const T = settings.lumaThreshold
  const P = Math.max(T + 10, Math.min(255, inkPeak))
  const colorMin = Math.max(0, T - 75)
  const redMin = Math.max(0, T - 110)

  // Subtitle fill sits near the ink peak; textured backgrounds that pass the
  // threshold (concrete, fabric) mostly sit just above it.
  const peakT = Math.round(T + 0.6 * (P - T))
  const luma = new Uint8Array(n)
  const bright = new Uint8Array(n)
  const strong = new Uint8Array(n)
  const value = new Uint8Array(n)
  const coloredPx = new Uint8Array(n)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const r = data[j]
    const g = data[j + 1]
    const b = data[j + 2]
    const y = (r * 77 + g * 150 + b * 29) >> 8
    luma[i] = y
    value[i] = y
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b
    // A bright, clearly saturated color whose brightest channel is near
    // white: yellow, light blue, light green keywords. Pure red has low luma
    // and fails the colorMin test.
    // Strongly saturated colors may be darker (GTA's red keywords are about
    // rgb(200, 60, 64), luma ~100), so they get a lower luma floor.
    const sat = mx - mn
    const colored =
      settings.colorInk &&
      ((sat >= 40 && y >= colorMin && mx >= T - 15) || (sat >= 100 && y >= redMin && mx >= T - 30))
    if (colored) {
      bright[i] = 1
      coloredPx[i] = 1
      value[i] = Math.max(y, mx)
      if (mx >= T - 15) strong[i] = 1
    } else if (y >= T) {
      bright[i] = 1
      if (y >= peakT) strong[i] = 1
    }
  }

  // Outline check: the darkest pixel within r must be clearly darker. 4 px (1080p) reaches the middle of
  // bold objective strokes; 3 hollowed them out, wider starts keeping bright background.
  const r = Math.max(2, Math.round(4 * s))
  const localMin = minFilter(luma, w, h, r)
  const cand = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (bright[i] && luma[i] - localMin[i] >= settings.minContrast) cand[i] = 1
  }

  const { labels, comps } = labelComponents(cand, w, h, strong)

  const limits = glyphLimits(s)
  for (const c of comps) c.keep = glyphLike(c, limits)

  // Split pass: a glyph that touches a bright background (white shirt, snow)
  // merges with it into one oversized component. The subtitle fill is usually
  // brighter than the background, so retry those pixels at a higher threshold.
  // Only oversized components are split; a real glyph keeps its bright core
  // at the higher threshold anyway, so being liberal here is cheap.
  const hiT = Math.min(P - 10, Math.max(T + 40, P - 23))
  const prelimH = median(
    comps.filter((c) => c.keep && c.area >= limits.minArea * 2 && ch(c) >= limits.minGlyphH).map(ch),
  )
  const refH = prelimH > 0 ? prelimH : 16 * s
  const split = new Uint8Array(n)
  let anySplit = false
  for (let ci = 0; ci < comps.length; ci++) {
    const c = comps[ci]
    if (c.area < limits.minArea * 4) continue
    const oversized = !c.keep || ch(c) > refH * 1.8 || c.x1 - c.x0 + 1 > refH * 4
    if (!oversized) continue
    c.keep = false
    const id = ci + 1
    for (let y = c.y0; y <= c.y1; y++) {
      for (let x = c.x0; x <= c.x1; x++) {
        const i = y * w + x
        if (labels[i] === id && luma[i] >= hiT && luma[i] - localMin[i] >= settings.minContrast + 20) {
          split[i] = 1
          anySplit = true
        }
      }
    }
  }
  if (anySplit) {
    const extra = labelComponents(split, w, h, strong)
    const offset = comps.length
    for (const c of extra.comps) {
      c.keep = glyphLike(c, limits)
      comps.push(c)
    }
    for (let i = 0; i < n; i++) if (extra.labels[i]) labels[i] = extra.labels[i] + offset
  }

  const bands = filterLayout(comps, limits, w, settings.centeredText)

  const mask = new Uint8Array(n)
  let ink = 0
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  const heights: number[] = []
  let glyphs = 0
  for (const c of comps) {
    if (!c.keep) continue
    glyphs++
    heights.push(c.y1 - c.y0 + 1)
    if (c.x0 < x0) x0 = c.x0
    if (c.y0 < y0) y0 = c.y0
    if (c.x1 > x1) x1 = c.x1
    if (c.y1 > y1) y1 = c.y1
  }
  if (glyphs > 0) {
    for (let i = 0; i < n; i++) {
      const l = labels[i]
      if (l && comps[l - 1].keep) {
        mask[i] = 1
        ink++
      }
    }
  }

  return {
    width: w,
    height: h,
    mask,
    value,
    inkRatio: ink / n,
    glyphs,
    bbox: glyphs > 0 ? { x0, y0, x1, y1 } : null,
    glyphHeight: median(heights),
    signature: computeSignature(mask, w, h),
    blocks: glyphs > 0 ? measureBlocks(bands, comps, mask, coloredPx, w, h) : [],
  }
}

function measureBlocks(bands: Band[], comps: Component[], mask: Uint8Array, colored: Uint8Array, w: number, h: number): TextBlock[] {
  const out: TextBlock[] = []
  for (let bi = 0; bi < bands.length; bi++) {
    const band = bands[bi]
    // Own the rows from a bit above the text (accents, quotes) to a bit below (descenders, marks),
    // without reaching into the neighbouring block.
    const prevEnd = bi > 0 ? bands[bi - 1].y1 : -1
    const nextStart = bi < bands.length - 1 ? bands[bi + 1].y0 : h
    const y0 = Math.max(0, Math.ceil(Math.max(band.y0 - band.h * 0.6, (prevEnd + band.y0) / 2)))
    const y1 = Math.min(h - 1, Math.floor(Math.min(band.y1 + band.h * 0.5, (band.y1 + nextStart) / 2)))
    let bx0 = w
    let by0 = h
    let bx1 = -1
    let by1 = -1
    let ink = 0
    let col = 0
    let runs = 0
    for (let y = y0; y <= y1; y++) {
      let inRun = false
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (!mask[i]) {
          inRun = false
          continue
        }
        ink++
        if (colored[i]) col++
        if (!inRun) runs++
        inRun = true
        if (x < bx0) bx0 = x
        if (x > bx1) bx1 = x
        if (y < by0) by0 = y
        if (y > by1) by1 = y
      }
    }
    if (ink === 0) continue
    const heights = comps.filter((c) => c.keep && (c.y0 + c.y1) / 2 >= band.y0 && (c.y0 + c.y1) / 2 <= band.y1).map(ch)
    const gh = median(heights) || band.h
    out.push({
      y0,
      y1,
      bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
      glyphHeight: gh,
      ink,
      stroke: runs > 0 ? ink / runs / Math.max(1, gh) : 0,
      colorRatio: col / ink,
    })
  }
  return out
}

/** The analysis narrowed to one block: its own mask, box, glyph size and signature. */
export function blockAnalysis(a: CropAnalysis, b: TextBlock): CropAnalysis {
  const mask = new Uint8Array(a.mask.length)
  const from = b.y0 * a.width
  const to = (b.y1 + 1) * a.width
  mask.set(a.mask.subarray(from, to), from)
  return {
    ...a,
    mask,
    inkRatio: b.ink / (a.width * a.height),
    bbox: b.bbox,
    glyphHeight: b.glyphHeight,
    signature: computeSignature(mask, a.width, a.height),
    blocks: [b],
  }
}

interface GlyphLimits {
  scale: number
  minArea: number
  minGlyphH: number
  /** Smallest median glyph height for a text row. */
  minRowH: number
  maxGlyphH: number
  maxGlyphW: number
}

function glyphLimits(s: number): GlyphLimits {
  return {
    scale: s,
    minArea: Math.max(3, Math.round(6 * s * s)),
    minGlyphH: Math.max(3, Math.round(5 * s)),
    minRowH: Math.max(5, Math.round(8 * s)),
    maxGlyphH: Math.round(48 * s),
    maxGlyphW: Math.round(260 * s),
  }
}

function glyphLike(c: Component, l: GlyphLimits): boolean {
  const cw = c.x1 - c.x0 + 1
  const ch = c.y1 - c.y0 + 1
  if (c.area < l.minArea) return false
  if (c.touchesBorder) return false
  if (ch > l.maxGlyphH || cw > l.maxGlyphW) return false
  // Very sparse large boxes are outlines of background shapes, not glyphs.
  if (cw * ch > 400 * l.scale * l.scale && c.area / (cw * ch) < 0.06) return false
  // Glyphs have a solid bright core.
  if (c.strong < c.area * 0.3) return false
  return true
}

const cy = (c: Component) => (c.y0 + c.y1) / 2
const ch = (c: Component) => c.y1 - c.y0 + 1

/**
 * Keep only components that form subtitle text: rows of several glyphs of
 * similar height on a shared baseline, packed horizontally, stacked tightly if
 * there are several lines, and (optionally) centered in the crop. Background
 * clutter that survives the pixel tests (gravel, fabric folds, foliage) and HUD
 * text at the sides rarely forms such a row.
 */
function filterLayout(comps: Component[], l: GlyphLimits, cropW: number, centered: boolean): Band[] {
  const kept = comps.filter((c) => c.keep)
  if (kept.length === 0) return []

  // 1. Cluster into rows by vertical center, using "solid" components (not
  //    punctuation or specks) to define the rows.
  const solid = kept.filter((c) => ch(c) >= l.minGlyphH && c.area >= l.minArea * 2)
  solid.sort((a, b) => cy(a) - cy(b))
  interface Row {
    comps: Component[]
    y0: number
    y1: number
    x0: number
    x1: number
    h: number
    score: number
    /** Ink per glyph scanline relative to row height: separates bold objective text from regular dialogue. */
    weight: number
  }
  const rows: Row[] = []
  for (const c of solid) {
    const row = rows.find((r) => cy(c) >= r.y0 - 2 * l.scale && cy(c) <= r.y1 + 2 * l.scale)
    if (row) {
      row.comps.push(c)
      row.y0 = Math.min(row.y0, c.y0)
      row.y1 = Math.max(row.y1, c.y1)
    } else {
      rows.push({ comps: [c], y0: c.y0, y1: c.y1, x0: 0, x1: 0, h: 0, score: 0, weight: 0 })
    }
  }

  // Count glyphs that look like letters of this row: decent fill, height
  // close to the row median, bottom on the shared baseline.
  const textScore = (glyphs: Component[], med: number): number => {
    if (med < l.minRowH || glyphs.length === 0) return 0
    const bottoms = glyphs.map((c) => c.y1).sort((a, b) => a - b)
    const base = bottoms[Math.floor(bottoms.length / 2)]
    const tol = Math.max(2, med * 0.2)
    return glyphs.filter(
      (c) =>
        c.area / ((c.x1 - c.x0 + 1) * ch(c)) >= 0.15 &&
        Math.abs(c.y1 - base) <= tol &&
        ch(c) >= med * 0.6 &&
        ch(c) <= med * 1.6,
    ).length
  }

  // 2. Split each row into horizontal runs (word gaps are well under 2.2
  //    glyph heights), start from the heaviest run and absorb neighbouring
  //    text-like runs across small holes (a word lost over a bright
  //    background). Isolated runs far away (HUD) are dropped.
  for (const row of rows) {
    const hs = row.comps.map(ch).sort((a, b) => a - b)
    const med = hs[Math.floor(hs.length / 2)]
    const glyphs = row.comps.filter((c) => ch(c) >= med * 0.45 && ch(c) <= med * 1.9)
    glyphs.sort((a, b) => a.x0 - b.x0)
    const maxGap = Math.max(med * 2.2, 10 * l.scale)
    const runs: { comps: Component[]; x0: number; x1: number; area: number; score: number }[] = []
    for (const c of glyphs) {
      const run = runs[runs.length - 1]
      if (run && c.x0 - run.x1 <= maxGap) {
        run.comps.push(c)
        run.x1 = Math.max(run.x1, c.x1)
        run.area += c.area
      } else {
        runs.push({ comps: [c], x0: c.x0, x1: c.x1, area: c.area, score: 0 })
      }
    }
    for (const run of runs) run.score = textScore(run.comps, med)
    row.h = med
    if (runs.length === 0) continue
    let bi = 0
    for (let i = 1; i < runs.length; i++) if (runs[i].area > runs[bi].area) bi = i
    let lo = bi
    let hi = bi
    // A keyword lost in between (a colored word the pixel tests missed) can
    // leave a hole of about 8 characters.
    const absorbGap = med * 8
    for (;;) {
      const left = runs[lo - 1]
      const right = runs[hi + 1]
      if (left && left.score >= 2 && runs[lo].x0 - left.x1 <= absorbGap) lo--
      else if (right && right.score >= 2 && right.x0 - runs[hi].x1 <= absorbGap) hi++
      else break
    }
    const chosen = runs.slice(lo, hi + 1).flatMap((r) => r.comps)
    row.comps = chosen
    row.y0 = Math.min(...chosen.map((c) => c.y0))
    row.y1 = Math.max(...chosen.map((c) => c.y1))
    row.x0 = Math.min(...chosen.map((c) => c.x0))
    row.x1 = Math.max(...chosen.map((c) => c.x1))
    row.score = textScore(chosen, med)
    const hSum = chosen.reduce((s, c) => s + ch(c), 0)
    row.weight = hSum > 0 ? chosen.reduce((s, c) => s + c.area, 0) / hSum / Math.max(1, med) : 0
  }

  // 3. Group text rows into blocks (rows stacked tightly with a similar height: one subtitle card or
  //    one objective line), then keep the best block plus, if present, one more clear block. Games draw
  //    the mission objective as its own block under the dialogue; keeping only the best row would drop
  //    one of them or merge both into one line.
  const isCentered = (r: Row) => Math.abs((r.x0 + r.x1) / 2 - cropW / 2) <= cropW * 0.12 + r.h
  const good = rows.filter((r) => r.comps.length >= 2 && r.score >= 2 && (!centered || isCentered(r)))
  const keepRows = new Set<Row>()
  const bands: Band[] = []
  if (good.length) {
    const byY = [...good].sort((a, b) => a.y0 - b.y0)
    const groups: Row[][] = []
    for (const r of byY) {
      const g = groups[groups.length - 1]
      const prev = g?.[g.length - 1]
      const similar = prev && r.h >= prev.h * 0.6 && r.h <= prev.h * 1.6
      // Same weight too: a bold objective line under regular dialogue is a separate block.
      // (Objective text is about 1.9x the weight of dialogue; short rows of one word vary more.)
      const sameWeight = prev && prev.weight > 0 && r.weight / prev.weight >= 0.65 && r.weight / prev.weight <= 1.55
      if (prev && similar && sameWeight && r.y0 - prev.y1 <= Math.max(prev.h, r.h) * 1.6) g.push(r)
      else groups.push([r])
    }
    const scored = groups
      .map((g) => {
        const top = Math.max(...g.map((r) => r.score))
        const rowsKept = g.filter((r) => r.score >= Math.min(3, top))
        return { rows: rowsKept, top, score: rowsKept.reduce((s, r) => s + r.score, 0) }
      })
      .sort((a, b) => b.score - a.score)
    const chosen = [scored[0], ...scored.slice(1).filter((s) => s.top >= 3).slice(0, 1)]
    for (const blk of chosen) {
      for (const r of blk.rows) keepRows.add(r)
      const hs = blk.rows.map((r) => r.h).sort((a, b) => a - b)
      bands.push({
        y0: Math.min(...blk.rows.map((r) => r.y0)),
        y1: Math.max(...blk.rows.map((r) => r.y1)),
        h: hs[Math.floor(hs.length / 2)],
      })
    }
    bands.sort((a, b) => a.y0 - b.y0)
  }

  // 4. Keep glyphs of kept rows, plus small marks (dots, commas, apostrophes)
  //    that sit inside or right next to a kept row's horizontal span.
  const keepSet = new Set<Component>()
  for (const r of keepRows) for (const c of r.comps) keepSet.add(c)
  const rowsArr = [...keepRows]
  // Tiny marks (an i dot at 720p is 2 to 4 pixels) were dropped as specks
  // by glyphLike; they come back here if they sit next to a text row.
  for (const c of comps) {
    if (keepSet.has(c)) continue
    if (ch(c) > l.maxGlyphH * 0.5 || c.touchesBorder) continue
    if (!c.keep && (c.area < 2 || c.area >= l.minArea * 3 || c.strong < c.area * 0.3)) continue
    const near = rowsArr.some(
      (row) =>
        c.y1 >= row.y0 - row.h * 0.6 &&
        c.y0 <= row.y1 + row.h * 0.5 &&
        c.x1 >= row.x0 - row.h &&
        c.x0 <= row.x1 + row.h,
    )
    if (near) keepSet.add(c)
  }
  for (const c of comps) c.keep = keepSet.has(c)
  return bands
}

/** Vertical extent of one kept text block (rows only, before marks above and below). */
interface Band {
  y0: number
  y1: number
  /** Median row height. */
  h: number
}

/**
 * Downsample the mask into a SIGNATURE_COLS x SIGNATURE_ROWS grid of ink
 * densities (0..1 per cell). Cells are roughly one glyph wide, so two
 * different lines of the same length still differ, while the same line on a
 * changing background stays close.
 */
export function computeSignature(mask: Uint8Array, w: number, h: number): Float32Array {
  const sig = new Float32Array(SIGNATURE_COLS * SIGNATURE_ROWS)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(SIGNATURE_ROWS - 1, Math.floor((y * SIGNATURE_ROWS) / h))
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      const sx = Math.min(SIGNATURE_COLS - 1, Math.floor((x * SIGNATURE_COLS) / w))
      sig[sy * SIGNATURE_COLS + sx]++
    }
  }
  const cellArea = (w / SIGNATURE_COLS) * (h / SIGNATURE_ROWS)
  for (let i = 0; i < sig.length; i++) sig[i] = Math.min(1, sig[i] / cellArea)
  return sig
}

/**
 * Difference between two signatures as normalized L1 distance
 * (0 = same, 1 = no overlap).
 */
export function signatureDistance(a: Float32Array | null, b: Float32Array | null): number {
  if (!a || !b) return a === b ? 0 : 1
  let diff = 0
  let total = 0
  for (let i = 0; i < a.length; i++) {
    diff += Math.abs(a[i] - b[i])
    total += a[i] + b[i]
  }
  return total === 0 ? 0 : diff / total
}

/**
 * Fraction of `prev` ink still present in `next`. Near 1 with more ink in
 * `next` means the text grew (word-by-word reveal).
 */
export function signatureContainment(prev: Float32Array, next: Float32Array): number {
  let p = 0
  let both = 0
  for (let i = 0; i < prev.length; i++) {
    p += prev[i]
    both += Math.min(prev[i], next[i])
  }
  return p === 0 ? 0 : both / p
}

/** Total ink mass of a signature. */
export function signatureMass(sig: Float32Array): number {
  let c = 0
  for (let i = 0; i < sig.length; i++) c += sig[i]
  return c
}

/**
 * Render kept ink as dark anti-aliased text on white, cropped to the ink and
 * scaled so the median glyph height becomes `targetTextHeight`.
 */
export function renderForOcr(a: CropAnalysis, lumaThreshold: number, targetTextHeight: number): GrayImage | null {
  if (!a.bbox) return null
  const { width: w, mask, value } = a
  const pad = 4
  const bx0 = Math.max(0, a.bbox.x0 - pad)
  const by0 = Math.max(0, a.bbox.y0 - pad)
  const bx1 = Math.min(a.width - 1, a.bbox.x1 + pad)
  const by1 = Math.min(a.height - 1, a.bbox.y1 + pad)
  const sw = bx1 - bx0 + 1
  const sh = by1 - by0 + 1

  // Darkness per source pixel. Only kept ink is drawn: a fringe around it
  // would pull in bright background next to the glyph. Bilinear upscaling
  // below restores smooth edges.
  const lo = lumaThreshold - 70
  const hi = Math.min(245, lumaThreshold + 25)
  const dark = new Float32Array(sw * sh)
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (by0 + y) * w + bx0 + x
      if (!mask[i]) continue
      const t = (value[i] - lo) / (hi - lo)
      dark[y * sw + x] = t <= 0 ? 0 : t >= 1 ? 1 : t
    }
  }

  const scale = Math.min(4, Math.max(1, targetTextHeight / Math.max(1, a.glyphHeight)))
  const margin = Math.round(12 * scale)
  const ow = Math.round(sw * scale) + margin * 2
  const oh = Math.round(sh * scale) + margin * 2
  const out = new Uint8Array(ow * oh).fill(255)
  for (let oy = 0; oy < oh - 2 * margin; oy++) {
    const fy = (oy + 0.5) / scale - 0.5
    const y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)))
    const y1 = Math.min(sh - 1, y0 + 1)
    const ty = Math.max(0, Math.min(1, fy - y0))
    for (let ox = 0; ox < ow - 2 * margin; ox++) {
      const fx = (ox + 0.5) / scale - 0.5
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(fx)))
      const x1 = Math.min(sw - 1, x0 + 1)
      const tx = Math.max(0, Math.min(1, fx - x0))
      const d =
        dark[y0 * sw + x0] * (1 - tx) * (1 - ty) +
        dark[y0 * sw + x1] * tx * (1 - ty) +
        dark[y1 * sw + x0] * (1 - tx) * ty +
        dark[y1 * sw + x1] * tx * ty
      out[(oy + margin) * ow + ox + margin] = Math.round(255 * (1 - d))
    }
  }
  return { data: out, width: ow, height: oh }
}

/** Encode a gray image as binary PGM, which Tesseract reads directly. */
export function encodePgm(img: GrayImage): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${img.width} ${img.height}\n255\n`)
  const out = new Uint8Array(header.length + img.data.length)
  out.set(header, 0)
  out.set(img.data, header.length)
  return out
}

// ---------------------------------------------------------------------------
// DOM helpers (browser only)
// ---------------------------------------------------------------------------

type Canvas2D = HTMLCanvasElement | OffscreenCanvas
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h)
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  return c
}

function ctx2d(c: Canvas2D): Ctx2D {
  const ctx = c.getContext("2d", { willReadFrequently: true }) as Ctx2D | null
  if (!ctx) throw new Error("2D canvas not available")
  return ctx
}

export function frameSize(frame: FrameImage): { width: number; height: number } {
  if (typeof HTMLVideoElement !== "undefined" && frame instanceof HTMLVideoElement) {
    return { width: frame.videoWidth, height: frame.videoHeight }
  }
  return { width: frame.width, height: frame.height }
}

/** Region in whole frame pixels, clamped to the frame. */
export function regionToPixels(region: Region, fw: number, fh: number): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(fw - 1, Math.round(region.x * fw)))
  const y = Math.max(0, Math.min(fh - 1, Math.round(region.y * fh)))
  const w = Math.max(1, Math.min(fw - x, Math.round(region.w * fw)))
  const h = Math.max(1, Math.min(fh - y, Math.round(region.h * fh)))
  return { x, y, w, h }
}

export interface CropResult {
  image: ImageData
  canvas: Canvas2D
  frameWidth: number
  frameHeight: number
}

/** Crop the region from a frame at native resolution. Reuses `target` if given. */
export function cropRegion(frame: FrameImage, region: Region, target?: Canvas2D): CropResult {
  const { width: fw, height: fh } = frameSize(frame)
  const px = regionToPixels(region, fw, fh)
  const canvas = target ?? makeCanvas(px.w, px.h)
  if (canvas.width !== px.w || canvas.height !== px.h) {
    canvas.width = px.w
    canvas.height = px.h
  }
  const ctx = ctx2d(canvas)
  ctx.drawImage(frame, px.x, px.y, px.w, px.h, 0, 0, px.w, px.h)
  return { image: ctx.getImageData(0, 0, px.w, px.h), canvas, frameWidth: fw, frameHeight: fh }
}

/** Draw a gray image into a canvas (for the setup UI preview). */
export function grayToCanvas(img: GrayImage, target?: Canvas2D): Canvas2D {
  const canvas = target ?? makeCanvas(img.width, img.height)
  if (canvas.width !== img.width || canvas.height !== img.height) {
    canvas.width = img.width
    canvas.height = img.height
  }
  const ctx = ctx2d(canvas)
  const out = ctx.createImageData(img.width, img.height)
  for (let i = 0, j = 0; i < img.data.length; i++, j += 4) {
    const v = img.data[i]
    out.data[j] = v
    out.data[j + 1] = v
    out.data[j + 2] = v
    out.data[j + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

export interface PreprocessResult {
  analysis: CropAnalysis
  /** The dialogue block's OCR image (or the only block's), for previews. */
  ocrImage: GrayImage | null
  /** Every block to read, with its kind. */
  reads: ReadBlock[]
  crop: Canvas2D
}

/**
 * Adaptive ink detection (two passes).
 *
 * Subtitle brightness varies a lot: GTA V draws pure white text with a thick
 * outline, GTA 6 thin light-gray text with no outline, and a capture card in
 * limited range or HDR tone mapping makes everything darker. A fixed threshold
 * either drops thin strokes (letters vanish: "Well,.hank you") or misses the
 * text entirely. So the first pass finds text with a loose threshold, then the
 * real ink brightness is measured on the pixels it kept, and the second pass
 * runs with the threshold placed a fixed margin below that brightness.
 *
 * Tuned on GTA 6 footage (scripts/ocr-bench): character error rate 15.7% with
 * a fixed threshold of 190, about 1% with this, and it holds up on
 * limited-range and 12% darker captures where any fixed threshold collapses.
 */
export const ADAPTIVE = {
  /** Threshold of the search pass. */
  searchT: 120,
  /** Second-pass threshold sits this far below the measured ink brightness. */
  margin: 80,
  /** Percentile of kept ink brightness taken as the ink's level. */
  percentile: 0.9,
  minT: 90,
  maxT: 200,
} as const

export interface AdaptiveAnalysis {
  analysis: CropAnalysis
  /** Threshold the returned analysis used. */
  threshold: number
  /** Measured ink brightness (255 when nothing was found). */
  inkPeak: number
}

/** Brightness of the kept ink: a high percentile of `value` over the mask. */
export function measureInk(a: CropAnalysis, percentile: number = ADAPTIVE.percentile): number {
  const hist = new Uint32Array(256)
  let n = 0
  for (let i = 0; i < a.mask.length; i++) {
    if (a.mask[i]) {
      hist[a.value[i]]++
      n++
    }
  }
  if (n === 0) return 255
  const target = Math.floor(n * percentile)
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc > target) return v
  }
  return 255
}

export function analyzeAdaptive(img: RgbaImage, settings: AnalyzeSettings, frameHeight: number): AdaptiveAnalysis {
  const search = analyzeCrop(img, { ...settings, lumaThreshold: ADAPTIVE.searchT }, frameHeight)
  const searchT: number = ADAPTIVE.searchT
  if (!search.bbox) return { analysis: search, threshold: searchT, inkPeak: 255 }
  const peak = measureInk(search)
  const T = Math.max(ADAPTIVE.minT, Math.min(ADAPTIVE.maxT, peak - ADAPTIVE.margin))
  if (Math.abs(T - searchT) <= 5) return { analysis: search, threshold: searchT, inkPeak: peak }
  const fine = analyzeCrop(img, { ...settings, lumaThreshold: T }, frameHeight, peak)
  // Keep the fine pass unless it lost text the search pass had.
  if (!fine.bbox || fine.blocks.length < search.blocks.length) return { analysis: search, threshold: searchT, inkPeak: peak }
  return { analysis: fine, threshold: T, inkPeak: peak }
}

export type BlockKind = "dialogue" | "objective"

/**
 * Objective lines are bold. Measured on GTA 6: dialogue blocks have a stroke of 0.13 to 0.23 (0.28 over a
 * blown-out background), objective lines 0.32 to 0.40.
 */
export const OBJECTIVE_STROKE = 0.27
/** A lone bold block counts as an objective only this low in the region (objectives sit under dialogue). */
export const OBJECTIVE_MIN_CENTER = 0.72

/**
 * Which kept blocks are dialogue and which the mission objective. With two blocks the lower one is the
 * objective if it is clearly bolder (GTA 6 draws the objective bold under the subtitle); otherwise the
 * heavier block is the dialogue and the other is ignored. A lone block is an objective when it is bold
 * and sits in the lower part of the region.
 */
export function classifyBlocks(blocks: TextBlock[], cropH: number): (BlockKind | null)[] {
  if (blocks.length === 0) return []
  if (blocks.length === 1) {
    const b = blocks[0]
    const center = (b.bbox.y0 + b.bbox.y1) / 2 / Math.max(1, cropH)
    return [b.stroke >= OBJECTIVE_STROKE && center >= OBJECTIVE_MIN_CENTER ? "objective" : "dialogue"]
  }
  const [top, bottom] = blocks
  if (bottom.stroke >= Math.max(OBJECTIVE_STROKE, top.stroke * 1.3)) return ["dialogue", "objective"]
  // Neither is the bold line: two speakers' cards drawn a little apart. Both are dialogue (merged later).
  return ["dialogue", "dialogue"]
}

/** Two blocks of the same kind read as one (top to bottom). */
function mergeBlocks(a: TextBlock, b: TextBlock): TextBlock {
  const ink = a.ink + b.ink
  return {
    y0: Math.min(a.y0, b.y0),
    y1: Math.max(a.y1, b.y1),
    bbox: {
      x0: Math.min(a.bbox.x0, b.bbox.x0),
      y0: Math.min(a.bbox.y0, b.bbox.y0),
      x1: Math.max(a.bbox.x1, b.bbox.x1),
      y1: Math.max(a.bbox.y1, b.bbox.y1),
    },
    glyphHeight: Math.round((a.glyphHeight * a.ink + b.glyphHeight * b.ink) / ink),
    ink,
    stroke: (a.stroke * a.ink + b.stroke * b.ink) / ink,
    colorRatio: (a.colorRatio * a.ink + b.colorRatio * b.ink) / ink,
  }
}

/** A block ready for OCR. */
export interface ReadBlock {
  kind: BlockKind
  analysis: CropAnalysis
  image: GrayImage | null
  /** True when the block itself looked like an objective (bold), not only by position. */
  boldObjective: boolean
}

/** Rows of the crop where objectives were seen (learned by the reader). */
export interface ObjectiveBand {
  y0: number
  y1: number
}

/** A block rebuilt from mask rows y0..y1 (used to cut a merged block at the objective band). */
function blockFromRows(a: CropAnalysis, src: TextBlock, y0: number, y1: number): TextBlock | null {
  const w = a.width
  let bx0 = w
  let by0 = a.height
  let bx1 = -1
  let by1 = -1
  let ink = 0
  let runs = 0
  for (let y = Math.max(0, y0); y <= Math.min(a.height - 1, y1); y++) {
    let inRun = false
    for (let x = 0; x < w; x++) {
      if (!a.mask[y * w + x]) {
        inRun = false
        continue
      }
      ink++
      if (!inRun) runs++
      inRun = true
      if (x < bx0) bx0 = x
      if (x > bx1) bx1 = x
      if (y < by0) by0 = y
      if (y > by1) by1 = y
    }
  }
  if (ink < 20) return null
  return {
    y0,
    y1,
    bbox: { x0: bx0, y0: by0, x1: bx1, y1: by1 },
    glyphHeight: src.glyphHeight,
    ink,
    stroke: runs > 0 ? ink / runs / Math.max(1, src.glyphHeight) : 0,
    colorRatio: src.colorRatio,
  }
}

/**
 * Apply a learned objective band. While an objective fades in or out it isn't bold yet, so on its own it
 * would read as dialogue, or merge into the dialogue block above it. A block centered in the band is the
 * objective; a block reaching from above into the band is cut at the band's top.
 */
function applyBand(a: CropAnalysis, blocks: TextBlock[], kinds: (BlockKind | null)[], band: ObjectiveBand) {
  const pad = Math.max(2, Math.round((band.y1 - band.y0) * 0.35))
  const top = band.y0 - pad
  const outBlocks: TextBlock[] = []
  const outKinds: (BlockKind | null)[] = []
  blocks.forEach((b, i) => {
    const center = (b.bbox.y0 + b.bbox.y1) / 2
    if (center >= top && center <= band.y1 + pad) {
      outBlocks.push(b)
      outKinds.push("objective")
      return
    }
    const reachesIn = b.bbox.y1 > band.y0 + (band.y1 - band.y0) * 0.5 && b.bbox.y0 < top
    if (reachesIn) {
      const upper = blockFromRows(a, b, b.y0, top - 1)
      const lower = blockFromRows(a, b, top, b.y1)
      if (upper) {
        outBlocks.push(upper)
        outKinds.push(kinds[i] === "objective" ? "dialogue" : kinds[i])
      }
      if (lower) {
        outBlocks.push(lower)
        outKinds.push("objective")
      }
      return
    }
    outBlocks.push(b)
    outKinds.push(kinds[i])
  })
  return { blocks: outBlocks, kinds: outKinds }
}

/** Analyze and render a crop with the configured mode (adaptive or a fixed threshold). */
export function analyzeAndRender(
  img: RgbaImage,
  settings: Pick<EngineSettings, "lumaThreshold" | "colorInk" | "minContrast" | "centeredText" | "targetTextHeight" | "adaptiveInk">,
  frameHeight: number,
  objectiveBand?: ObjectiveBand | null,
): { analysis: CropAnalysis; ocrImage: GrayImage | null; reads: ReadBlock[] } {
  let analysis: CropAnalysis
  let threshold: number
  if (settings.adaptiveInk) {
    const r = analyzeAdaptive(img, settings, frameHeight)
    analysis = r.analysis
    threshold = r.threshold
  } else {
    analysis = analyzeCrop(img, settings, frameHeight)
    threshold = settings.lumaThreshold
  }
  let blocks = analysis.blocks
  let kinds = classifyBlocks(blocks, analysis.height)
  const bold = new Set(blocks.filter((_, i) => kinds[i] === "objective"))
  if (objectiveBand) ({ blocks, kinds } = applyBand(analysis, blocks, kinds, objectiveBand))
  const byKind = new Map<BlockKind, { block: TextBlock; bold: boolean }>()
  blocks.forEach((b, i) => {
    const kind = kinds[i]
    if (!kind) return
    const prev = byKind.get(kind)
    byKind.set(kind, prev ? { block: mergeBlocks(prev.block, b), bold: prev.bold || bold.has(b) } : { block: b, bold: bold.has(b) })
  })
  const reads: ReadBlock[] = []
  for (const [kind, { block, bold: isBold }] of byKind) {
    const one = blockAnalysis(analysis, block)
    reads.push({ kind, analysis: one, image: renderForOcr(one, threshold, settings.targetTextHeight), boldObjective: isBold })
  }
  const dialogue = reads.find((r) => r.kind === "dialogue")
  return { analysis, ocrImage: (dialogue ?? reads[0])?.image ?? null, reads }
}

/** Crop, analyze and render in one call. */
export function preprocessFrame(
  frame: FrameImage,
  settings: Pick<
    EngineSettings,
    "region" | "lumaThreshold" | "colorInk" | "minContrast" | "centeredText" | "targetTextHeight" | "adaptiveInk"
  >,
  cropTarget?: Canvas2D,
  objectiveBand?: ObjectiveBand | null,
): PreprocessResult {
  const crop = cropRegion(frame, settings.region, cropTarget)
  const { analysis, ocrImage, reads } = analyzeAndRender(crop.image, settings, crop.frameHeight, objectiveBand)
  return { analysis, ocrImage, reads, crop: crop.canvas }
}
