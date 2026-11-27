import { createFileRoute } from "@tanstack/react-router"
import { dbReady } from "@/server/db"
import { handleLine } from "@/server/overlay"
import { allow, tooMany } from "@/server/rate-limit"

export const Route = createFileRoute("/api/overlay/$token/line")({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        await dbReady
        const body = (await request.json().catch(() => null)) as { en?: unknown; kind?: unknown; provisional?: unknown } | null
        const en = typeof body?.en === "string" ? body.en.trim().slice(0, 400) : ""
        if (!en) return Response.json({ error: "empty" }, { status: 400 })
        const kind = body?.kind === "objective" ? "objective" : "dialogue"
        const provisional = body?.provisional === true
        // A real overlay sends a line every second or two at most (plus one early read each).
        if (!allow(`line:${provisional ? "p" : "c"}:${params.token}`, 90, 60_000)) return tooMany()
        const r = await handleLine(params.token, en, kind, provisional)
        return Response.json(r.body, { status: r.status })
      },
    },
  },
})
