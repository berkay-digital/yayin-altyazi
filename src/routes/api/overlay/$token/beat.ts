import { createFileRoute } from "@tanstack/react-router"
import { dbReady } from "@/server/db"
import { handleBeat } from "@/server/overlay"
import { allow, tooMany } from "@/server/rate-limit"

export const Route = createFileRoute("/api/overlay/$token/beat")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        if (!allow(`beat:${params.token}`, 6, 60_000)) return tooMany()
        await dbReady
        const r = await handleBeat(params.token)
        return Response.json(r.body, { status: r.status })
      },
    },
  },
})
