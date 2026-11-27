import { test as base } from "@e2e-dev/web"
import { expect } from "e2e"

export const PASSWORD = "e2e-password-123"

/** A unique address, so reruns against a server that is still up never collide. */
export function newEmail(prefix = "yayinci") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`
}

/** A made-up client address: sign-up allows only a few accounts per address an hour. */
function randomIp() {
  const n = () => 1 + Math.floor(Math.random() * 254)
  return `10.${n()}.${n()}.${n()}`
}

export type Links = { overlayToken: string; viewToken: string; overlayUrl: string; viewUrl: string }

export const test = base.extend<{
  /**
   * A fresh account, signed in, with the dashboard open. Created through the auth API so each one counts
   * against its own client address. The sign-up form itself is covered by auth.setup.e2e.ts and auth.e2e.ts.
   */
  newAccount: string
  /** The overlay and phone links of the signed-in account, read from the dashboard's first setup step. */
  links: Links
  /**
   * Serves tests/fixtures/subtitles.webm (two invented English lines burned in, looping every 12 s) and returns
   * the overlay query that plays it in place of OBS.
   */
  demoVideo: string
}>({
  newAccount: async ({ app, request, browser, screen }, use) => {
    const email = newEmail()
    const res = await request.post("/api/auth/sign-up/email", {
      json: { email, password: PASSWORD, name: "Test Yayıncı" },
      headers: { origin: app.baseUrl, "x-forwarded-for": randomIp() },
    })
    expect(res).toBeOK()
    const cookies = (res.headers["set-cookie"] ?? "").split("\n").filter(Boolean)
    expect(cookies.length).toBeGreaterThan(0)
    await browser.setCookies(
      cookies.map((line) => {
        const [pair] = line.split(";")
        const eq = pair!.indexOf("=")
        return { url: app.baseUrl, name: pair!.slice(0, eq).trim(), value: pair!.slice(eq + 1).trim(), httpOnly: true, sameSite: "Lax" as const }
      }),
    )
    await app.open("/panel")
    await expect(screen.getByRole("heading", "Canlı durum")).toBeVisible()
    await use(email)
  },

  links: async ({ app, screen }, use) => {
    await app.open("/panel#obs")
    await expect(screen.getByRole("heading", "OBS'e ekle")).toBeVisible()
    const overlayUrl = await screen.getByDisplayValue(/\/o\/[\w-]+$/).inputValue()
    const viewUrl = await screen.getByDisplayValue(/\/v\/[\w-]+$/).inputValue()
    await use({
      overlayUrl,
      viewUrl,
      overlayToken: overlayUrl.split("/o/")[1]!,
      viewToken: viewUrl.split("/v/")[1]!,
    })
  },

  demoVideo: async ({ browser }, use) => {
    // Match the path only: the overlay's own URL carries the video path in its query string.
    await browser.route(/^[^?]*\/e2e-fixtures\/subtitles\.webm(\?|$)/, (route) =>
      route.fulfill({ path: "tests/fixtures/subtitles.webm", contentType: "video/webm" }),
    )
    await use("?demo=/e2e-fixtures/subtitles.webm")
  },
})
