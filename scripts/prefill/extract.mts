/**
 * Reads one video with the overlay's engine on all cores: splits it into chunks, runs chunk.mts on each
 * (one ffmpeg + one OCR worker per chunk) and merges the lines in play order into <outDir>/<name>.jsonl.
 * Finished chunks are kept in <outDir>/<name>.chunks/, so a rerun only does what is missing.
 *
 * Usage: pnpm dlx tsx scripts/prefill/extract.mts <video> <name> <outDir> [--jobs N] [--chunk seconds]
 */
import { execFileSync, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { availableParallelism } from "node:os"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const flag = (name: string, def: number) => {
  const i = args.indexOf(name)
  return i >= 0 ? Number(args[i + 1]) : def
}
const [video, name, outDir] = args
if (!video || !name || !outDir) throw new Error("usage: extract.mts <video> <name> <outDir> [--jobs N] [--chunk s]")
const JOBS = flag("--jobs", availableParallelism())
const CHUNK = flag("--chunk", 900)
const chunkScript = fileURLToPath(new URL("./chunk.mts", import.meta.url))

const duration = Number(
  execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString().trim(),
)
const dir = `${outDir}/${name}.chunks`
mkdirSync(dir, { recursive: true })
const chunks: { start: number; end: number; file: string }[] = []
for (let s = 0; s < duration; s += CHUNK) {
  const start = s
  const end = Math.min(duration + 1, s + CHUNK)
  chunks.push({ start, end, file: `${dir}/${String(start).padStart(6, "0")}.jsonl` })
}
const todo = chunks.filter((c) => !existsSync(c.file))
console.log(`${name}: ${(duration / 3600).toFixed(2)} h, ${chunks.length} chunks, ${todo.length} to do, ${JOBS} at a time`)

const started = Date.now()
let done = 0
async function run(c: (typeof chunks)[number]) {
  const tmp = `${c.file}.part`
  await new Promise<void>((resolve, reject) => {
    const p = spawn("pnpm", ["dlx", "tsx", chunkScript, video, String(c.start), String(c.end), tmp], { stdio: ["ignore", "pipe", "inherit"] })
    let out = ""
    p.stdout.on("data", (d: Buffer) => (out += d.toString()))
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`chunk ${c.start} exited ${code}: ${out.slice(-300)}`))))
  })
  renameSync(tmp, c.file)
  done++
  const mins = (Date.now() - started) / 60000
  console.log(`  ${done}/${todo.length} chunks (${mins.toFixed(1)} min)`)
}
const queue = [...todo]
await Promise.all(
  Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) await run(c)
  }),
)

const lines = chunks.flatMap((c) =>
  readFileSync(c.file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => ({ video: name, ...JSON.parse(l) })),
)
writeFileSync(`${outDir}/${name}.jsonl`, lines.map((l) => JSON.stringify(l)).join("\n") + "\n")
console.log(`${name}: ${lines.length} lines in ${((Date.now() - started) / 60000).toFixed(1)} min`)
