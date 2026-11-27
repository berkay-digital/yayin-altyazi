/**
 * Starts the app for the e2e suite: a mock OpenAI-compatible model, then the production build on the given
 * port with a fresh embedded database. The app gets only the variables set here, so a developer's own
 * .env or Anthropic key never reaches it and no test calls a paid model.
 *
 * Usage (the runner calls it, see e2e.config.ts): node tests/support/serve.mts <port>
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { MOCK_TRANSLATIONS } from "./translations.mts"

const port = process.argv[2]
if (!port) throw new Error("usage: serve.mts <port>")

const root = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))
const entry = path.join(root, ".output/server/index.mjs")
if (!existsSync(entry)) {
  console.error("No production build found. Run `pnpm build` first, or use `pnpm test:e2e`.")
  process.exit(1)
}

/** Answers chat completions with the Turkish line for the English one in the request. */
const mock = createServer((req, res) => {
  let body = ""
  req.on("data", (chunk) => (body += chunk))
  req.on("end", () => {
    const messages = (JSON.parse(body || "{}") as { messages?: { content: string }[] }).messages ?? []
    const prompt = messages.at(-1)?.content ?? ""
    const en = /<(?:line|objective)>([\s\S]*?)<\/(?:line|objective)>/.exec(prompt)?.[1] ?? ""
    const tr = MOCK_TRANSLATIONS[en] ?? `[TR] ${en}`
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ choices: [{ message: { content: tr } }], usage: { prompt_tokens: 20, completion_tokens: 8 } }))
  })
})
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve))
const mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}/v1`

const dataDir = mkdtempSync(path.join(tmpdir(), "yayinaltyazi-e2e-"))
const app = spawn(process.execPath, [entry], {
  cwd: root,
  stdio: "inherit",
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: port,
    BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
    BETTER_AUTH_SECRET: "e2e-only-secret-e2e-only-secret-0000",
    PGLITE_DIR: dataDir,
    AI_BASE_URL: mockUrl,
    AI_API_KEY: "e2e",
    AI_MODEL: "mock",
  },
})

let stopping = false
function stop(code: number) {
  if (stopping) return
  stopping = true
  app.kill("SIGTERM")
  mock.close()
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(code)
}
app.on("exit", (code) => stop(code ?? 1))
process.on("SIGTERM", () => stop(0))
process.on("SIGINT", () => stop(0))
