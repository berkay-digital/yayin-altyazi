import { expect } from "e2e"
import { PASSWORD, test } from "./support/fixtures.ts"

test("a streamer signs up, signs out and signs back in", async ({ newAccount, app, screen, browser }) => {
  await screen.getByRole("button", "Çıkış yap").tap()
  await expect(browser).toHaveURL(/\/$/)

  // The dashboard needs a session.
  await app.open("/panel")
  await expect(browser).toHaveURL(/\/giris\?mod=giris/)
  await expect(screen.getByRole("heading", "Tekrar hoş geldin")).toBeVisible()

  await screen.getByLabel("E-posta").fill(newAccount)
  await screen.getByLabel("Şifre").fill("not-the-password")
  await screen.getByRole("button", "Giriş yap").tap()
  await expect(screen.getByText("E-posta veya şifre hatalı.")).toBeVisible()

  await screen.getByLabel("Şifre").fill(PASSWORD)
  await screen.getByRole("button", "Giriş yap").tap()
  await expect(browser).toHaveURL(/\/panel/)
  await expect(screen.getByText(newAccount)).toBeVisible()
})

test("sign-up refuses an address that already has an account", async ({ newAccount, app, screen, browser }) => {
  await screen.getByRole("button", "Çıkış yap").tap()
  await expect(browser).toHaveURL(/\/$/)
  await app.open("/giris")
  await screen.getByLabel("E-posta").fill(newAccount)
  await screen.getByLabel("Şifre").fill(PASSWORD)
  await screen.getByRole("button", "Hesap aç").tap()
  await expect(screen.getByText("Bu e-posta ile zaten bir hesap var. Giriş yap.")).toBeVisible()
})
