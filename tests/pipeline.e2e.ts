import { expect } from "e2e"
import { test } from "./support/fixtures.ts"

const LINE_1 = "Dur bir. İçeri girmeden önce konuşmamız lazım."
const LINE_2 = "Bu adamdan emin misin?"

/**
 * The whole path a subtitle takes, with a video in place of OBS: the overlay's demo mode reads frames from
 * tests/fixtures/subtitles.webm (two invented English lines burned in, looping every 12 s), OCRs them in the
 * browser, the server translates through the mock model, and the Turkish line shows on the overlay, the
 * phone view and the dashboard's live status.
 */
test("a subtitle in the video reaches the overlay, the phone view and the live status", { session: "streamer" }, async ({ links, demoVideo, app, screen, browser }) => {
  test.setTimeout(180_000)

  // ?debug shows the overlay's state in a corner, which helps when this test fails.
  await app.open(`/o/${links.overlayToken}${demoVideo}&debug`)
  await expect(screen.getByText(/· running$/)).toBeVisible({ timeout: 30_000 })
  // OCR starts once the Tesseract worker has loaded, and each line needs a confirming read.
  await expect(screen.getByText(LINE_1)).toBeVisible({ timeout: 60_000 })
  await expect(screen.getByText(LINE_2)).toBeVisible({ timeout: 30_000 })

  // The phone view picks up the next lines as the video loops.
  await browser.newTab()
  await browser.goto(`/v/${links.viewToken}`)
  await expect(screen.getByText(/· canlı$/)).toBeVisible()
  await expect(screen.getByText(new RegExp(`^(${LINE_1}|${LINE_2})$`)).first()).toBeVisible({ timeout: 30_000 })

  await browser.newTab()
  await browser.goto("/panel")
  await expect(screen.getByRole("heading", "Canlı durum")).toBeVisible()
  await expect(screen.getByText("Overlay OBS'te açık")).toBeVisible({ timeout: 15_000 })
  await expect(screen.getByText("Altyazı okunuyor")).toBeVisible()
  await expect(screen.getByText("Çeviri yayında")).toBeVisible()
})
