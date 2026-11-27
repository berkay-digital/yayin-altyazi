import { defineConfig } from "vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [devtools(), tailwindcss(), tanstackStart(), nitro({
      preset: "node-server",
      routeRules: {
        "/**": {
          headers: {
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
            "strict-transport-security": "max-age=31536000",
            "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
          },
        },
        // Pages with account actions must not be framed (clickjacking). The overlay and phone view stay
        // embeddable: OBS and docks load them.
        "/panel": { headers: { "x-frame-options": "DENY" } },
        "/panel/**": { headers: { "x-frame-options": "DENY" } },
        "/giris": { headers: { "x-frame-options": "DENY" } },
        "/giris/**": { headers: { "x-frame-options": "DENY" } },
        // Overlay and phone links carry secret tokens in the path: never send them on as a referrer.
        "/o/**": { headers: { "referrer-policy": "no-referrer" } },
        "/v/**": { headers: { "referrer-policy": "no-referrer" } },
        // OCR worker, cores and model (~14 MB): cache hard, they change only with a new file name or key.
        "/tesseract/**": { headers: { "cache-control": "public, max-age=2592000" } },
      },
    }), viteReact()],
  ssr: { external: ["@electric-sql/pglite", "postgres", "@polar-sh/sdk", "@polar-sh/better-auth"] },
})

export default config
