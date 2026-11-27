import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DEFAULT_REGION, type OverlaySettings, type Region } from "@/shared/settings"
import type { ObsClient, VideoSourceInfo } from "@/engine/frame-source"

type Props = {
  settings: OverlaySettings
  onChange: (s: OverlaySettings) => void
}

const GTA_DEFAULT: Region = DEFAULT_REGION

/** Connects to OBS from the dashboard, lets the streamer pick the game source and draw the subtitle area, and shows live OCR. */
export function ObsSetup({ settings, onChange }: Props) {
  const [obs, setObs] = useState<ObsClient | null>(null)
  const [sources, setSources] = useState<VideoSourceInfo[]>([])
  const [connecting, setConnecting] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const previewRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLCanvasElement | null>(null)
  const [ocr, setOcr] = useState<{ text: string; ms: number }[]>([])
  const regionRef = useRef(settings.region)
  regionRef.current = settings.region

  const set = (patch: Partial<OverlaySettings>) => onChange({ ...settings, ...patch })
  const setObsField = (patch: Partial<OverlaySettings["obs"]>) => set({ obs: { ...settings.obs, ...patch } })

  async function connect() {
    setConnecting(true)
    try {
      const engine = await import("@/engine")
      const client = await engine.connectObs(settings.obs.url, settings.obs.password)
      const list = await engine.listVideoSources(client)
      setObs(client)
      setSources(list)
      // Pick the capture input when nothing (or a scene, which includes the overlay itself) is selected.
      const current = list.find((s) => s.name === settings.obs.sourceName)
      const capture = list.find((s) => s.preferred)
      if ((!current || current.kind === "scene") && capture) {
        setObsField({ sourceName: capture.name })
        if (current) toast.info(`Kaynak "${capture.name}" olarak değiştirildi. Sahne, overlay'in kendi yazısını da içerir.`)
      } else if (!settings.obs.sourceName && list[0]) setObsField({ sourceName: list[0].name })
      toast.success("OBS'e bağlandı")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/auth/i.test(msg)) {
        toast.error("WebSocket şifresi yanlış. OBS > Araçlar > WebSocket Sunucu Ayarları > Bağlantı Bilgilerini Göster'den kopyala.")
      } else {
        toast.error(
          "OBS'e bağlanılamadı. OBS açık ve WebSocket sunucusu etkin olmalı. Tarayıcı yerel ağ izni sorduysa izin ver; engellediyse adres çubuğundaki site ayarlarından 'Yerel ağ erişimi'ni aç ya da bu paneli OBS'te Özel Tarayıcı Dock'u olarak kullan.",
          { duration: 12000 },
        )
      }
    } finally {
      setConnecting(false)
    }
  }

  useEffect(() => () => void obs?.disconnect().catch(() => {}), [obs])

  // Live preview + OCR while connected.
  useEffect(() => {
    if (!obs || !settings.obs.sourceName) return
    let disposed = false
    let stopReader: (() => void) | null = null
    void (async () => {
      const engine = await import("@/engine")
      const base = await engine.createObsFrameSource({ obs, sourceName: settings.obs.sourceName, imageWidth: 1920 })
      // Tap frames for the preview canvas.
      const source = {
        async grab() {
          const f = await base.grab()
          if (f) {
            // The reader frees bitmaps after use, so keep our own copy for the preview.
            const copy = (frameRef.current as HTMLCanvasElement | null) ?? document.createElement("canvas")
            if (copy.width !== f.width || copy.height !== f.height) {
              copy.width = f.width
              copy.height = f.height
            }
            copy.getContext("2d")?.drawImage(f, 0, 0)
            frameRef.current = copy
            draw()
          }
          return f
        },
        close() {},
      }
      if (disposed) return
      const reader = new engine.SubtitleReader(
        source,
        { ...engine.DEFAULT_SETTINGS, ...settings.engine, region: regionRef.current },
      ).on({
          onLine: (l) =>
            setOcr((prev) =>
              [{ text: l.kind === "objective" ? `Görev: ${l.text}` : l.text, ms: Math.round(l.ocrMs) }, ...prev].slice(0, 6),
            ),
          onDebug: (d) => {
            const c = previewRef.current
            if (c && d.preview) {
              c.width = d.preview.width
              c.height = d.preview.height
              c.getContext("2d")?.drawImage(d.preview as CanvasImageSource, 0, 0)
            }
          },
        })
      await reader.start()
      stopReader = () => reader.stop()
      readerRef.current = reader
    })()
    return () => {
      disposed = true
      stopReader?.()
      readerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obs, settings.obs.sourceName])

  const readerRef = useRef<{ updateSettings?: (s: Partial<Record<string, unknown>>) => void } | null>(null)
  useEffect(() => {
    readerRef.current?.updateSettings?.({ region: settings.region })
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.region])

  function draw() {
    const c = canvasRef.current
    const f = frameRef.current
    if (!c) return
    const ctx = c.getContext("2d")
    if (!ctx) return
    if (f) {
      if (c.width !== f.width) {
        c.width = f.width
        c.height = f.height
      }
      ctx.drawImage(f, 0, 0)
    } else {
      c.width = 1280
      c.height = 720
      ctx.fillStyle = "#111"
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.fillStyle = "#666"
      ctx.font = "28px sans-serif"
      ctx.textAlign = "center"
      ctx.fillText("OBS'e bağlanınca oyun görüntüsü burada görünür", c.width / 2, c.height / 2)
    }
    const r = regionRef.current
    ctx.strokeStyle = "#ffd60a"
    ctx.lineWidth = Math.max(3, c.width / 400)
    ctx.setLineDash([12, 8])
    ctx.strokeRect(r.x * c.width, r.y * c.height, r.w * c.width, r.h * c.height)
    ctx.setLineDash([])
  }
  useEffect(draw)

  // Drag to draw a new region.
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  function toFrac(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragStart.current = toFrac(e)
  }
  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragStart.current) return
    const p = toFrac(e)
    const s = dragStart.current
    const region = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }
    if (region.w > 0.02 && region.h > 0.02) {
      regionRef.current = region
      draw()
    }
  }
  function onPointerUp() {
    if (!dragStart.current) return
    dragStart.current = null
    set({ region: regionRef.current })
  }

  const items = sources.map((s) => ({ label: `${s.name}${s.kind === "scene" ? " (sahne)" : ""}`, value: s.name }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-cond text-2xl font-extrabold">2. Oyun görüntüsü ve altyazı alanı</CardTitle>
        <CardDescription>
          OBS'te <i>Araçlar &gt; WebSocket Sunucu Ayarları</i>'ndan sunucuyu etkinleştir, şifreyi buraya gir. Sonra capture
          kart kaynağını seç ve İngilizce altyazının çıktığı alanı fareyle çiz. Oyunda altyazılar açık olmalı.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FieldGroup className="grid gap-4 sm:grid-cols-[2fr_2fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="obs-url">WebSocket adresi</FieldLabel>
            <Input id="obs-url" value={settings.obs.url} onChange={(e) => setObsField({ url: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="obs-pass">WebSocket şifresi</FieldLabel>
            <Input
              id="obs-pass"
              type="password"
              value={settings.obs.password}
              onChange={(e) => setObsField({ password: e.target.value })}
              autoComplete="off"
            />
          </Field>
          <Button onClick={() => void connect()} disabled={connecting}>
            {obs ? "Yeniden bağlan" : connecting ? "Bağlanıyor…" : "OBS'e bağlan"}
          </Button>
        </FieldGroup>
        <p className="text-xs text-muted-foreground">
          Bu paneli OBS'in çalıştığı bilgisayarda aç. Chrome "yerel ağdaki cihazlara erişim" izni sorarsa izin ver. En kolayı:
          paneli OBS'te <i>Docklar &gt; Özel Tarayıcı Dockları</i> ile açmak, orada izin gerekmez.
        </p>

        {sources.length ? (
          <Field>
            <FieldLabel>Oyun kaynağı (capture kart)</FieldLabel>
            <Select
              items={items}
              value={settings.obs.sourceName}
              onValueChange={(v) => setObsField({ sourceName: String(v ?? "") })}
            >
              <SelectTrigger className="w-full sm:w-96">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {items.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            {sources.find((s) => s.name === settings.obs.sourceName)?.kind === "scene" ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
                Bu bir sahne. Sahne, overlay'in kendi Türkçe yazısını da içerir; overlay onu okuyup aynı çeviride takılabilir.
                Capture kart ya da oyun yakalama kaynağını seç.
              </p>
            ) : null}
          </Field>
        ) : settings.obs.sourceName ? (
          <p className="text-sm text-muted-foreground">
            Kayıtlı kaynak: <b>{settings.obs.sourceName}</b>
          </p>
        ) : null}

        <div className="space-y-2">
          <canvas
            ref={canvasRef}
            className="aspect-video w-full cursor-crosshair touch-none rounded-md border bg-black"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => set({ region: GTA_DEFAULT })}>
              GTA varsayılan alanı
            </Button>
            <span className="text-xs text-muted-foreground">
              Sarı kutu altyazının tamamını, iki satır olsa bile kapsamalı. Fazla geniş olması sorun değil.
            </span>
          </div>
        </div>

        {obs ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Okunan görüntü</p>
              <canvas ref={previewRef} className="w-full rounded border bg-white" />
              <FieldDescription>Altyazı görününce burada siyah yazı olarak belirmeli.</FieldDescription>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Okunan satırlar</p>
              <ul className="space-y-1 text-sm">
                {ocr.length ? (
                  ocr.map((l, i) => (
                    <li key={i} className={i ? "text-muted-foreground" : ""}>
                      {l.text} <span className="text-xs text-muted-foreground">({l.ms} ms)</span>
                    </li>
                  ))
                ) : (
                  <li className="text-muted-foreground">Altyazı bekleniyor…</li>
                )}
              </ul>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
