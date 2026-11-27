/** In-memory fan-out of live subtitle events to viewer pages (phone, second screen, OBS dock). */
export type LiveEvent =
  | { type: "line"; en: string; tr: string; at: number }
  /** The current mission objective, shown apart from dialogue. */
  | { type: "objective"; en: string; tr: string; at: number }
  | { type: "clear"; at: number }
  | { type: "status"; running: boolean; at: number }

type Client = (event: LiveEvent) => void

const g = globalThis as unknown as { __hub?: Map<string, Set<Client>>; __last?: Map<string, LiveEvent> }
const rooms = (g.__hub ??= new Map())
const last = (g.__last ??= new Map())

/** Objectives are remembered apart from dialogue so a new viewer gets both. */
const lastKey = (viewToken: string, event: LiveEvent) => (event.type === "objective" ? `${viewToken}:objective` : viewToken)

export function publish(viewToken: string, event: LiveEvent) {
  last.set(lastKey(viewToken, event), event)
  for (const send of rooms.get(viewToken) ?? []) send(event)
}

export function viewerCount(viewToken: string): number {
  return rooms.get(viewToken)?.size ?? 0
}

export function subscribe(viewToken: string, send: Client): () => void {
  let set = rooms.get(viewToken)
  if (!set) rooms.set(viewToken, (set = new Set()))
  set.add(send)
  const prev = last.get(viewToken)
  if (prev) send(prev)
  const objective = last.get(`${viewToken}:objective`)
  if (objective) send(objective)
  return () => {
    set.delete(send)
    if (set.size === 0) rooms.delete(viewToken)
  }
}

export function sseResponse(viewToken: string, request: Request): Response {
  const encoder = new TextEncoder()
  let cleanup = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s))
        } catch {
          cleanup()
        }
      }
      write("retry: 2000\n\n")
      const unsub = subscribe(viewToken, (e) => write(`data: ${JSON.stringify(e)}\n\n`))
      const ping = setInterval(() => write(": ping\n\n"), 20_000)
      cleanup = () => {
        clearInterval(ping)
        unsub()
      }
      request.signal.addEventListener("abort", () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      cleanup()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  })
}
