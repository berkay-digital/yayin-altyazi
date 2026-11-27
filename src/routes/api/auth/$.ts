import { createFileRoute } from "@tanstack/react-router"
import { auth } from "@/server/auth"
import { dbReady } from "@/server/db"

async function handle({ request }: { request: Request }) {
  await dbReady
  return auth.handler(request)
}

export const Route = createFileRoute("/api/auth/$")({
  server: { handlers: { GET: handle, POST: handle } },
})
