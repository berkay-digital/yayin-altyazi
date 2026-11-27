import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { ActivityIcon, CreditCardIcon, LanguagesIcon, LogOutIcon, MonitorPlayIcon, PaletteIcon, ScanTextIcon, type LucideIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Logo } from "@/components/brand"
import { LinksCard } from "@/components/panel/links-card"
import { ObsSetup } from "@/components/panel/obs-setup"
import { PlanCard } from "@/components/panel/plan-card"
import { StyleCard } from "@/components/panel/style-card"
import { TranslateCard } from "@/components/panel/translate-card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { authClient } from "@/lib/auth-client"
import { getDashboard, getMe, rotateTokens, saveSettings } from "@/lib/api"
import { fmtMinutes, type Entitlement, type OverlaySettings, type PlanInfo } from "@/shared/settings"
import { LiveStatusCard, StatusPill, overall, useLiveStatus, type LiveData } from "@/components/panel/live-status"

export const Route = createFileRoute("/panel")({
  head: () => ({ meta: [{ title: "Panel · Yayın Altyazı" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    const me = await getMe()
    if (!me) throw redirect({ to: "/giris", search: { mod: "giris" } })
  },
  loader: () => getDashboard(),
  component: PanelPage,
})

type SectionId = "durum" | "obs" | "alan" | "ceviri" | "gorunum" | "paket"

const SETUP: { id: SectionId; step: number; label: string; icon: LucideIcon }[] = [
  { id: "obs", step: 1, label: "OBS'e ekle", icon: MonitorPlayIcon },
  { id: "alan", step: 2, label: "Altyazı alanı", icon: ScanTextIcon },
  { id: "ceviri", step: 3, label: "Çeviri", icon: LanguagesIcon },
  { id: "gorunum", step: 4, label: "Görünüm", icon: PaletteIcon },
]

const TITLES: Record<SectionId, string> = {
  durum: "Canlı durum",
  obs: "OBS'e ekle",
  alan: "Oyun görüntüsü ve altyazı alanı",
  ceviri: "Çeviri",
  gorunum: "Görünüm",
  paket: "Kullanım",
}

function PanelPage() {
  const data = Route.useLoaderData()
  const router = useRouter()
  const [settings, setSettings] = useState<OverlaySettings>(data.settings)
  const [saving, setSaving] = useState(false)
  const [section, setSection] = useState<SectionId>("durum")
  const dirty = JSON.stringify(settings) !== JSON.stringify(data.settings)
  const live = useLiveStatus()
  const billing = data.plan.billing
  const accountLabel = billing ? "Paket ve kullanım" : "Kullanım"

  // The section follows the URL hash, also when a link or the address bar changes it later.
  useEffect(() => {
    const fromHash = () => {
      const id = location.hash.slice(1) as SectionId
      if (id in TITLES) setSection(id)
    }
    fromHash()
    window.addEventListener("hashchange", fromHash)
    return () => window.removeEventListener("hashchange", fromHash)
  }, [])

  useEffect(() => {
    if (new URLSearchParams(location.search).get("odeme") === "tamam") {
      setSection("paket")
      toast.success("Ödeme alındı. Paketin birkaç saniye içinde aktif olur.")
      setTimeout(() => void router.invalidate(), 4000)
    }
  }, [router])

  function go(id: SectionId) {
    setSection(id)
    history.replaceState(null, "", `#${id}`)
    window.scrollTo({ top: 0 })
  }

  async function save() {
    setSaving(true)
    try {
      await saveSettings({ data: settings })
      await router.invalidate()
      toast.success("Kaydedildi")
    } catch {
      toast.error("Kaydedilemedi")
    } finally {
      setSaving(false)
    }
  }

  async function rotate() {
    await rotateTokens()
    await router.invalidate()
    toast.success("Yeni adresler oluşturuldu. OBS'teki adresi güncelle.")
  }

  async function logout() {
    await authClient.signOut()
    window.location.href = "/"
  }

  const step = SETUP.find((s) => s.id === section)

  return (
    <SidebarProvider>
      <Sidebar variant="inset">
        <SidebarHeader className="px-3 pt-4 pb-2">
          <Logo className="text-sidebar-foreground" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={section === "durum"} onClick={() => go("durum")} className="h-10">
                    <ActivityIcon aria-hidden />
                    <span>Canlı durum</span>
                    <span className="ml-auto">
                      <StatusDot data={live} />
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Kurulum</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {SETUP.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <SidebarMenuButton isActive={section === s.id} onClick={() => go(s.id)} className="h-10">
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-[0.7rem] font-bold tabular-nums group-data-[active]/menu-button:bg-sun group-data-[active]/menu-button:text-on-sun">
                        {s.step}
                      </span>
                      <span>{s.label}</span>
                      <s.icon className="ml-auto opacity-50" aria-hidden />
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Hesap</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={section === "paket"} onClick={() => go("paket")} className="h-10">
                    <CreditCardIcon aria-hidden />
                    <span>{accountLabel}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-3 p-3">
          {billing ? <PlanStatus entitlement={live?.entitlement ?? data.entitlement} plan={data.plan} onOpen={() => go("paket")} /> : null}
          <div className="flex items-center gap-2 px-1">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{data.user.email}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => void logout()} aria-label="Çıkış yap">
              <LogOutIcon />
            </Button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur md:rounded-t-xl md:px-6">
          <SidebarTrigger className="-ml-1 md:hidden" />
          <div className="min-w-0 flex-1">
            {step ? <p className="text-xs text-muted-foreground">Adım {step.step} / 4</p> : null}
            <h1 className="font-display truncate text-[1.6rem] leading-none font-extrabold">{section === "paket" ? accountLabel : TITLES[section]}</h1>
          </div>
          <button type="button" onClick={() => go("durum")} className="hidden sm:block" aria-label="Canlı durumu aç">
            <StatusPill data={live} />
          </button>
          {dirty ? (
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? "Kaydediliyor…" : "Değişiklikleri kaydet"}
            </Button>
          ) : null}
        </header>

        <div
          className={`mx-auto w-full max-w-5xl space-y-6 p-4 md:p-8 ${step || section === "durum" ? "[&>[data-slot=card]>[data-slot=card-header]>[data-slot=card-title]]:hidden" : ""}`}
        >
          {section === "durum" ? <LiveStatusCard data={live} onFix={go} /> : null}
          {section === "obs" ? <LinksCard overlayToken={data.overlayToken} viewToken={data.viewToken} onRotate={() => void rotate()} /> : null}
          {section === "alan" ? <ObsSetup settings={settings} onChange={setSettings} /> : null}
          {section === "ceviri" ? (
            <TranslateCard settings={settings} onChange={setSettings} />
          ) : null}
          {section === "gorunum" ? <StyleCard settings={settings} onChange={setSettings} /> : null}
          {section === "paket" ? (
            <>
              {billing ? (
                <PlanCard entitlement={data.entitlement} subscription={data.subscription} plan={data.plan} supportEmail={data.supportEmail} />
              ) : null}
              <UsageList usage={data.usage} />
            </>
          ) : null}

          {step && step.step < 4 ? (
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => go(SETUP[step.step].id)}>
                Sonraki adım: {SETUP[step.step].label}
              </Button>
            </div>
          ) : null}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function PlanStatus({ entitlement, plan: info, onOpen }: { entitlement: Entitlement; plan: PlanInfo; onOpen: () => void }) {
  const plan = entitlement.plan
  const trial = plan === "trial"
  const left = Math.max(0, entitlement.trialMinutesLeft)
  const name = plan === "trial" ? "Deneme" : plan ? info.name : "Deneme bitti"
  const total = Math.max(1, info.trialMinutes)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg border border-sidebar-border bg-sidebar-accent/60 p-3 text-left transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none"
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{name}</span>
        {trial ? <span className="text-xs text-muted-foreground tabular-nums">{fmtMinutes(left)} kaldı</span> : null}
      </span>
      {trial ? <Progress value={((total - left) / total) * 100} className="mt-2" /> : null}
      <span className="mt-2 block text-xs font-medium text-sun">
        {plan === "paid" ? "Paketi yönet" : `${info.name} pakete geç${info.price ? `, ${info.price}` : ""}`}
      </span>
    </button>
  )
}

function UsageList({ usage }: { usage: { day: string; minutes: number; activeMinutes: number; lines: number; cacheHits: number }[] }) {
  if (!usage.length) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Son kullanım</h2>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-normal">Gün</th>
              <th className="px-3 py-2 font-normal">Açık kaldı</th>
              <th className="px-3 py-2 font-normal">Çeviri süresi</th>
              <th className="px-3 py-2 font-normal">Satır</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u) => (
              <tr key={u.day} className="border-t tabular-nums">
                <td className="px-3 py-2">{new Date(u.day).toLocaleDateString("tr-TR")}</td>
                <td className="px-3 py-2">{fmtMinutes(u.minutes)}</td>
                <td className="px-3 py-2">{fmtMinutes(u.activeMinutes)}</td>
                <td className="px-3 py-2">{u.lines}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function StatusDot({ data }: { data: LiveData | null }) {
  const { tone, label } = overall(data)
  const color = { ok: "bg-emerald-400", wait: "bg-amber-400", bad: "bg-red-500", off: "bg-muted-foreground/40" }[tone]
  return <span className={`block size-2 rounded-full ${color}`} title={label} aria-label={label} />
}
