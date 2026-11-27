#!/usr/bin/env node
// Copies the self-hosted Tesseract.js assets into public/tesseract/.
//
// - worker.min.js from tesseract.js
// - the LSTM-only core builds (relaxed SIMD, SIMD, plain) from tesseract.js-core.
//   The worker picks one at runtime based on browser support.
// - eng.traineddata.gz. It is committed in public/tesseract so builds need no
//   network. If it is missing, it is downloaded from tessdata_fast and gzipped.
//
// Usage: pnpm assets:tesseract [--model fast|best|best_int] [--force]

import { createRequire } from "node:module"
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(root, "public", "tesseract")
const require = createRequire(join(root, "package.json"))

const args = process.argv.slice(2)
const force = args.includes("--force")
const modelArg = args.indexOf("--model")
const model = modelArg >= 0 ? args[modelArg + 1] : "fast"

const MODEL_URLS = {
  fast: "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata",
  best: "https://github.com/tesseract-ocr/tessdata_best/raw/main/eng.traineddata",
  best_int: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz",
}

const CORE_FILES = [
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.wasm.js",
]

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  await mkdir(outDir, { recursive: true })

  const tessPkg = dirname(require.resolve("tesseract.js/package.json"))
  await copyFile(join(tessPkg, "dist", "worker.min.js"), join(outDir, "worker.min.js"))
  console.log("copied worker.min.js")

  const coreRequire = createRequire(join(tessPkg, "package.json"))
  const corePkg = dirname(coreRequire.resolve("tesseract.js-core/package.json"))
  for (const file of CORE_FILES) {
    await copyFile(join(corePkg, file), join(outDir, file))
    console.log(`copied ${file}`)
  }

  const langFile = join(outDir, "eng.traineddata.gz")
  if (!force && (await exists(langFile))) {
    console.log("eng.traineddata.gz already present, keeping it (use --force to replace)")
    return
  }
  const url = MODEL_URLS[model]
  if (!url) throw new Error(`unknown model "${model}", use one of ${Object.keys(MODEL_URLS).join(", ")}`)
  console.log(`downloading ${model} model from ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const isGzip = buf[0] === 0x1f && buf[1] === 0x8b
  await writeFile(langFile, isGzip ? buf : gzipSync(buf, { level: 9 }))
  console.log(`wrote eng.traineddata.gz (${model})`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
