import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { Logo } from "@/components/brand"

import appCss from "../styles.css?url"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Yayın Altyazı · Yayınına canlı Türkçe altyazı" },
      {
        name: "description",
        content:
          "Konsoldan oyun yayını yapanlar için canlı Türkçe altyazı. GTA 6 ve diğer oyunlarda İngilizce altyazıları anında Türkçeye çevirip OBS'te gösterir.",
      },
      { name: "theme-color", content: "#071416" },
      // Share previews. Pages override title/description.
      { property: "og:site_name", content: "Yayın Altyazı" },
      { property: "og:type", content: "website" },
      { property: "og:locale", content: "tr_TR" },
      { property: "og:title", content: "Yayın Altyazı · Yayınına canlı Türkçe altyazı" },
      { property: "og:description", content: "Konsol yayınları için canlı Türkçe altyazı. OBS'e tek adres ekle." },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
    ],
  }),
  notFoundComponent: () => (
    <Problem
      title="Bu sayfa yok."
      text="Adres yanlış ya da sayfa kaldırılmış."
      actions={[
        { href: "/", label: "Ana sayfa", primary: true },
        { href: "/panel", label: "Panele git" },
      ]}
    />
  ),
  errorComponent: ({ reset }) => (
    <Problem
      title="Bir şeyler ters gitti."
      text="Sayfa yüklenirken bir hata oldu. Tekrar dene; sürerse birkaç dakika sonra yeniden gel."
      actions={[
        { onClick: reset, label: "Tekrar dene", primary: true },
        { href: "/", label: "Ana sayfa" },
      ]}
    />
  ),
  shellComponent: RootDocument,
})

function Problem({
  title,
  text,
  actions,
}: {
  title: string
  text: string
  actions: { href?: string; onClick?: () => void; label: string; primary?: boolean }[]
}) {
  const cls = (primary?: boolean) =>
    primary
      ? "inline-flex h-11 items-center rounded-lg bg-sun px-5 font-semibold text-on-sun transition hover:brightness-110"
      : "inline-flex h-11 items-center rounded-lg border border-cloud/15 px-5 font-medium text-cloud transition hover:bg-cloud/5"
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-ink-950 p-6 text-center">
      <Logo className="mb-10 text-cloud" />
      <h1 className="font-display text-[clamp(2.6rem,6vw,4.2rem)] leading-none font-black text-cloud">{title}</h1>
      <p className="mt-4 max-w-md text-balance text-mist">{text}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {actions.map((a) =>
          a.href ? (
            <a key={a.label} href={a.href} className={cls(a.primary)}>
              {a.label}
            </a>
          ) : (
            <button key={a.label} type="button" onClick={a.onClick} className={cls(a.primary)}>
              {a.label}
            </button>
          ),
        )}
      </div>
    </main>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="top-center" />
        <Scripts />
      </body>
    </html>
  )
}
