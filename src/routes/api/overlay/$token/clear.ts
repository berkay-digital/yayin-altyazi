import { createFileRoute } from "@tanstack/react-router"
import { dbReady } from "@/server/db"
import { handleClear } from "@/server/overlay"
import { allow, tooMany } from "@/server/rate-limit"

export const Route = createFileRoute("/api/overlay/$token/clear")({
  server: {
    handlers: {
      POST: async ({ params }) => {
        if (!allow(`clear:${params.token}`, 60, 60_000)) return tooMany()
        await dbReady
        await handleClear(params.token)
        return new Response(null, { status: 204 })
      },
    },
  },
})
