import { createFileRoute } from "@tanstack/react-router"
import { DatabaseZapIcon, ListChecksIcon, PaletteIcon, ServerIcon, ShieldCheckIcon, SmartphoneIcon, type LucideIcon } from "lucide-react"
import { Footer } from "@/components/landing/closing"
import { Faq } from "@/components/landing/faq"
import { How } from "@/components/landing/how"
import { Container, CtaLink, GhostLink, Reveal, SectionHead } from "@/components/landing/kit"
import { Nav } from "@/components/landing/nav"
import { REPO_URL } from "@/shared/site"

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Yayın Altyazı: konsol yayınına canlı Türkçe altyazı" },
      {
        name: "description",
        content:
          "Oyundaki İngilizce altyazıyı okuyup bir saniyede Türkçeye çeviren, OBS'te gösteren açık kaynaklı overlay. Konsoldan yayın yapanlar için.",
      },
      { property: "og:title", content: "Oyun İngilizce. Yayın Türkçe." },
      { property: "og:description", content: "Konsol yayınları için canlı Türkçe altyazı. Açık kaynak, OBS'e tek adres." },
    ],
  }),
  component: Landing,
})

function Landing() {
  return (
    <div className="min-h-svh bg-ink-950 text-cloud">
      <Nav />
      <main>
        <Hero />
        <How />
        <Features />
        <SelfHost />
        <Faq />
      </main>
      <Footer />
    </div>
  )
}

function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pt-36 pb-16 md:pt-44 md:pb-24">
      <Container className="grid items-center gap-14 lg:grid-cols-[1fr_1.1fr]">
        <Reveal>
          <h1 id="hero-title" className="font-display text-[clamp(3.2rem,8vw,6.4rem)] leading-[0.95] font-black tracking-[-0.01em]">
            Oyun İngilizce.
            <br />
            <span className="text-sun">Yayın Türkçe.</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-[1.125rem] leading-relaxed text-pretty text-mist">
            Konsoldan yayın yapanlar için canlı Türkçe altyazı. OBS'e bir tarayıcı kaynağı eklersin; oyundaki İngilizce altyazı
            okunur, Türkçesi bir saniye içinde yayında görünür.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <CtaLink href="/giris">Başla</CtaLink>
            <GhostLink href={REPO_URL}>Kaynak kodu</GhostLink>
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <Frame />
        </Reveal>
      </Container>
    </section>
  )
}

/** A stylised stream frame: the Turkish line on top of the game's English subtitle. */
function Frame() {
  return (
    <div className="relative aspect-video overflow-hidden rounded-2xl border border-cloud/10 bg-[radial-gradient(120%_90%_at_70%_10%,var(--ink-700),var(--ink-900)_55%,var(--ink-950))] shadow-[0_40px_120px_-40px_color-mix(in_oklab,var(--sun)_35%,transparent)] [container-type:inline-size]">
      <div className="absolute inset-x-0 bottom-[9%] flex flex-col items-center gap-[1.2cqi] px-[6%] text-center [font-family:'Inter_Variable',sans-serif]">
        <span className="sub-ink text-[4.2cqi] leading-tight font-bold text-white">Sakin ol. Bende o iş.</span>
        <span lang="en" className="relative rounded px-[1cqi] text-[2.6cqi] font-semibold text-white/80">
          <span className="absolute inset-0 rounded border border-dashed border-sun/70 bg-sun/[0.06]" aria-hidden />
          Relax. I got this.
        </span>
      </div>
      <span className="absolute top-[5%] left-[4%] rounded-full bg-red-600 px-[1.6cqi] py-[0.5cqi] text-[1.8cqi] font-bold tracking-wide text-white">
        CANLI
      </span>
    </div>
  )
}

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheckIcon,
    title: "Görüntü bilgisayarında kalır",
    text: "Yazı tanıma tarayıcıda, OBS'in içinde çalışır. Sunucuya sadece okunan İngilizce satır gider.",
  },
  {
    icon: ListChecksIcon,
    title: "Görev yazıları ayrı satırda",
    text: "Altyazının altındaki görev yazısı ayrı okunur ve kısa bir Türkçe talimat olarak kendi renginde görünür.",
  },
  {
    icon: DatabaseZapIcon,
    title: "Ortak çeviri hafızası",
    text: "Bir kez çevrilen satır hafızaya yazılır. Aynı satır tekrar geldiğinde anında, API çağrısı olmadan gösterilir.",
  },
  {
    icon: PaletteIcon,
    title: "Tam stil ayarı",
    text: "Yazı tipi, boyut, renk, kontur, gölge, kutu ve konum. İstersen İngilizcenin üstünü tamamen kapatır.",
  },
  {
    icon: SmartphoneIcon,
    title: "Telefon ekranı",
    text: "Altyazıları telefonda ya da ikinci ekranda canlı takip etmek için ayrı bir sayfa.",
  },
  {
    icon: ServerIcon,
    title: "Kendi sunucunda",
    text: "Claude Haiku ya da OpenAI uyumlu herhangi bir model. Tek bir Docker imajı, Postgres ya da yerel veritabanı.",
  },
]

function Features() {
  return (
    <section id="ozellikler" aria-labelledby="ozellikler-title" className="scroll-mt-20 py-20 md:py-28">
      <Container>
        <SectionHead id="ozellikler-title" title="Neler yapar" />
        <ul className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <li key={f.title}>
              <Reveal delay={(i % 3) * 0.08}>
                <f.icon className="size-7 text-sun" aria-hidden />
                <h3 className="mt-4 text-[1.15rem] font-semibold text-cloud">{f.title}</h3>
                <p className="mt-2 leading-relaxed text-mist">{f.text}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  )
}

const SETUP = `git clone ${REPO_URL}.git
cd yayin-altyazi
pnpm install
cp .env.example .env   # ANTHROPIC_API_KEY ya da AI_BASE_URL
pnpm dev               # http://localhost:3000`

function SelfHost() {
  return (
    <section id="kurulum" aria-labelledby="kurulum-title" className="scroll-mt-20 py-20 md:py-28">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:items-center">
        <SectionHead
          id="kurulum-title"
          title="Kendi sunucunda çalıştır"
          sub="Node 24 ve pnpm yeterli. Yayın için bir sunucuya Docker ile kur; ayrıntılar README'de."
        />
        <Reveal>
          <pre className="overflow-x-auto rounded-xl border border-cloud/10 bg-ink-900 p-5 text-[0.9rem] leading-relaxed text-cloud">
            <code>{SETUP}</code>
          </pre>
        </Reveal>
      </Container>
    </section>
  )
}
