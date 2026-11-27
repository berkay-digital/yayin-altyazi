/**
 * What each open overlay is doing right now, so the panel can show it instead of the stream.
 * The overlay reports its phase every few seconds; the server adds the last translated line and
 * the last translation problem it saw. In memory only: a restart forgets it until the next report.
 */

export type OverlayPhase = "loading" | "obs_connecting" | "obs_error" | "running" | "blocked" | "not_found"

export type OverlayReport = {
  phase: OverlayPhase
  /** Problem text for obs_error / blocked. */
  message?: string
  /** OBS source being captured. */
  source?: string
  /** The source is a scene, so it includes the overlay itself (the overlay can read its own text). */
  sourceIsScene?: boolean
  /** Frames grabbed since the overlay started. */
  frames?: number
  /** Last text the OCR read in the subtitle area, even if it wasn't sent. */
  lastRead?: { text: string; at: number }
}

export type LiveStatus = OverlayReport & {
  at: number
  lastLine?: { en: string; tr: string; at: number; ms: number; cached: boolean }
  lastError?: { en: string; code: string; at: number }
}

const g = globalThis as unknown as { __live?: Map<string, LiveStatus> }
const live = (g.__live ??= new Map())

export function noteReport(token: string, report: OverlayReport) {
  const prev = live.get(token)
  live.set(token, { ...prev, ...report, at: Date.now() })
}

export function noteLine(token: string, line: { en: string; tr: string; ms: number; cached: boolean }) {
  const prev = live.get(token) ?? { phase: "running" as const, at: Date.now() }
  live.set(token, { ...prev, lastLine: { ...line, at: Date.now() } })
}

export function noteLineError(token: string, en: string, code: string) {
  const prev = live.get(token) ?? { phase: "running" as const, at: Date.now() }
  live.set(token, { ...prev, lastError: { en, code, at: Date.now() } })
}

/** The overlay counts as connected if it reported in the last 20 seconds. */
export function liveStatus(token: string): (LiveStatus & { online: boolean }) | null {
  const s = live.get(token)
  if (!s) return null
  return { ...s, online: Date.now() - s.at < 20_000 }
}
