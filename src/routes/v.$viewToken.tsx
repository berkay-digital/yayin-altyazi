import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

export const Route = createFileRoute("/v/$viewToken")({
  ssr: false,
  head: () => ({ meta: [{ title: "Canlı altyazı" }, { name: "robots", content: "noindex" }] }),
  component: ViewerPage,
})

type Line = { en: string; tr: string; at: number }

/** Second-screen view for the streamer: phone, tablet, second monitor or an OBS dock. */
function ViewerPage() {
  const { viewToken } = Route.useParams()
  const [lines, setLines] = useState<Line[]>([])
  const [current, setCurrent] = useState<Line | null>(null)
  const [objective, setObjective] = useState<Line | null>(null)
  const [connected, setConnected] = useState(false)
  const [showEn, setShowEn] = useState(true)

  useEffect(() => {
    const es = new EventSource(`/api/live/${viewToken}`)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as { type: string; en?: string; tr?: string; at: number }
      if (e.type === "line" && e.tr) {
        const l = { en: e.en ?? "", tr: e.tr, at: e.at }
        setCurrent(l)
        setLines((prev) => (prev[0]?.tr === l.tr ? prev : [l, ...prev].slice(0, 30)))
      } else if (e.type === "objective" && e.tr) {
        setObjective({ en: e.en ?? "", tr: e.tr, at: e.at })
      } else if (e.type === "clear") {
        setCurrent(null)
      }
    }
    return () => es.close()
  }, [viewToken])

  // Keep phone screens awake while watching.
  useEffect(() => {
    let lock: { release(): Promise<void> } | null = null
    const nav = navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }
    const take = () => nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {})
    void take()
    const onVis = () => document.visibilityState === "visible" && void take()
    document.addEventListener("visibilitychange", onVis)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      void lock?.release()
    }
  }, [])

  const latest = current ?? lines[0] ?? null
  return (
    <main className="flex min-h-svh flex-col bg-black text-white">
      <header className="flex items-center justify-between px-4 py-3 text-xs text-white/60">
        <span>
          <b className="text-altyazi">Yayın Altyazı</b> · {connected ? "canlı" : "bağlanıyor…"}
        </span>
        <button className="rounded border border-white/20 px-2 py-1" onClick={() => setShowEn((v) => !v)}>
          {showEn ? "İngilizceyi gizle" : "İngilizceyi göster"}
        </button>
      </header>
      {objective ? (
        <p className="mx-4 rounded-md border border-[#ffd166]/30 bg-[#ffd166]/10 px-3 py-2 text-center text-sm font-semibold text-[#ffd166]">
          Görev: {objective.tr}
        </p>
      ) : null}
      <section className="flex flex-1 flex-col items-center justify-center px-5 text-center">
        {latest ? (
          <div className={current ? "" : "opacity-50"}>
            <p className="text-[clamp(1.6rem,6vw,3.5rem)] leading-tight font-semibold text-balance">{latest.tr}</p>
            {showEn ? <p className="mt-3 text-[clamp(1rem,3vw,1.5rem)] text-white/55 text-balance">{latest.en}</p> : null}
          </div>
        ) : (
          <p className="text-white/50">Altyazı bekleniyor. Oyunda altyazılar açık olmalı.</p>
        )}
      </section>
      <ol className="max-h-[30svh] space-y-2 overflow-y-auto border-t border-white/10 px-4 py-3 text-sm">
        {lines.slice(1, 12).map((l) => (
          <li key={l.at} className="text-white/45">
            {l.tr}
          </li>
        ))}
      </ol>
    </main>
  )
}
