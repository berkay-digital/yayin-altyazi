import { useEffect, useRef, useState } from "react"
import type { Entitlement, OverlaySettings } from "@/shared/settings"
import type { FrameSource, ObsFrameSource } from "@/engine/frame-source"
import type { TextBox } from "@/engine/types"
import { similarity } from "@/engine/text"

/**
 * ASCII-fold Turkish so our own lines can be recognized when OCR reads them back (the English model reads
 * "Tüm istasyonlar: şüpheli" as "Tum istasyonlar: supheli").
 */
function fold(s: string) {
  return s.replace(/ı/g, "i").replace(/İ/g, "I").normalize("NFD").replace(/[̀-ͯ]/g, "")
}

/** OCR of our own Turkish output (the capture includes the overlay), not game text. */
function isOwnText(read: string, shown: string[]) {
  const r = fold(read)
  return shown.some((tr) => similarity(r, fold(tr)) >= 0.6)
}

export type OverlayStatus =
  | { kind: "loading" }
  | { kind: "obs_connecting" }
  | { kind: "obs_error"; message: string }
  | { kind: "running" }
  | { kind: "blocked"; reason: string }
  | { kind: "not_found" }

export type OverlayLine = { en: string; tr: string; at: number; box?: TextBox }
type Kind = "dialogue" | "objective"

type Config = { settings: OverlaySettings; entitlement: Entitlement }

/**
 * The whole overlay loop: load config, connect to OBS, read subtitles, translate through the server API,
 * report status. `makeSource` lets the demo page swap OBS for a <video>.
 */
export function useOverlayRuntime(
  token: string,
  opts: { makeSource?: (settings: OverlaySettings) => Promise<FrameSource>; disabled?: boolean } = {},
) {
  const [config, setConfig] = useState<Config | null>(null)
  const [status, setStatus] = useState<OverlayStatus>({ kind: "loading" })
  const [line, setLine] = useState<OverlayLine | null>(null)
  const [visible, setVisible] = useState(false)
  const [objective, setObjective] = useState<OverlayLine | null>(null)
  const [objectiveVisible, setObjectiveVisible] = useState(false)
  const settingsKey = useRef("")
  const makeSourceRef = useRef(opts.makeSource)
  makeSourceRef.current = opts.makeSource
  // Diagnostics the panel shows: frames grabbed and the last text OCR saw in the subtitle area.
  const frames = useRef(0)
  const lastRead = useRef<{ text: string; at: number } | null>(null)
  const sourceIsScene = useRef<boolean | undefined>(undefined)

  // Report what we're doing to the server every few seconds and whenever it changes,
  // so the panel can show it (the stream itself stays clean).
  const statusRef = useRef(status)
  statusRef.current = status
  const sourceRef = useRef("")
  sourceRef.current = config?.settings.obs.sourceName ?? ""
  useEffect(() => {
    if (opts.disabled) return
    const send = () => {
      const s = statusRef.current
      const message = s.kind === "obs_error" ? s.message : s.kind === "blocked" ? s.reason : undefined
      void fetch(`/api/overlay/${token}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phase: s.kind,
          message,
          source: sourceRef.current,
          sourceIsScene: sourceIsScene.current,
          frames: frames.current,
          lastRead: lastRead.current,
        }),
        keepalive: true,
      }).catch(() => {})
    }
    send()
    const t = setInterval(send, 5_000)
    return () => clearInterval(t)
  }, [token, status, opts.disabled])

  // Load config, then refresh every 8 s so dashboard changes apply live.
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const res = await fetch(`/api/overlay/${token}`, { cache: "no-store" })
        if (res.status === 404) {
          setStatus({ kind: "not_found" })
          return
        }
        const data = (await res.json()) as Config
        if (stop) return
        setConfig((prev) => (prev && JSON.stringify(prev) === JSON.stringify(data) ? prev : data))
      } catch {
        // keep last config
      }
    }
    void load()
    const t = setInterval(load, 8_000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [token])

  // Reading pipeline. Restarts only when capture-related settings change.
  const captureKey = config
    ? JSON.stringify({
        obs: config.settings.obs,
        region: config.settings.region,
        engine: config.settings.engine,
        objectives: config.settings.style.objectives,
        active: config.entitlement.active,
      })
    : ""

  useEffect(() => {
    if (!config || opts.disabled) return
    if (!config.entitlement.active) {
      setStatus({ kind: "blocked", reason: config.entitlement.reason ?? "trial_over" })
      return
    }
    settingsKey.current = captureKey
    let disposed = false
    let source: FrameSource | null = null
    let reader: { stop(): void } | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    // Per kind: a sequence number so a slow reply never replaces a newer line, and the hide timer.
    const seq: Record<Kind, number> = { dialogue: 0, objective: 0 }
    const hideTimer: Record<Kind, ReturnType<typeof setTimeout> | undefined> = { dialogue: undefined, objective: undefined }
    const show = { dialogue: { set: setLine, visible: setVisible }, objective: { set: setObjective, visible: setObjectiveVisible } }

    const holdMs = config.settings.style.holdSeconds * 1000

    const post = (en: string, kind: Kind, provisional: boolean) =>
      fetch(`/api/overlay/${token}/line`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ en, kind, provisional }),
        keepalive: true,
      })

    // The first read of a line: the server starts translating now and the confirmed call below picks
    // up the same result, so the confirmation frames cost no extra wait. Nothing is shown or billed.
    const prefetch = (en: string, kind: Kind) => {
      void post(en, kind, true).catch(() => {})
    }

    // Turkish we put on screen recently. If the captured source includes the overlay (a scene), OCR reads
    // these back; they must never be translated again (in "cover" mode that loop locks onto its own text).
    const shown: string[] = []
    const own = (text: string) => isOwnText(text, shown)
    const hide = (kind: Kind) => {
      seq[kind]++
      clearTimeout(hideTimer[kind])
      hideTimer[kind] = setTimeout(() => show[kind].visible(false), holdMs)
    }

    const translate = async (en: string, kind: Kind, box?: TextBox) => {
      const mySeq = ++seq[kind]
      try {
        const res = await post(en, kind, false)
        const data = (await res.json()) as { tr?: string; error?: string }
        if (mySeq !== seq[kind] || disposed) return
        if (res.status === 402) {
          setStatus({ kind: "blocked", reason: data.error ?? "trial_over" })
          return
        }
        if (data.tr) {
          clearTimeout(hideTimer[kind])
          shown.push(data.tr)
          if (shown.length > 12) shown.shift()
          show[kind].set({ en, tr: data.tr, at: Date.now(), box })
          show[kind].visible(true)
        }
      } catch {
        // network blip: skip this line
      }
    }

    const start = async () => {
      setStatus({ kind: "obs_connecting" })
      try {
        const engine = await import("@/engine")
        const src = makeSourceRef.current
          ? await makeSourceRef.current(config.settings)
          : await engine.createObsFrameSource({
              url: config.settings.obs.url,
              password: config.settings.obs.password,
              sourceName: config.settings.obs.sourceName,
              imageWidth: 1920,
            })
        source = src
        if (disposed) {
          src.close()
          return
        }
        // A scene includes this overlay, so it can read its own text. Tell the panel.
        const obsClient = (src as Partial<ObsFrameSource>).obs
        if (obsClient) {
          sourceIsScene.current = await obsClient
            .call("GetSceneList")
            .then((r) => r.scenes.some((s) => s.sceneName === config.settings.obs.sourceName))
            .catch(() => undefined)
        }
        // OBS restarted, the WebSocket dropped or the source was renamed: grabs keep failing. Tear the
        // pipeline down and connect again instead of polling a dead connection forever.
        let failures = 0
        let restarting = false
        const restart = (message: string) => {
          if (restarting || disposed) return
          restarting = true
          reader?.stop()
          reader = null
          src.close()
          setStatus({ kind: "obs_error", message })
          retry = setTimeout(start, 3000)
        }
        obsClient?.on("ConnectionClosed", () => restart("OBS bağlantısı koptu, yeniden bağlanılıyor"))
        const counted: FrameSource = {
          grab: async () => {
            try {
              const f = await src.grab()
              failures = 0
              if (f) frames.current++
              return f
            } catch (e) {
              if (++failures >= 6) restart(`OBS'ten görüntü alınamıyor: ${e instanceof Error ? e.message : String(e)}`)
              throw e
            }
          },
          close: () => src.close(),
        }
        const readObjectives = config.settings.style.objectives
        const r = new engine.SubtitleReader(counted, {
          ...engine.DEFAULT_SETTINGS,
          ...config.settings.engine,
          region: config.settings.region,
          readObjectives,
        }).on({
            onOcr: (o) => {
              const text = (o.text ?? o.raw).trim()
              if (text && o.kind === "dialogue") lastRead.current = { text: text.slice(0, 200), at: Date.now() }
            },
            onProvisional: (p) => {
              if (!own(p.text)) prefetch(p.text, p.kind)
            },
            onLine: (l) => {
              // Our own Turkish read back: the game's line is hidden under it, so treat it as gone.
              if (own(l.text)) return hide(l.kind)
              void translate(l.text, l.kind, l.box)
            },
            onClear: (kind) => {
              hide(kind)
              if (kind === "dialogue") void fetch(`/api/overlay/${token}/clear`, { method: "POST" }).catch(() => {})
            },
            onError: (e) => {
              console.warn("[yayinaltyazi] reader error", e)
            },
          })
        reader = r
        await r.start()
        if (!restarting) setStatus({ kind: "running" })
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        setStatus({ kind: "obs_error", message })
        if (!disposed) retry = setTimeout(start, 5000)
      }
    }
    void start()

    // Heartbeat: records overlay-open minutes for stats and refreshes entitlement.
    const beat = setInterval(async () => {
      try {
        const res = await fetch(`/api/overlay/${token}/beat`, { method: "POST" })
        const data = (await res.json()) as { entitlement?: Entitlement }
        if (data.entitlement && !data.entitlement.active) {
          setConfig((c) => (c ? { ...c, entitlement: data.entitlement! } : c))
        }
      } catch {
        // ignore
      }
    }, 60_000)

    return () => {
      disposed = true
      clearInterval(beat)
      clearTimeout(retry)
      clearTimeout(hideTimer.dialogue)
      clearTimeout(hideTimer.objective)
      reader?.stop()
      source?.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureKey, token, opts.disabled])

  return { config, status, line, visible, objective, objectiveVisible }
}

export const BLOCK_MESSAGES: Record<string, string> = {
  trial_over: "Deneme süren bitti. Devam etmek için panelden pakete geç.",
  fair_use: "Bu ayki adil kullanım sınırına ulaştın.",
  not_configured: "Çeviri şu an çalışmıyor. Birkaç dakika içinde tekrar dene.",
}
