import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"
import { db, dbReady, schema } from "@/server/db"
import { sseResponse, viewerCount } from "@/server/hub"
import { allow, clientIp, tooMany } from "@/server/rate-limit"

/** Phone / second-screen live feed. Only for real view links, with a cap on open streams. */
export const Route = createFileRoute("/api/live/$viewToken")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const ip = clientIp(request.headers)
        if (!allow(`live:${ip}`, 30, 60_000)) return tooMany()
        await dbReady
        const [p] = await db.select({ id: schema.profile.userId }).from(schema.profile).where(eq(schema.profile.viewToken, params.viewToken))
        if (!p) return Response.json({ error: "not_found" }, { status: 404 })
        // A streamer's own phone, tablet and docks; far more means the link leaked.
        if (viewerCount(params.viewToken) >= 20) return tooMany()
        return sseResponse(params.viewToken, request)
      },
    },
  },
})
