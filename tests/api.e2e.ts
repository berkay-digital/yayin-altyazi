import { expect } from "e2e"
import { test } from "./support/fixtures.ts"

test("health reports the database and the translation backend", async ({ request }) => {
  const res = await request.get("/api/health")
  expect(res).toBeOK()
  expect(await res.json()).toEqual({ ok: true, db: true, translate: true })
})

test("the line API translates, caches and rejects bad input", async ({ newAccount, links, request }) => {
  void newAccount
  const line = `/api/overlay/${links.overlayToken}/line`

  const first = await request.post(line, { json: { en: "You sure about this guy?" } })
  expect(first).toBeOK()
  expect(await first.json()).toMatchObject({ tr: "Bu adamdan emin misin?", cached: false })

  // The same line again comes from the shared cache.
  const again = await request.post(line, { json: { en: "You sure about this guy?" } })
  expect(await again.json()).toMatchObject({ tr: "Bu adamdan emin misin?", cached: true })

  // An early read starts the work but returns no text.
  const early = await request.post(line, { json: { en: "Hold on. We need to talk before we go in.", provisional: true } })
  expect(early.status).toBe(202)
  expect(await early.json()).not.toHaveProperty("tr")

  expect((await request.post(line, { json: { en: "   " } })).status).toBe(400)
  expect((await request.post("/api/overlay/not-a-real-token/line", { json: { en: "Hello" } })).status).toBe(404)
  expect((await request.get("/api/overlay/not-a-real-token")).status).toBe(404)
})
