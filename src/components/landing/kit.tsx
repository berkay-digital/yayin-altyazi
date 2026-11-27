import { motion, useReducedMotion } from "motion/react"
import type { ReactNode } from "react"

export const EASE = [0.22, 1, 0.36, 1] as const

/** Fades and lifts content in once when it scrolls into view. */
export function Reveal({
  children,
  delay = 0,
  y = 26,
  className,
}: {
  children: ReactNode
  delay?: number
  y?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  )
}

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-[1320px] px-5 sm:px-8 ${className}`}>{children}</div>
}

export function SectionHead({
  title,
  sub,
  align = "left",
  id,
}: {
  title: ReactNode
  sub?: ReactNode
  align?: "left" | "center"
  id?: string
}) {
  return (
    <Reveal className={align === "center" ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <h2 id={id} className="font-display text-[clamp(2.7rem,5.6vw,4.8rem)] leading-[1] font-black tracking-[-0.01em] text-balance text-cloud">
        {title}
      </h2>
      {sub ? <p className={`mt-5 max-w-[38rem] text-[1.0625rem] leading-relaxed text-pretty text-mist ${align === "center" ? "mx-auto" : ""}`}>{sub}</p> : null}
    </Reveal>
  )
}

export function CtaLink({ href, children, size = "lg" }: { href: string; children: ReactNode; size?: "lg" | "sm" }) {
  return (
    <a
      href={href}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] bg-sun font-semibold whitespace-nowrap text-on-sun shadow-[0_12px_40px_-12px_color-mix(in_oklab,var(--sun)_75%,transparent)] transition-[transform,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:bg-sun-soft hover:shadow-[0_18px_50px_-12px_color-mix(in_oklab,var(--sun)_90%,transparent)] focus-visible:ring-2 focus-visible:ring-sun focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 focus-visible:outline-none active:translate-y-0 ${
        size === "lg" ? "h-[3.25rem] px-6 text-[1.02rem]" : "h-10 px-4 text-[0.92rem]"
      }`}
    >
      {children}
    </a>
  )
}

export function GhostLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="inline-flex h-[3.25rem] items-center justify-center gap-2 rounded-[10px] border border-cloud/25 px-6 font-semibold text-cloud transition-colors hover:border-cloud/45 hover:bg-cloud/[0.06] focus-visible:ring-2 focus-visible:ring-sun focus-visible:outline-none"
    >
      {children}
    </a>
  )
}
