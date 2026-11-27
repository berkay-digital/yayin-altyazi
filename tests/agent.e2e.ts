import { expect, isAgentError } from "e2e"
import { test } from "./support/fixtures.ts"

/**
 * AI agent tests. The steps are plain-English goals; the agent reads the Turkish dashboard and finds its own way.
 *
 * - `agent.act` steps run on Claude Code (see e2e.config.ts). Once a step passes and a check after it holds,
 *   its actions are recorded in tests/e2e-cache and later runs replay them with no model call. CI replays
 *   them and fails if a recording no longer fits the UI; rerun locally to record it again.
 * - `agent.assert` is an AI judge and always runs live, so those tests skip in CI.
 */

type OverlayConfig = {
  settings: { style: { placement: string; fontSize: number; fontWeight: number; textColor: string } }
}

/** True for a clearly yellow hex color: strong red and green, little blue. */
function isYellow(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim())
  if (!m) return false
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16)) as [number, number, number]
  return r >= 200 && g >= 160 && b <= 140
}

test.describe("the agent drives the dashboard", { tags: ["agent"], timeout: 300_000 }, () => {
  test("restyles the subtitles from a plain request", async ({ newAccount, links, app, agent, screen, request }) => {
    void newAccount
    await app.open("/panel")

    await agent.act(
      "Open the appearance settings. Make the subtitles cover the English subtitle, use a large font size, " +
        "make the text bold and yellow, then save the changes.",
    )

    // The dashboard confirms the save, and nothing is left unsaved.
    await expect(screen.getByText("Kaydedildi")).toBeVisible()
    await expect(screen.getByRole("button", "Değişiklikleri kaydet")).toHaveCount(0)

    // What the overlay in OBS will load.
    const { settings } = await (await request.get(`/api/overlay/${links.overlayToken}`)).json<OverlayConfig>()
    expect(settings.style.placement).toBe("cover")
    expect(settings.style.fontSize).toBeGreaterThan(42)
    expect(settings.style.fontWeight).toBeGreaterThanOrEqual(700)
    expect(isYellow(settings.style.textColor)).toBe(true)
  })

  test("replaces leaked overlay links", async ({ newAccount, links, app, agent, screen, request }) => {
    void newAccount
    await app.open("/panel")

    await agent.act("My overlay link leaked on stream. Make new links so the old overlay link stops working.")

    await expect(screen.getByText("Yeni adresler oluşturuldu. OBS'teki adresi güncelle.")).toBeVisible()
    expect((await request.get(`/api/overlay/${links.overlayToken}`)).status).toBe(404)
  })
})

const judgeOptions = {
  tags: ["agent"],
  timeout: 300_000,
  ...(process.env.CI ? { skip: "agent.assert always calls a live model" } : {}),
}

test.describe("the AI judge checks what viewers see", judgeOptions, () => {
  test("the landing page tells a Turkish streamer what this is", async ({ app, agent }) => {
    await app.open("/")
    await agent.assert(
      "The page is in Turkish and explains that this adds live Turkish subtitles to console game streams through OBS, " +
        "that the game video stays on the streamer's computer, and that the project is open source and can run on your own server.",
    )
  })

  test("the overlay and phone view show a faithful Turkish translation", { session: "streamer" }, async ({ links, demoVideo, app, agent, screen, browser }) => {
    await app.open(`/o/${links.overlayToken}${demoVideo}`)
    await expect(screen.getByText("Bu adamdan emin misin?")).toBeVisible({ timeout: 60_000 })

    await agent.assert(
      "A Turkish subtitle line is shown, and it is a natural, faithful Turkish translation of the English line " +
        "'You sure about this guy?' (same meaning, not a word-for-word or broken translation).",
    )

    await browser.newTab()
    await browser.goto(`/v/${links.viewToken}`)
    await expect(screen.getByText(/· canlı$/)).toBeVisible()
    await expect(screen.getByText("Hold on. We need to talk before we go in.")).toBeVisible({ timeout: 30_000 })
    await agent.assert(
      "The phone view shows the current subtitle as a large Turkish line with its English original under it, " +
        "and the Turkish line means the same as the English one.",
    )
  })

  test("the judge rejects a wrong translation", { session: "streamer" }, async ({ links, app, agent, screen, browser, request }) => {
    // A line arrives on the phone view...
    await app.open(`/v/${links.viewToken}`)
    await expect(screen.getByText(/· canlı$/)).toBeVisible()
    expect(await request.post(`/api/overlay/${links.overlayToken}/line`, { json: { en: "You sure about this guy?" } })).toBeOK()
    await expect(screen.getByText("Bu adamdan emin misin?")).toBeVisible()

    // ...then the Turkish text is swapped for an unrelated sentence, as a broken translation would look.
    await browser.evaluate(() => {
      const node = [...document.querySelectorAll("p")].find((p) => p.textContent === "Bu adamdan emin misin?")
      if (node) node.textContent = "Yarın sabah erkenden balığa gidiyoruz."
      return Boolean(node)
    })
    await expect(screen.getByText("Yarın sabah erkenden balığa gidiyoruz.")).toBeVisible()

    const verdict = await agent
      .assert("The large Turkish line is a faithful translation of the English line shown under it.")
      .then(
        () => "passed",
        (error: unknown) => (isAgentError(error) ? error.code : "error"),
      )
    expect(verdict).toBe("ASSERTION_FAILED")
  })
})
