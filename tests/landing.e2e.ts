import { expect } from "e2e"
import { test } from "./support/fixtures.ts"

test("landing page explains the project and links to the source", async ({ app, screen, browser }) => {
  await app.open("/")

  await expect(screen.getByRole("heading", /Oyun İngilizce/, { level: 1 })).toBeVisible()
  await expect(screen.getByRole("link", "Kaynak kodu")).toHaveAttribute("href", /github\.com\/berkay-digital\/yayin-altyazi$/)
  await expect(screen.getByRole("heading", "Kendi sunucunda çalıştır")).toBeVisible()
  // The project page has no pricing.
  await expect(screen.getByText(/₺/)).toHaveCount(0)

  await screen.getByRole("link", "Başla").first().tap()
  await expect(browser).toHaveURL(/\/giris$/)
  await expect(screen.getByRole("heading", "Hesabını aç")).toBeVisible()
})

test("unknown pages show the not-found page", async ({ app, screen }) => {
  await app.open("/boyle-bir-sayfa-yok")
  await expect(screen.getByRole("heading", "Bu sayfa yok.")).toBeVisible()
  await expect(screen.getByRole("link", "Ana sayfa")).toBeVisible()
})
