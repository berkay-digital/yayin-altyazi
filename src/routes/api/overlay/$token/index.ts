import { createFileRoute } from "@tanstack/react-router"
import { dbReady } from "@/server/db"
import { entitlementFor, profileByOverlayToken } from "@/server/overlay"
import { parseSettings } from "@/shared/settings"
import { allow, tooMany } from "@/server/rate-limit"

export const Route = createFileRoute("/api/overlay/$token/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // The overlay refreshes its config every 8 s.
        if (!allow(`config:${params.token}`, 30, 60_000)) return tooMany()
        await dbReady
        const profile = await profileByOverlayToken(params.token)
        if (!profile) return Response.json({ error: "not_found" }, { status: 404 })
        const entitlement = await entitlementFor(profile)
        return Response.json(
          { settings: parseSettings(profile.settings), entitlement },
          { headers: { "cache-control": "no-store" } },
        )
      },
    },
  },
})
