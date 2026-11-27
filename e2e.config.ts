import { claudeCode } from "@e2e-dev/acp"
import { web } from "@e2e-dev/web"
import { defineConfig } from "e2e"

/**
 * End-to-end tests (https://e2e.com). The runner starts the production build through tests/support/serve.mts,
 * which puts a mock translation model and a throwaway database next to it. Build first: `pnpm test:e2e`.
 */
export default defineConfig({
  targets: [
    {
      name: "web",
      engine: web(),
      app: {
        url: "http://127.0.0.1:0",
        command: {
          executable: "node",
          args: ["tests/support/serve.mts", "{port}"],
          log: ".e2e/logs/app.log",
        },
        readyUrl: "http://127.0.0.1:{port}/api/health",
      },
    },
  ],
  tests: "tests/**/*.e2e.ts",
  // Agent steps (tests/agent.e2e.ts) run on the local Claude Code login, so they need no API key.
  agents: {
    default: {
      executor: claudeCode({
        model: "sonnet",
        system: "The app's interface is in Turkish. Instructions are in English; match them to the Turkish labels.",
      }),
    },
  },
  // Recorded agent steps are committed, so CI replays them without a model. Locally the cache records.
  cache: { dir: "tests/e2e-cache" },
  reporters: process.env.CI ? ["list", "junit"] : ["list"],
})
