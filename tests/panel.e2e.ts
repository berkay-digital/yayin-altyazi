import { expect } from "e2e"
import { test } from "./support/fixtures.ts"

test("the dashboard walks through the four setup steps", { session: "streamer" }, async ({ app, screen }) => {
  await app.open("/panel")
  await expect(screen.getByRole("heading", "Canlı durum")).toBeVisible()

  await screen.getByRole("button", /OBS'e ekle/).tap()
  await expect(screen.getByRole("heading", "OBS'e ekle")).toBeVisible()
  await expect(screen.getByDisplayValue(/\/o\/[\w-]+$/)).toBeVisible()
  await expect(screen.getByRole("image", "Telefon ekranı için QR kod")).toBeVisible()

  await screen.getByRole("button", "Sonraki adım: Altyazı alanı").tap()
  await expect(screen.getByRole("heading", "Oyun görüntüsü ve altyazı alanı")).toBeVisible()
  await expect(screen.getByLabel("WebSocket adresi")).toHaveValue("ws://127.0.0.1:4455")

  await screen.getByRole("button", "Sonraki adım: Çeviri").tap()
  await expect(screen.getByRole("heading", "Çeviri")).toBeVisible()

  await screen.getByRole("button", "Sonraki adım: Görünüm").tap()
  await expect(screen.getByRole("heading", "Görünüm")).toBeVisible()
  await expect(screen.getByRole("button", "Sonraki adım", { exact: false })).toHaveCount(0)
})

test("without billing there is no plan, trial or price", { session: "streamer" }, async ({ app, screen }) => {
  await app.open("/panel")
  await screen.getByRole("button", "Kullanım").tap()
  await expect(screen.getByRole("heading", "Kullanım")).toBeVisible()
  await expect(screen.getByText("Paketin")).toHaveCount(0)
  await expect(screen.getByText("Deneme", { exact: false })).toHaveCount(0)
  await expect(screen.getByText(/₺/)).toHaveCount(0)
})

test("a style preset is saved and reaches the overlay", { session: "streamer" }, async ({ links, app, screen, request }) => {
  await app.open("/panel#gorunum")
  await expect(screen.getByRole("heading", "Görünüm")).toBeVisible()

  await screen.getByRole("button", "Sarı klasik").tap()
  await screen.getByRole("button", "Değişiklikleri kaydet").tap()
  await expect(screen.getByText("Kaydedildi")).toBeVisible()
  await expect(screen.getByRole("button", "Değişiklikleri kaydet")).toHaveCount(0)

  // The overlay loads its settings from the server.
  const res = await request.get(`/api/overlay/${links.overlayToken}`)
  expect(res).toBeOK()
  const config = await res.json<{ settings: { style: { textColor: string } }; entitlement: { active: boolean; plan: string } }>()
  expect(config.settings.style.textColor).toBe("#ffe14d")
  expect(config.entitlement).toMatchObject({ active: true, plan: "open" })
})

test("new links replace the old ones", async ({ newAccount, links, screen, request }) => {
  void newAccount
  await screen.getByRole("button", /Adresleri yenile/).tap()
  await expect(screen.getByText("Yeni adresler oluşturuldu. OBS'teki adresi güncelle.")).toBeVisible()
  await expect(screen.getByDisplayValue(links.overlayUrl)).toHaveCount(0)
  const fresh = await screen.getByDisplayValue(/\/o\/[\w-]+$/).inputValue()
  expect(fresh).not.toBe(links.overlayUrl)

  expect((await request.get(`/api/overlay/${links.overlayToken}`)).status).toBe(404)
  expect(await request.get(`/api/overlay/${fresh.split("/o/")[1]}`)).toBeOK()
})
