import Anthropic from "@anthropic-ai/sdk"

/**
 * One or two Claude API keys behind one client.
 *
 * With only ANTHROPIC_API_KEY set, that key serves everything. With ANTHROPIC_API_KEY_PRIMARY also set
 * (for example a key from a second organization), the primary serves every request while it can and
 * ANTHROPIC_API_KEY takes over only while the primary can't: rate limited, out of credit or spend limit,
 * key refused, or Anthropic keeps failing. Routing is sticky: a failing key rests for a while and the
 * other serves meanwhile, so requests don't bounce between keys. Errors that aren't about the key are
 * raised at once, because the other key would fail the same way.
 */

type FailKind = "rate" | "exhausted" | "auth" | "server"

/** Seconds a key rests after each kind of failure. */
const REST: Record<FailKind, number> = { rate: 60, exhausted: 30 * 60, auth: 6 * 3600, server: 30 }
const MAX_RATE_REST = 5 * 60
const MAX_EXHAUSTED_REST = 6 * 3600
const EXHAUSTED = /credit balance|billing|spend limit|usage limit|api usage|reached your specified|insufficient/i

function classify(error: unknown): FailKind | null {
  if (error instanceof Anthropic.RateLimitError) return "rate"
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return EXHAUSTED.test(error.message) ? "exhausted" : "auth"
  }
  if (error instanceof Anthropic.APIConnectionError) return "server"
  if (error instanceof Anthropic.APIError && typeof error.status === "number") {
    if ([500, 502, 503, 504, 529].includes(error.status)) return "server"
    if ([400, 402, 403].includes(error.status) && EXHAUSTED.test(error.message)) return "exhausted"
  }
  return null
}

function retryAfter(error: unknown): number | null {
  if (!(error instanceof Anthropic.APIError)) return null
  const value = error.headers?.get?.("retry-after")
  const n = value ? Number(value) : NaN
  return Number.isFinite(n) ? n : null
}

class Key {
  restingUntil = 0
  reason: FailKind | null = null
  exhaustedStreak = 0
  lastError: string | null = null
  served = 0

  constructor(
    readonly name: "primary" | "backup",
    readonly client: Anthropic,
  ) {}

  ready(now: number) {
    return now >= this.restingUntil
  }

  rest(kind: FailKind, error: unknown, now: number) {
    let seconds = REST[kind]
    if (kind === "rate") seconds = Math.min(retryAfter(error) ?? seconds, MAX_RATE_REST)
    if (kind === "exhausted") {
      seconds = Math.min(REST.exhausted * 2 ** this.exhaustedStreak, MAX_EXHAUSTED_REST)
      this.exhaustedStreak++
    }
    this.restingUntil = now + seconds * 1000
    this.reason = kind
    this.lastError = `${error instanceof Error ? error.name : "Error"}: ${String(error instanceof Error ? error.message : error).slice(0, 160)}`
    return seconds
  }
}

class ClaudeRouter {
  current: string

  constructor(readonly keys: Key[]) {
    this.current = keys[0].name
  }

  create(params: Anthropic.MessageCreateParamsNonStreaming, options?: Anthropic.RequestOptions): Promise<Anthropic.Message> {
    return this.run((client) => client.messages.create(params, options))
  }

  private async run(call: (client: Anthropic) => Promise<Anthropic.Message>): Promise<Anthropic.Message> {
    const now = Date.now()
    const ready = this.keys.filter((k) => k.ready(now))
    // Every key resting: try the one whose rest ends first rather than fail outright.
    const order = ready.length ? ready : [...this.keys].sort((a, b) => a.restingUntil - b.restingUntil).slice(0, 1)
    let last: unknown = null
    for (const key of order) {
      try {
        const response = await call(key.client)
        key.served++
        key.exhaustedStreak = 0
        key.reason = null
        if (key.name !== this.current) {
          console.warn(`[claude] now serving from the ${key.name} key (was ${this.current})`)
          this.current = key.name
        }
        return response
      } catch (error) {
        const kind = classify(error)
        if (!kind) throw error
        const seconds = key.rest(kind, error, Date.now())
        console.warn(`[claude] ${key.name} key unavailable (${kind}), resting ${seconds}s: ${key.lastError}`)
        last = error
      }
    }
    throw last
  }

  status() {
    const now = Date.now()
    return this.keys.map((k) => ({
      key: k.name,
      ready: k.ready(now),
      restingS: Math.max(0, Math.round((k.restingUntil - now) / 1000)),
      reason: k.reason,
      served: k.served,
      lastError: k.lastError,
      current: k.name === this.current,
    }))
  }
}

const g = globalThis as unknown as { __claudeRouter?: ClaudeRouter | null }

/** The shared router, or null when no Claude key is configured. */
export function claudeRouter(): ClaudeRouter | null {
  if (g.__claudeRouter !== undefined) return g.__claudeRouter
  const primary = process.env.ANTHROPIC_API_KEY_PRIMARY?.trim() ?? ""
  const backup = process.env.ANTHROPIC_API_KEY?.trim() ?? ""
  const keys: Key[] = []
  // Live subtitles can't wait long: the primary gives up after one retry so a used-up primary hands over fast.
  if (primary) keys.push(new Key("primary", new Anthropic({ apiKey: primary, maxRetries: 1, timeout: 12_000 })))
  if (backup && backup !== primary) {
    keys.push(new Key(primary ? "backup" : "primary", new Anthropic({ apiKey: backup, maxRetries: 2, timeout: 12_000 })))
  }
  g.__claudeRouter = keys.length ? new ClaudeRouter(keys) : null
  return g.__claudeRouter
}

export const CLAUDE_MODEL = process.env.CLAUDE_MODEL?.trim() || "claude-haiku-5-5"
