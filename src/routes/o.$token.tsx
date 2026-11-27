import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { SubtitleBox } from "@/components/overlay/subtitle-box"
import { BLOCK_MESSAGES, useOverlayRuntime } from "@/components/overlay/runtime"

async function makeVideoSource(video: HTMLVideoElement) {
  if (video.readyState < 2) await new Promise((r) => video.addEventListener("canplay", r, { once: true }))
  await video.play().catch(() => {})
  const { createVideoFrameSource } = await import("@/engine")
  return createVideoFrameSource(video, { simulateWidth: 1920, jpegQuality: 85 })
}

export const Route = createFileRoute("/o/$token")({
  ssr: false,
  head: () => ({ meta: [{ title: "Yayın Altyazı overlay" }, { name: "robots", content: "noindex" }] }),
  component: OverlayPage,
})

/** The OBS browser source. Transparent, shows only the Turkish line plus short-lived problems. */
function OverlayPage() {
  const { token } = Route.useParams()
  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams()
  const debug = params.has("debug")
  // Demo mode: read subtitles from a video file instead of OBS (testing and demo recordings).
  const demo = params.get("demo")
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const { config, status, line, visible, objective, objectiveVisible } = useOverlayRuntime(token, {
    makeSource: demo && video ? () => makeVideoSource(video) : undefined,
    disabled: Boolean(demo) && !video,
  })

  // Problems are shown in the panel, not on stream. Only a dead link shows here (the panel can't
  // see an overlay it doesn't know), and ?debug shows everything.
  const notice =
    status.kind === "not_found"
      ? "Bu overlay bağlantısı geçersiz. Panelden yeni bağlantıyı kopyala."
      : !debug
        ? null
        : status.kind === "obs_error"
          ? `OBS bağlantısı kurulamadı: ${status.message}`
          : status.kind === "blocked"
            ? (BLOCK_MESSAGES[status.reason] ?? "Altyazı durduruldu.")
            : null
  const [showNotice, setShowNotice] = useState(false)
  useEffect(() => {
    if (!notice) return setShowNotice(false)
    setShowNotice(true)
    const t = setTimeout(() => setShowNotice(false), 20_000)
    return () => clearTimeout(t)
  }, [notice])

  return (
    <div className="overlay-root fixed inset-0 overflow-hidden">
      {demo ? (
        <video
          ref={setVideo}
          src={demo}
          muted
          autoPlay
          playsInline
          loop
          className={`absolute inset-0 size-full object-cover ${params.has("showvideo") ? "" : "invisible"}`}
        />
      ) : null}
      {config && (line || objective) ? (
        <SubtitleBox
          settings={config.settings}
          tr={line?.tr ?? ""}
          en={line?.en}
          visible={visible}
          box={line?.box}
          objective={objective ? { tr: objective.tr, visible: objectiveVisible, box: objective.box } : null}
        />
      ) : null}
      {(showNotice || debug) && (notice || debug) ? (
        <div className="absolute top-3 left-3 max-w-[40vw] rounded-md bg-black/80 px-3 py-2 text-sm text-white">
          <b className="text-altyazi">Yayın Altyazı</b> · {notice ?? status.kind}
        </div>
      ) : null}
    </div>
  )
}
