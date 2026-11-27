import { createFileRoute } from "@tanstack/react-router"
import { sql } from "drizzle-orm"
import { db, dbReady } from "@/server/db"
import { claudeRouter } from "@/server/claude"
import { hostedTarget } from "@/server/translate"

/** For uptime checks: 200 when the database answers and a translation backend is configured and serving. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        let dbOk = false
        try {
          await dbReady
          await db.execute(sql`select 1`)
          dbOk = true
        } catch {
          dbOk = false
        }
        const router = claudeRouter()
        const translate = router ? router.status().some((k) => k.ready) : hostedTarget() !== null
        const ok = dbOk && translate
        return Response.json({ ok, db: dbOk, translate }, { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } })
      },
    },
  },
})
