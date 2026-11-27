import { CheckCircle2Icon, CircleDashedIcon, Loader2Icon, XCircleIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { BLOCK_MESSAGES } from "@/components/overlay/runtime"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getLiveStatus } from "@/lib/api"

export type LiveData = Awaited<ReturnType<typeof getLiveStatus>>

/** Polls what the overlay in OBS is doing. */
export function useLiveStatus(intervalMs = 3000) {
  const [data, setData] = useState<LiveData | null>(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const d = await getLiveStatus()
        if (!stop) setData(d)
      } catch {
        // keep the last answer
      }
    }
    void load()
    const t = setInterval(load, intervalMs)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [intervalMs])
  return data
}

type Tone = "ok" | "wait" | "bad" | "off"

const LINE_ERRORS: Record<string, string> = {
  ...BLOCK_MESSAGES,
  not_configured: "Sunucuda çeviri ayarı eksik: ANTHROPIC_API_KEY ya da AI_BASE_URL tanımlı değil.",
  rate_limited: "AI servisi şu an yoğun, sonraki satırlarda tekrar dener.",
  upstream: "Çeviri servisine ulaşılamadı, sonraki satırlarda tekrar dener.",
}

function ago(at: number) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000))
  if (s < 5) return "az önce"
  if (s < 60) return `${s} sn önce`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} dk önce` : `${Math.round(m / 60)} sa önce`
}

/** One overall verdict for the header pill. */
export function overall(data: LiveData | null): { tone: Tone; label: string } {
  const s = data?.status
  if (!s || !s.online) return { tone: "off", label: "Overlay kapalı" }
  if (s.phase === "obs_error" || s.phase === "blocked") return { tone: "bad", label: "Sorun var" }
  if (s.phase !== "running") return { tone: "wait", label: "Bağlanıyor" }
  if (s.lastError && (!s.lastLine || s.lastError.at > s.lastLine.at)) return { tone: "bad", label: "Çeviri hatası" }
  return { tone: "ok", label: "Çalışıyor" }
}

export function StatusPill({ data }: { data: LiveData | null }) {
  const { tone, label } = overall(data)
  const color = { ok: "bg-emerald-400", wait: "bg-amber-400", bad: "bg-red-500", off: "bg-muted-foreground/50" }[tone]
  return (
    <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
      <span className={`size-2 rounded-full ${color} ${tone === "ok" || tone === "wait" ? "animate-pulse" : ""}`} aria-hidden />
      {label}
    </span>
  )
}

function Row({ tone, title, detail }: { tone: Tone; title: string; detail?: React.ReactNode }) {
  const Icon = { ok: CheckCircle2Icon, wait: Loader2Icon, bad: XCircleIcon, off: CircleDashedIcon }[tone]
  const color = { ok: "text-emerald-400", wait: "text-amber-400 animate-spin", bad: "text-red-500", off: "text-muted-foreground" }[tone]
  return (
    <li className="flex gap-3 py-3">
      <Icon className={`mt-0.5 size-5 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {detail ? <div className="mt-0.5 text-sm text-muted-foreground">{detail}</div> : null}
      </div>
    </li>
  )
}

/** Step-by-step answer to "is it working, and if not, where does it stop?" */
export function LiveStatusCard({ data, onFix }: { data: LiveData | null; onFix: (section: "obs" | "alan" | "ceviri") => void }) {
  const s = data?.status
  const online = Boolean(s?.online)
  const fix = (section: "obs" | "alan" | "ceviri", label: string) => (
    <button type="button" className="font-medium text-sun underline-offset-4 hover:underline" onClick={() => onFix(section)}>
      {label}
    </button>
  )

  const overlayRow = !s ? (
    <Row tone="off" title="Overlay OBS'te açık değil" detail={<>OBS'e tarayıcı kaynağını ekle. {fix("obs", "Nasıl eklenir")}</>} />
  ) : !online ? (
    <Row tone="off" title="Overlay şu an kapalı" detail={<>En son {ago(s.at)} açıktı. OBS açık ve sahnede kaynak görünür olmalı.</>} />
  ) : (
    <Row tone="ok" title="Overlay OBS'te açık" detail="Tarayıcı kaynağı çalışıyor ve sunucuya bağlı." />
  )

  const obsRow = !online ? (
    <Row tone="off" title="OBS bağlantısı" detail="Overlay açılınca kontrol edilir." />
  ) : s!.phase === "obs_error" ? (
    <Row
      tone="bad"
      title="OBS'e bağlanılamadı"
      detail={
        <>
          {s!.message}. OBS'te Araçlar &gt; WebSocket Sunucu Ayarları'nı aç, şifreyi panele gir. {fix("alan", "Ayarlara git")}
        </>
      }
    />
  ) : s!.phase === "blocked" ? (
    <Row tone="bad" title="Altyazı durduruldu" detail={LINE_ERRORS[s!.message ?? ""] ?? s!.message} />
  ) : s!.phase !== "running" ? (
    <Row tone="wait" title="OBS'e bağlanıyor" />
  ) : s!.sourceIsScene ? (
    <Row
      tone="bad"
      title="Kaynak olarak sahne seçili"
      detail={
        <>
          <b className="text-foreground">{s!.source}</b> bir sahne; overlay'in kendi Türkçesini de içeriyor. Overlay kendi yazısını
          okuyup aynı çeviride takılabilir, en çok da "İngilizcenin üstüne" modunda. Capture kart ya da oyun kaynağını seç.{" "}
          {fix("alan", "Kaynağı değiştir")}
        </>
      }
    />
  ) : (
    <Row tone="ok" title="OBS'e bağlı" detail={s!.source ? <>Görüntü kaynağı: <b className="text-foreground">{s!.source}</b></> : undefined} />
  )

  const running = online && s!.phase === "running"
  const readRow = !running ? (
    <Row tone="off" title="Altyazı okuma" detail="OBS bağlantısı kurulunca başlar." />
  ) : !s!.frames ? (
    <Row tone="wait" title="Görüntü bekleniyor" detail="OBS'ten henüz kare gelmedi. Kaynak adını kontrol et." />
  ) : s!.lastRead ? (
    <Row
      tone="ok"
      title="Altyazı okunuyor"
      detail={
        <>
          Son okunan ({ago(s!.lastRead.at)}): <span className="text-foreground">“{s!.lastRead.text}”</span>
        </>
      }
    />
  ) : (
    <Row
      tone="wait"
      title="Görüntü geliyor ama altyazı alanında yazı yok"
      detail={<>Oyunda altyazılar açık olmalı ve sarı kutu altyazının üstünde olmalı. {fix("alan", "Alanı çiz")}</>}
    />
  )

  const lastErr = s?.lastError
  const lastLine = s?.lastLine
  const errNewer = lastErr && (!lastLine || lastErr.at > lastLine.at)
  const trRow = errNewer ? (
    <Row
      tone="bad"
      title="Çeviri yapılamadı"
      detail={
        <>
          {LINE_ERRORS[lastErr.code] ?? lastErr.code} <span className="opacity-70">({ago(lastErr.at)})</span>
        </>
      }
    />
  ) : lastLine ? (
    <Row
      tone="ok"
      title="Çeviri yayında"
      detail={
        <>
          <span className="text-foreground">{lastLine.tr}</span>
          <span className="block opacity-70">
            {lastLine.en} · {lastLine.cached ? "hafızadan" : `${(lastLine.ms / 1000).toFixed(1).replace(".", ",")} sn`} · {ago(lastLine.at)}
          </span>
        </>
      }
    />
  ) : (
    <Row tone="off" title="Çeviri" detail="İlk altyazı okununca burada görünür." />
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-cond text-2xl font-extrabold">Canlı durum</CardTitle>
        <CardDescription>OBS'teki overlay'in şu an ne yaptığı. Her 3 saniyede yenilenir; yayına hiçbir uyarı düşmez.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {overlayRow}
          {obsRow}
          {readRow}
          {trRow}
        </ul>
      </CardContent>
    </Card>
  )
}
