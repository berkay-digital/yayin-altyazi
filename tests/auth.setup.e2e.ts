import { expect } from "e2e"
import { newEmail, PASSWORD, test } from "./support/fixtures.ts"

/** One streamer account that most tests reuse through `{ session: "streamer" }`. */
test.setup("sign up the streamer account", { sessions: ["streamer"] }, async ({ app, screen, browser, session }) => {
  await app.open("/giris")
  await screen.getByLabel("Yayıncı adın").fill("Yayıncı")
  await screen.getByLabel("E-posta").fill(newEmail("streamer"))
  await screen.getByLabel("Şifre").fill(PASSWORD)
  await screen.getByRole("button", "Hesap aç").tap()

  await expect(browser).toHaveURL(/\/panel/)
  await expect(screen.getByRole("heading", "Canlı durum")).toBeVisible()
  await session.save("streamer")
})
