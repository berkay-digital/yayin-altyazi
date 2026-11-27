import { useEffect, useState } from "react"
import { Logo } from "@/components/brand"
import { REPO_URL } from "@/shared/site"
import { CtaLink } from "./kit"

const LINKS = [
  { href: "#nasil", label: "Nasıl çalışır" },
  { href: "#ozellikler", label: "Özellikler" },
  { href: "#kurulum", label: "Kurulum" },
  { href: "#sss", label: "SSS" },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24)
    on()
    window.addEventListener("scroll", on, { passive: true })
    return () => window.removeEventListener("scroll", on)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,backdrop-filter] duration-300 ${
        scrolled ? "border-b border-cloud/[0.08] bg-ink-950/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-[4.5rem] w-full max-w-[1320px] items-center justify-between gap-6 px-5 sm:px-8">
        <Logo className="text-cloud" />
        <nav aria-label="Ana menü" className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-md px-3.5 py-2 text-[0.95rem] text-cloud/75 transition-colors hover:text-cloud">
              {l.label}
            </a>
          ))}
          <a href={REPO_URL} className="rounded-md px-3.5 py-2 text-[0.95rem] text-cloud/75 transition-colors hover:text-cloud">
            GitHub
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <a href="/giris?mod=giris" className="inline-block rounded-md px-2 py-2 text-[0.95rem] whitespace-nowrap text-cloud/75 transition-colors hover:text-cloud sm:px-3.5">
            Giriş
          </a>
          <CtaLink href="/giris" size="sm">
            Başla
          </CtaLink>
        </div>
      </div>
    </header>
  )
}
