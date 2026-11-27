import { createFileRoute } from "@tanstack/react-router"
import { dbReady } from "@/server/db"
import { noteReport, type OverlayPhase } from "@/server/live-status"
import { profileByOverlayToken } from "@/server/overlay"
import { allow, tooMany } from "@/server/rate-limit"

const PHASES: OverlayPhase[] = ["loading", "obs_connecting", "obs_error", "running", "blocked", "not_found"]

/** The overlay reports what it is doing every few seconds; the panel shows it. */
export const Route = createFileRoute("/api/overlay/$token/status")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        // Sent every 5 s and on each status change.
        if (!allow(`status:${params.token}`, 40, 60_000)) return tooMany()
        await dbReady
        const profile = await profileByOverlayToken(params.token)
        if (!profile) return Response.json({ error: "not_found" }, { status: 404 })
        const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
        const phase = PHASES.includes(b?.phase as OverlayPhase) ? (b!.phase as OverlayPhase) : "loading"
        const lastRead = b?.lastRead as { text?: unknown; at?: unknown } | undefined
        noteReport(params.token, {
          phase,
          message: typeof b?.message === "string" ? b.message.slice(0, 300) : undefined,
          source: typeof b?.source === "string" ? b.source.slice(0, 120) : undefined,
          sourceIsScene: typeof b?.sourceIsScene === "boolean" ? b.sourceIsScene : undefined,
          frames: typeof b?.frames === "number" ? b.frames : undefined,
          lastRead:
            lastRead && typeof lastRead.text === "string" && typeof lastRead.at === "number"
              ? { text: lastRead.text.slice(0, 300), at: lastRead.at }
              : undefined,
        })
        return new Response(null, { status: 204 })
      },
    },
  },
})
