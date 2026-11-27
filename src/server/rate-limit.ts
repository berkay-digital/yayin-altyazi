/**
 * In-memory sliding-window limits (one app instance). Keys are like `line:<token>`.
 * Limits are set well above what a real overlay sends, so they only stop scripts and leaked links.
 */
const g = globalThis as unknown as { __rl?: Map<string, number[]>; __rlSweep?: number }
const hits = (g.__rl ??= new Map())

function sweep(now: number) {
  if (g.__rlSweep && now - g.__rlSweep < 60_000) return
  g.__rlSweep = now
  for (const [k, times] of hits) if (!times.length || now - times[times.length - 1] > 3_600_000) hits.delete(k)
}

/** True if the call is allowed (and counts it). */
export function allow(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  sweep(now)
  const times = (hits.get(key) ?? []).filter((t: number) => now - t < windowMs)
  if (times.length >= limit) {
    hits.set(key, times)
    return false
  }
  times.push(now)
  hits.set(key, times)
  return true
}

/** Count an event without limiting (e.g. unconfirmed early reads), and return how many fell in the window. */
export function count(key: string, windowMs: number): number {
  const now = Date.now()
  const times = (hits.get(key) ?? []).filter((t: number) => now - t < windowMs)
  times.push(now)
  hits.set(key, times)
  return times.length
}

export function peek(key: string, windowMs: number): number {
  const now = Date.now()
  return (hits.get(key) ?? []).filter((t: number) => now - t < windowMs).length
}

/**
 * Request headers that carry the client address, in order. CLIENT_IP_HEADER names the one your proxy
 * sets (cf-connecting-ip behind Cloudflare). Without it only x-forwarded-for is used, so a client can't
 * pick its own rate-limit key by sending a Cloudflare header to a server that isn't behind Cloudflare.
 */
export function clientIpHeaders(): string[] {
  const own = process.env.CLIENT_IP_HEADER?.trim().toLowerCase()
  return own && own !== "x-forwarded-for" ? [own, "x-forwarded-for"] : ["x-forwarded-for"]
}

export function clientIp(headers: Headers): string {
  for (const h of clientIpHeaders()) {
    const v = headers.get(h)?.split(",")[0]?.trim()
    if (v) return v
  }
  return "unknown"
}

export const tooMany =() => Response.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "30" } })
