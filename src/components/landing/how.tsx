import { motion, useReducedMotion } from "motion/react"
import { Gamepad2Icon, MonitorIcon, RadioIcon, UsbIcon } from "lucide-react"
import { LogoMark } from "@/components/brand"
import { Container, Reveal, SectionHead } from "./kit"

const NODES = [
  { label: "Konsol", icon: Gamepad2Icon },
  { label: "Capture kart", icon: UsbIcon },
  { label: "OBS", icon: MonitorIcon },
  { label: "Yayın Altyazı", icon: null },
  { label: "Yayının", icon: RadioIcon },
]


export function How() {
  return (
    <section id="nasil" aria-labelledby="nasil-title" className="scroll-mt-20 py-20 md:py-28">
      <Container>
        <SectionHead id="nasil-title" title="Program yok. OBS'in içinde çalışır." />
        <Pipeline />
        <ol className="relative mt-16 grid gap-12 md:mt-20 md:grid-cols-3 md:gap-8">
          {/* Lane markings joining the three stops */}
          <div className="absolute top-[2.4rem] right-[calc(33.333%+1rem)] left-[4rem] hidden border-t-2 border-dashed border-sun/25 md:block" aria-hidden />
          <Step n={1} title="Adresi OBS'e ekle">
            <div className="flex aspect-[16/8] flex-col justify-center gap-2.5 rounded-lg border border-cloud/10 bg-ink-900 px-4">
              <span className="text-[0.75rem] text-mist">OBS › Kaynak ekle › Tarayıcı › URL</span>
              <div className="flex items-center gap-2 rounded-md border border-cloud/10 bg-ink-950 px-3 py-2 text-[0.8rem] text-mist">
                <span className="size-2 shrink-0 rounded-full bg-sun" aria-hidden />
                <span className="truncate">
                  https://…/o/<span className="text-cloud">k3Jx••••</span>
                </span>
              </div>
            </div>
          </Step>
          <Step n={2} title="Altyazı alanını çiz">
            <div className="relative aspect-[16/8] overflow-hidden rounded-lg border border-cloud/10 bg-[linear-gradient(160deg,var(--ink-700),var(--ink-900)_70%)]">
              <div className="absolute inset-x-[12%] bottom-[10%] flex h-[24%] items-center justify-center rounded border-[1.5px] border-dashed border-sun bg-sun/[0.08]">
                <span className="h-1.5 w-2/3 rounded-full bg-white/80" />
              </div>
            </div>
          </Step>
          <Step n={3} title="Oyunda altyazıyı aç">
            <div className="flex aspect-[16/8] flex-col items-center justify-end gap-1 overflow-hidden rounded-lg border border-cloud/10 bg-[linear-gradient(200deg,var(--ink-700),var(--ink-900)_70%)] pb-3">
              <span className="sub-ink text-[0.95rem] font-bold text-white [font-family:'Inter_Variable',sans-serif]">Arabaya bin! Sür, sür, sür!</span>
              <span lang="en" className="sub-ink text-[0.7rem] font-semibold text-white/85 [font-family:'Inter_Variable',sans-serif]">
                Get in the car! Go, go, go!
              </span>
            </div>
          </Step>
        </ol>
      </Container>
    </section>
  )
}

function Pipeline() {
  const reduce = useReducedMotion()
  return (
    <Reveal className="mt-14 md:mt-16">
      <div className="relative border-y border-cloud/[0.08] py-8">
        {/* Track and travelling signal (horizontal on wide screens) */}
        <div className="absolute top-[3.75rem] right-[10%] left-[10%] hidden h-px bg-cloud/10 md:block" aria-hidden>
          {!reduce ? (
            <motion.span
              className="absolute top-1/2 h-1 w-20 -translate-y-1/2 rounded-full bg-[linear-gradient(90deg,transparent,var(--sun),transparent)]"
              animate={{ left: ["0%", "92%"] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.4 }}
            />
          ) : null}
        </div>
        <ol aria-label="Görüntünün yolu" className="relative grid grid-cols-1 gap-4 md:grid-cols-5 md:gap-0">
          {NODES.map((n) => {
            const ours = n.icon === null
            const Icon = n.icon
            return (
              <li key={n.label} className="flex items-center gap-4 md:flex-col md:gap-3">
                <span
                  className={`relative flex size-14 shrink-0 items-center justify-center rounded-2xl border ${
                    ours ? "border-sun/50 bg-ink-800 shadow-[0_0_44px_-4px_color-mix(in_oklab,var(--sun)_70%,transparent)]" : "border-cloud/10 bg-ink-900 text-mist"
                  }`}
                >
                  {Icon ? <Icon className="size-6" aria-hidden /> : <LogoMark className="h-5 w-auto" />}
                </span>
                <span className={`text-[0.95rem] font-semibold ${ours ? "text-cloud" : "text-mist"}`}>{n.label}</span>
              </li>
            )
          })}
        </ol>
      </div>
    </Reveal>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="relative">
      <Reveal delay={n * 0.1}>
        <span className="font-display relative inline-flex h-[4.8rem] items-center bg-ink-950 pr-4 text-[5rem] leading-none font-black text-sun">{n}</span>
        <div className="mt-5">{children}</div>
        <h3 className="font-display mt-6 text-[1.9rem] leading-tight font-extrabold text-cloud">{title}</h3>
      </Reveal>
    </li>
  )
}
