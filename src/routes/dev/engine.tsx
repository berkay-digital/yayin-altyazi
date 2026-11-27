import { createFileRoute, notFound } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  createOcr,
  createVideoFrameSource,
  DEFAULT_SETTINGS,
  SubtitleReader,
  type DebugInfo,
  type EngineSettings,
  type OcrEngine,
  type Region,
} from "@/engine"

/**
 * Dev harness for the subtitle engine: play a local video, drag the subtitle
 * region, watch the binarized preview and the emitted lines.
 *
 * Query params (for automated runs):
 *   src=<url>     video URL (needs CORS if cross-origin)
 *   autoplay=1    start reading and playing once loaded
 *   simw=1920     simulate an OBS screenshot width (0 = native, default 1920)
 *   jpeg=85       simulate OBS JPEG quality (0 = no JPEG round trip)
 *   fps, stable, spec=0|1, luma, contrast, color=0|1
 *   lang=<url>    alternative language data folder
 *   psm=6|7|11|13
 */
export const Route = createFileRoute("/dev/engine")({
  ssr: false,
  // Test harness only; not reachable in production builds.
  beforeLoad: () => {
    if (import.meta.env.PROD) throw notFound()
  },
  component: EngineHarness,
})

interface LogEntry {
  type: "line" | "clear"
  videoT: number
  firstSeenVideoT?: number
  text?: string
  confidence?: number
  ocrMs?: number
  latencyMs?: number
  update?: boolean
  replaces?: string
}

declare global {
  interface Window {
    __engineLog?: LogEntry[]
    __engineState?: { ready: boolean; ended: boolean; error?: string; ocrCount: number; ocrMsTotal: number }
  }
}

function num(params: URLSearchParams, key: string, fallback: number): number {
  const v = params.get(key)
  if (v === null || v === "") return fallback
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function EngineHarness() {
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const cropRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const readerRef = useRef<SubtitleReader | null>(null)
  const ocrRef = useRef<OcrEngine | null>(null)
  const [src, setSrc] = useState<string | null>(params.get("src"))
  const [settings, setSettings] = useState<EngineSettings>(() => ({
    ...DEFAULT_SETTINGS,
    fps: num(params, "fps", DEFAULT_SETTINGS.fps),
    stableFrames: num(params, "stable", DEFAULT_SETTINGS.stableFrames),
    speculativeOcr: params.get("spec") ? params.get("spec") === "1" : DEFAULT_SETTINGS.speculativeOcr,
    lumaThreshold: num(params, "luma", DEFAULT_SETTINGS.lumaThreshold),
    minContrast: num(params, "contrast", DEFAULT_SETTINGS.minContrast),
    colorInk: params.get("color") ? params.get("color") === "1" : DEFAULT_SETTINGS.colorInk,
    targetTextHeight: num(params, "th", DEFAULT_SETTINGS.targetTextHeight),
  }))
  const [simWidth, setSimWidth] = useState(num(params, "simw", 1920))
  const [jpeg, setJpeg] = useState(num(params, "jpeg", 85))
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState("idle")
  const [lines, setLines] = useState<LogEntry[]>([])
  const [debug, setDebug] = useState<{ frameMs: number; grabMs: number; ink: number; stable: number; busy: boolean }>()
  const [lastOcr, setLastOcr] = useState<DebugInfo["ocr"]>()

  useEffect(() => {
    window.__engineLog = []
    window.__engineState = { ready: false, ended: false, ocrCount: 0, ocrMsTotal: 0 }
  }, [])

  const getOcr = useCallback(async () => {
    if (ocrRef.current) return ocrRef.current
    const lang = params.get("lang")
    const psm = params.get("psm")
    ocrRef.current = await createOcr({
      ...(psm ? { psm: psm as "6" } : {}),
      ...(lang ? { workerOptions: { langPath: lang, cachePath: `dev-${lang}` } } : {}),
    })
    return ocrRef.current
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = useCallback(async () => {
    const video = videoRef.current
    if (!video) return
    setStatus("loading OCR")
    const ocr = await getOcr()
    const source = createVideoFrameSource(video, {
      simulateWidth: simWidth > 0 ? simWidth : undefined,
      jpegQuality: jpeg > 0 ? jpeg : undefined,
    })
    const reader = new SubtitleReader(source, settings, { ocr })
    reader.on({
      onLine: (line) => {
        const now = performance.now()
        const entry: LogEntry = {
          type: "line",
          videoT: video.currentTime,
          firstSeenVideoT: video.currentTime - (now - line.firstSeenAt) / 1000,
          text: line.kind === "objective" ? `[objective] ${line.text}` : line.text,
          confidence: Math.round(line.confidence),
          ocrMs: Math.round(line.ocrMs),
          latencyMs: Math.round(line.at - line.firstSeenAt),
          update: line.update,
          replaces: line.replaces,
        }
        window.__engineLog?.push(entry)
        setLines((l) => [entry, ...l].slice(0, 300))
      },
      onClear: () => {
        const entry: LogEntry = { type: "clear", videoT: video.currentTime }
        window.__engineLog?.push(entry)
        setLines((l) => [entry, ...l].slice(0, 300))
      },
      onDebug: (info) => {
        if (info.ocr) {
          setLastOcr(info.ocr)
          if (window.__engineState) {
            window.__engineState.ocrCount++
            window.__engineState.ocrMsTotal += info.ocr.ms
          }
          return
        }
        setDebug({ frameMs: info.frameMs, grabMs: info.grabMs, ink: info.ink, stable: info.stableCount, busy: info.ocrBusy })
        drawInto(cropRef.current, info.crop)
        drawInto(previewRef.current, info.preview)
      },
      onError: (err) => setStatus(`error: ${String(err)}`),
    })
    readerRef.current = reader
    await reader.start()
    setRunning(true)
    setStatus("running")
    if (window.__engineState) window.__engineState.ready = true
  }, [getOcr, settings, simWidth, jpeg])

  const stop = useCallback(async () => {
    await readerRef.current?.stop()
    readerRef.current = null
    setRunning(false)
    setStatus("stopped")
  }, [])

  useEffect(() => {
    readerRef.current?.updateSettings(settings)
  }, [settings])

  useEffect(() => {
    return () => {
      void readerRef.current?.stop()
      void ocrRef.current?.terminate()
    }
  }, [])

  const onLoaded = useCallback(async () => {
    if (params.get("autoplay") !== "1") return
    try {
      await start()
      await videoRef.current?.play()
    } catch (err) {
      if (window.__engineState) window.__engineState.error = String(err)
      setStatus(`error: ${String(err)}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  return (
    <div className="min-h-svh bg-neutral-950 p-4 text-sm text-neutral-100">
      <h1 className="mb-3 text-lg font-semibold">Subtitle engine harness</h1>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              accept="video/*"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) setSrc(URL.createObjectURL(f))
              }}
            />
            <button
              type="button"
              className="rounded bg-emerald-600 px-3 py-1 disabled:opacity-40"
              disabled={!src || running}
              onClick={() => void start()}
            >
              Start reader
            </button>
            <button
              type="button"
              className="rounded bg-neutral-700 px-3 py-1 disabled:opacity-40"
              disabled={!running}
              onClick={() => void stop()}
            >
              Stop
            </button>
            <span className="text-neutral-400">{status}</span>
          </div>
          <RegionVideo
            videoRef={videoRef}
            src={src}
            region={settings.region}
            onRegion={(region) => setSettings((s) => ({ ...s, region }))}
            onLoaded={onLoaded}
            onEnded={() => {
              if (window.__engineState) window.__engineState.ended = true
            }}
          />
          <div className="space-y-1">
            <div className="text-neutral-400">Crop</div>
            <canvas ref={cropRef} className="max-w-full border border-neutral-800" />
            <div className="text-neutral-400">OCR input</div>
            <canvas ref={previewRef} className="max-w-full border border-neutral-800 bg-white" />
            {debug && (
              <div className="font-mono text-xs text-neutral-400">
                frame {debug.frameMs.toFixed(1)}ms (grab {debug.grabMs.toFixed(1)}) · ink {(debug.ink * 100).toFixed(2)}% ·
                stable {debug.stable} · {debug.busy ? "OCR busy" : "idle"}
              </div>
            )}
            {lastOcr && (
              <div className="font-mono text-xs text-neutral-400">
                last OCR {lastOcr.ms.toFixed(0)}ms conf {lastOcr.confidence.toFixed(0)}: {lastOcr.text ?? `(dropped: ${lastOcr.raw})`}
              </div>
            )}
          </div>
        </div>
        <div className="space-y-3">
          <Settings
            settings={settings}
            onChange={setSettings}
            simWidth={simWidth}
            onSimWidth={setSimWidth}
            jpeg={jpeg}
            onJpeg={setJpeg}
          />
          <div>
            <div className="mb-1 text-neutral-400">Emitted ({lines.filter((l) => l.type === "line").length})</div>
            <ol className="max-h-[60vh] space-y-1 overflow-auto font-mono text-xs">
              {lines.map((l, i) => (
                <li key={i} className={l.type === "clear" ? "text-neutral-600" : l.update ? "text-amber-300" : ""}>
                  {l.videoT.toFixed(2)}s{" "}
                  {l.type === "clear"
                    ? "(clear)"
                    : `${l.update ? "upd " : ""}[${l.confidence} · ocr ${l.ocrMs}ms · ${l.latencyMs}ms] ${l.text}`}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}

function drawInto(target: HTMLCanvasElement | null, img: HTMLCanvasElement | OffscreenCanvas | null): void {
  if (!target || !img) return
  if (target.width !== img.width || target.height !== img.height) {
    target.width = img.width
    target.height = img.height
  }
  target.getContext("2d")?.drawImage(img, 0, 0)
}

function RegionVideo(props: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  src: string | null
  region: Region
  onRegion: (r: Region) => void
  onLoaded: () => void
  onEnded: () => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const [draft, setDraft] = useState<Region | null>(null)
  const r = draft ?? props.region

  const toFrac = (e: React.PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  return (
    <div ref={boxRef} className="relative w-full select-none bg-black">
      <video
        ref={props.videoRef}
        src={props.src ?? undefined}
        crossOrigin="anonymous"
        muted
        playsInline
        controls={false}
        className="block w-full"
        onLoadedData={props.onLoaded}
        onEnded={props.onEnded}
        onClick={(e) => {
          const v = e.currentTarget
          if (v.paused) void v.play()
          else v.pause()
        }}
      />
      <div
        className="absolute inset-0 cursor-crosshair"
        onPointerDown={(e) => {
          if (e.shiftKey) {
            const v = props.videoRef.current
            if (v) void (v.paused ? v.play() : v.pause())
            return
          }
          e.currentTarget.setPointerCapture(e.pointerId)
          setDrag(toFrac(e))
        }}
        onPointerMove={(e) => {
          if (!drag) return
          const p = toFrac(e)
          setDraft({
            x: Math.min(drag.x, p.x),
            y: Math.min(drag.y, p.y),
            w: Math.abs(p.x - drag.x),
            h: Math.abs(p.y - drag.y),
          })
        }}
        onPointerUp={() => {
          if (draft && draft.w > 0.02 && draft.h > 0.02) props.onRegion(draft)
          setDrag(null)
          setDraft(null)
        }}
      >
        <div
          className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/10"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
        />
      </div>
      <VideoControls videoRef={props.videoRef} />
    </div>
  )
}

function VideoControls({ videoRef }: { videoRef: React.RefObject<HTMLVideoElement | null> }) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 500)
    return () => clearInterval(id)
  }, [])
  const v = videoRef.current
  return (
    <div className="flex items-center gap-2 bg-neutral-900 px-2 py-1 text-xs">
      <button type="button" className="rounded bg-neutral-700 px-2" onClick={() => v && void (v.paused ? v.play() : v.pause())}>
        {v?.paused === false ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        className="flex-1"
        min={0}
        max={v?.duration || 0}
        step={0.1}
        value={v?.currentTime ?? 0}
        onChange={(e) => {
          if (v) v.currentTime = Number(e.target.value)
        }}
      />
      <span className="font-mono">
        {(v?.currentTime ?? 0).toFixed(1)} / {(v?.duration || 0).toFixed(1)}s
      </span>
      <span className="text-neutral-500">drag to set region · shift+click to play/pause</span>
    </div>
  )
}

function Settings(props: {
  settings: EngineSettings
  onChange: (s: EngineSettings) => void
  simWidth: number
  onSimWidth: (n: number) => void
  jpeg: number
  onJpeg: (n: number) => void
}) {
  const { settings: s, onChange } = props
  const set = <K extends keyof EngineSettings>(k: K, v: EngineSettings[K]) => onChange({ ...s, [k]: v })
  const slider = (label: string, k: keyof EngineSettings, min: number, max: number, step: number) => (
    <label className="grid grid-cols-[120px_1fr_48px] items-center gap-2">
      <span className="text-neutral-400">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={s[k] as number}
        onChange={(e) => set(k, Number(e.target.value) as never)}
      />
      <span className="text-right font-mono">{String(s[k])}</span>
    </label>
  )
  return (
    <div className="space-y-2 rounded border border-neutral-800 p-3">
      {slider("fps", "fps", 1, 10, 1)}
      {slider("luma threshold", "lumaThreshold", 120, 250, 1)}
      {slider("min contrast", "minContrast", 10, 150, 1)}
      {slider("stable frames", "stableFrames", 1, 5, 1)}
      {slider("clear after ms", "clearAfterMs", 100, 3000, 50)}
      {slider("min confidence", "minConfidence", 0, 95, 1)}
      {slider("text height", "targetTextHeight", 16, 60, 1)}
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={s.colorInk} onChange={(e) => set("colorInk", e.target.checked)} />
        colored ink (yellow, blue, green words)
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={s.centeredText} onChange={(e) => set("centeredText", e.target.checked)} />
        centered subtitles
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={s.speculativeOcr} onChange={(e) => set("speculativeOcr", e.target.checked)} />
        speculative OCR
      </label>
      <label className="grid grid-cols-[120px_1fr] items-center gap-2">
        <span className="text-neutral-400">OBS sim width</span>
        <select
          className="bg-neutral-900"
          value={props.simWidth}
          onChange={(e) => props.onSimWidth(Number(e.target.value))}
        >
          <option value={0}>native</option>
          <option value={1280}>1280</option>
          <option value={1920}>1920</option>
        </select>
      </label>
      <label className="grid grid-cols-[120px_1fr] items-center gap-2">
        <span className="text-neutral-400">OBS sim JPEG</span>
        <select className="bg-neutral-900" value={props.jpeg} onChange={(e) => props.onJpeg(Number(e.target.value))}>
          <option value={0}>off</option>
          <option value={70}>70</option>
          <option value={85}>85</option>
          <option value={95}>95</option>
        </select>
      </label>
      <div className="font-mono text-xs text-neutral-500">
        region x {s.region.x.toFixed(3)} y {s.region.y.toFixed(3)} w {s.region.w.toFixed(3)} h {s.region.h.toFixed(3)}
      </div>
    </div>
  )
}
