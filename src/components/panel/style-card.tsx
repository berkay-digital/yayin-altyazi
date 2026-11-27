import { useRef, useState } from "react"
import { RotateCcwIcon, AlignCenterIcon, AlignLeftIcon, AlignRightIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SubtitleBox } from "@/components/overlay/subtitle-box"
import { DEFAULT_STYLE, FONTS, STYLE_PRESETS, type FontId, type OverlaySettings, type SubtitleStyle } from "@/shared/settings"

const SAMPLE = {
  tr: "Bu şehir komple dümen, kanka. Herkes birini kazıklıyor.",
  en: "This whole city's a scam, man. Everybody's hustling somebody.",
  objective: "Polisleri ek",
}

const BACKDROPS = {
  koyu: "linear-gradient(135deg,#1e293b,#0f172a 45%,#7c2d12)",
  aydinlik: "linear-gradient(180deg,#bae6fd,#fef3c7 55%,#d6d3d1)",
  karisik:
    "repeating-linear-gradient(90deg,#f8fafc 0 7%,#334155 7% 12%,#fde68a 12% 20%,#0f172a 20% 26%),linear-gradient(#000,#000)",
} as const
type Backdrop = keyof typeof BACKDROPS

const SIZES = [
  { label: "Küçük", value: 32 },
  { label: "Orta", value: 42 },
  { label: "Büyük", value: 56 },
  { label: "Dev", value: 72 },
]

// Fields a preset should not override unless it sets them itself.
const KEEP_ON_PRESET: (keyof SubtitleStyle)[] = [
  "customX",
  "customY",
  "offsetY",
  "showEnglish",
  "holdSeconds",
  "animation",
  "objectives",
  "objectiveColor",
  "objectiveScale",
]

export function StyleCard({ settings, onChange }: { settings: OverlaySettings; onChange: (s: OverlaySettings) => void }) {
  const s = settings.style
  const setS = (patch: Partial<SubtitleStyle>) => onChange({ ...settings, style: { ...s, ...patch } })
  const [backdrop, setBackdrop] = useState<Backdrop>("koyu")
  const previewRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  function applyPreset(style: Partial<SubtitleStyle>) {
    const kept = Object.fromEntries(KEEP_ON_PRESET.map((k) => [k, s[k]]))
    onChange({ ...settings, style: { ...DEFAULT_STYLE, ...kept, ...style } })
  }

  function moveTo(e: React.PointerEvent) {
    const el = previewRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width))
    const y = Math.min(0.98, Math.max(0.02, (e.clientY - r.top) / r.height))
    setS({ placement: "custom", customX: round(x), customY: round(y), offsetY: 0 })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-cond text-2xl font-extrabold">4. Görünüm</CardTitle>
        <CardDescription>
          Hazır bir stil seç ya da her şeyi kendin ayarla. Önizlemede yazıyı sürükleyerek istediğin yere taşıyabilirsin.
          Kaydedince OBS'te birkaç saniye içinde uygulanır.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div
            ref={previewRef}
            className="relative aspect-video w-full cursor-move touch-none overflow-hidden rounded-md border select-none [container-type:size]"
            style={{ background: BACKDROPS[backdrop] }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              dragging.current = true
              moveTo(e)
            }}
            onPointerMove={(e) => dragging.current && moveTo(e)}
            onPointerUp={() => (dragging.current = false)}
          >
            <div
              className="absolute flex items-center justify-center text-center text-[3cqh] font-semibold text-white [text-shadow:0_0_3px_#000]"
              style={{
                left: `${settings.region.x * 100}%`,
                top: `${settings.region.y * 100}%`,
                width: `${settings.region.w * 100}%`,
                height: `${settings.region.h * 100}%`,
              }}
            >
              {SAMPLE.en}
            </div>
            <div
              className="pointer-events-none absolute border border-dashed border-altyazi/50"
              style={{
                left: `${settings.region.x * 100}%`,
                top: `${settings.region.y * 100}%`,
                width: `${settings.region.w * 100}%`,
                height: `${settings.region.h * 100}%`,
              }}
            />
            <SubtitleBox
              settings={settings}
              tr={SAMPLE.tr}
              en={SAMPLE.en}
              visible
              objective={{ tr: SAMPLE.objective, visible: true }}
              unit="cqh"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>Kesikli kutu: İngilizce altyazı alanı.</span>
            <div className="flex items-center gap-1">
              Önizleme zemini:
              {(Object.keys(BACKDROPS) as Backdrop[]).map((b) => (
                <Button key={b} size="xs" variant={backdrop === b ? "secondary" : "ghost"} onClick={() => setBackdrop(b)}>
                  {b === "koyu" ? "Koyu" : b === "aydinlik" ? "Aydınlık" : "Karışık"}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <Tabs defaultValue="hazir">
          <TabsList className="flex h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="hazir">Hazır stiller</TabsTrigger>
            <TabsTrigger value="konum">Konum</TabsTrigger>
            <TabsTrigger value="yazi">Yazı</TabsTrigger>
            <TabsTrigger value="kenar">Kenar ve gölge</TabsTrigger>
            <TabsTrigger value="arka">Arka plan</TabsTrigger>
            <TabsTrigger value="diger">Diğer</TabsTrigger>
          </TabsList>

          <TabsContent value="hazir" className="pt-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {STYLE_PRESETS.map((p) => (
                <Button key={p.id} variant="outline" className="h-auto justify-start py-2 text-left whitespace-normal" onClick={() => applyPreset(p.style)}>
                  {p.name}
                </Button>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="konum" className="grid gap-5 pt-4 sm:grid-cols-2">
            <SelectField
              label="Yer"
              value={s.placement}
              onChange={(v) => setS({ placement: v as SubtitleStyle["placement"] })}
              items={[
                { value: "above", label: "İngilizcenin hemen üstü" },
                { value: "below", label: "İngilizcenin hemen altı" },
                { value: "cover", label: "İngilizcenin üstüne (kapat)" },
                { value: "top", label: "Ekranın üst kısmı" },
                { value: "custom", label: "Serbest (önizlemede sürükle)" },
              ]}
            />
            <Field>
              <FieldLabel>Hizalama</FieldLabel>
              <div className="flex gap-1">
                {(
                  [
                    ["left", AlignLeftIcon, "Sola"],
                    ["center", AlignCenterIcon, "Ortala"],
                    ["right", AlignRightIcon, "Sağa"],
                  ] as const
                ).map(([v, Icon, label]) => (
                  <Button key={v} size="icon" variant={s.align === v ? "default" : "outline"} aria-label={label} onClick={() => setS({ align: v })}>
                    <Icon />
                  </Button>
                ))}
              </div>
            </Field>
            <SliderField label="Genişlik" value={s.width} min={0.3} max={1} step={0.01} format={pct} onChange={(v) => setS({ width: v })} />
            <SliderField label="Yukarı / aşağı kaydır" value={s.offsetY} min={-300} max={300} step={2} format={(v) => `${v} px`} onChange={(v) => setS({ offsetY: v })} />
            {s.placement === "custom" ? (
              <>
                <SliderField label="Yatay konum" value={s.customX} min={0} max={1} step={0.005} format={pct} onChange={(v) => setS({ customX: v })} />
                <SliderField label="Dikey konum" value={s.customY} min={0} max={1} step={0.005} format={pct} onChange={(v) => setS({ customY: v })} />
              </>
            ) : null}
            {s.placement === "cover" && !s.background ? (
              <p className="text-sm text-amber-400 sm:col-span-2">
                Arka plan kapalıyken İngilizce yazı Türkçenin arkasında görünür. Kapatmak için Arka plan sekmesinden kutuyu aç.
              </p>
            ) : null}
          </TabsContent>

          <TabsContent value="yazi" className="grid gap-5 pt-4 sm:grid-cols-2">
            <SelectField
              label="Yazı tipi"
              value={s.font}
              onChange={(v) => setS({ font: v as FontId })}
              items={(Object.keys(FONTS) as FontId[]).map((id) => ({ value: id, label: FONTS[id].label }))}
            />
            <Field>
              <FieldLabel>Boyut: {s.fontSize}px</FieldLabel>
              <div className="flex flex-wrap gap-1">
                {SIZES.map((z) => (
                  <Button key={z.value} size="sm" variant={s.fontSize === z.value ? "default" : "outline"} onClick={() => setS({ fontSize: z.value })}>
                    {z.label}
                  </Button>
                ))}
              </div>
              <Slider min={16} max={120} value={[s.fontSize]} onValueChange={(v) => setS({ fontSize: num(v) })} />
            </Field>
            <SliderField label="Kalınlık" value={s.fontWeight} min={300} max={900} step={100} format={(v) => weightName(v)} onChange={(v) => setS({ fontWeight: v })} />
            <ColorField label="Yazı rengi" value={s.textColor} onChange={(v) => setS({ textColor: v })} />
            <SliderField label="Satır aralığı" value={s.lineHeight} min={0.9} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setS({ lineHeight: v })} />
            <SliderField label="Harf aralığı" value={s.letterSpacing} min={-0.05} max={0.3} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => setS({ letterSpacing: v })} />
            <SwitchField label="BÜYÜK HARF" checked={s.uppercase} onChange={(v) => setS({ uppercase: v })} />
            <SwitchField label="İtalik" checked={s.italic} onChange={(v) => setS({ italic: v })} />
          </TabsContent>

          <TabsContent value="kenar" className="grid gap-5 pt-4 sm:grid-cols-2">
            <SliderField
              label="Kenar çizgisi kalınlığı"
              value={s.outlineWidth}
              min={0}
              max={12}
              step={0.5}
              format={(v) => (v ? `${v} px` : "Kapalı")}
              onChange={(v) => setS({ outlineWidth: v })}
            />
            <ColorField label="Kenar rengi" value={s.outlineColor} onChange={(v) => setS({ outlineColor: v })} />
            <SwitchField label="Gölge" checked={s.shadow} onChange={(v) => setS({ shadow: v })} />
            <ColorField label="Gölge rengi" value={s.shadowColor} onChange={(v) => setS({ shadowColor: v })} />
            <SliderField label="Gölge yayılımı" value={s.shadowBlur} min={0} max={40} step={1} format={(v) => `${v} px`} onChange={(v) => setS({ shadowBlur: v })} />
          </TabsContent>

          <TabsContent value="arka" className="grid gap-5 pt-4 sm:grid-cols-2">
            <SwitchField label="Arka plan kutusu" checked={s.background} onChange={(v) => setS({ background: v })} />
            <SwitchField label="Kutu tam genişlikte" checked={s.boxFullWidth} onChange={(v) => setS({ boxFullWidth: v })} disabled={!s.background} />
            <ColorField label="Kutu rengi" value={s.boxColor} onChange={(v) => setS({ boxColor: v })} disabled={!s.background} />
            <SliderField label="Kutu opaklığı" value={s.boxOpacity} min={0} max={1} step={0.01} format={pct} onChange={(v) => setS({ boxOpacity: v })} disabled={!s.background} />
            <SliderField label="İç boşluk" value={s.boxPadding} min={0} max={2} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => setS({ boxPadding: v })} disabled={!s.background} />
            <SliderField label="Köşe yuvarlaklığı" value={s.boxRadius} min={0} max={40} step={1} format={(v) => `${v} px`} onChange={(v) => setS({ boxRadius: v })} disabled={!s.background} />
          </TabsContent>

          <TabsContent value="diger" className="grid gap-5 pt-4 sm:grid-cols-2">
            <SwitchField label="Görev yazısını da çevir" checked={s.objectives} onChange={(v) => setS({ objectives: v })} />
            <ColorField label="Görev yazısı rengi" value={s.objectiveColor} onChange={(v) => setS({ objectiveColor: v })} disabled={!s.objectives} />
            <SliderField label="Görev yazısı boyutu" value={s.objectiveScale} min={0.5} max={1.2} step={0.05} format={pct} onChange={(v) => setS({ objectiveScale: v })} disabled={!s.objectives} />
            <SwitchField label="İngilizceyi de küçük göster" checked={s.showEnglish} onChange={(v) => setS({ showEnglish: v })} />
            <ColorField label="İngilizce rengi" value={s.englishColor} onChange={(v) => setS({ englishColor: v })} disabled={!s.showEnglish} />
            <SliderField label="İngilizce boyutu" value={s.englishScale} min={0.3} max={1} step={0.05} format={pct} onChange={(v) => setS({ englishScale: v })} disabled={!s.showEnglish} />
            <SelectField
              label="Giriş animasyonu"
              value={s.animation}
              onChange={(v) => setS({ animation: v as SubtitleStyle["animation"] })}
              items={[
                { value: "fade", label: "Belirme" },
                { value: "pop", label: "Büyüyerek" },
                { value: "slide", label: "Aşağıdan kayarak" },
                { value: "none", label: "Yok" },
              ]}
            />
            <SliderField label="Ekranda kalma süresi" value={s.holdSeconds} min={0} max={6} step={0.5} format={(v) => `${v} sn`} onChange={(v) => setS({ holdSeconds: v })} />
          </TabsContent>
        </Tabs>

        <Button variant="ghost" size="sm" onClick={() => setS(DEFAULT_STYLE)}>
          <RotateCcwIcon /> Varsayılana dön
        </Button>
      </CardContent>
    </Card>
  )
}

const num = (v: number | readonly number[]) => (Array.isArray(v) ? v[0] : (v as number))
const pct = (v: number) => `%${Math.round(v * 100)}`
const round = (v: number) => Math.round(v * 1000) / 1000
const weightName = (v: number) =>
  ({ 300: "İnce", 400: "Normal", 500: "Orta", 600: "Yarı kalın", 700: "Kalın", 800: "Çok kalın", 900: "Siyah" })[v] ?? String(v)

function SliderField({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  disabled,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel>
        {label}: <span className="font-normal text-muted-foreground tabular-nums">{format(value)}</span>
      </FieldLabel>
      <Slider min={min} max={max} step={step} value={[value]} disabled={disabled} onValueChange={(v) => onChange(num(v))} />
    </Field>
  )
}

function ColorField({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Field data-disabled={disabled || undefined}>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input type="color" className="h-9 w-14 p-1" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        <Input className="w-28 font-mono text-xs" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-label={`${label} kodu`} />
      </div>
    </Field>
  )
}

function SwitchField({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = `sw-${label.replace(/\W+/g, "-")}`
  return (
    <div className="flex items-center gap-3 self-end py-1">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={(v) => onChange(Boolean(v))} />
      <Label htmlFor={id}>{label}</Label>
    </div>
  )
}

function SelectField({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(v) => onChange(String(v))}>
        <SelectTrigger className="w-full">
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
    </Field>
  )
}
