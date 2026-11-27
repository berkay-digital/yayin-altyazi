import { useId } from "react"

/**
 * Mark: "YA" cut into six caption stripes, the way subtitle lines stack.
 * Y in cream (the game's line), A in sunset orange (our Turkish line).
 */
const Y = "M0 0H13L22 19L31 0H44L28.5 33V58H15.5V33Z"
// A with its counter (even-odd) and the notch between its feet.
const A = "M59 0H71L101 58H87L80.5 45H53.5L47 58H33Z M65 14L74 34H56Z"

export function LogoMark({ className = "h-7 w-auto", mono = false }: { className?: string; mono?: boolean }) {
  const id = useId()
  return (
    <svg viewBox="0 0 101 58" className={className} aria-hidden>
      <defs>
        <mask id={`${id}-s`} maskUnits="userSpaceOnUse" x="0" y="0" width="101" height="58">
          {[0, 10.16, 20.32, 30.48, 40.64, 50.8].map((y) => (
            <rect key={y} x="0" y={y} width="101" height="7.2" fill="#fff" />
          ))}
        </mask>
      </defs>
      <g mask={`url(#${id}-s)`}>
        <path d={Y} fill={mono ? "currentColor" : "var(--cloud, #f3ece2)"} />
        <path d={A} fill={mono ? "currentColor" : "var(--sun, #ff6b3d)"} fillRule="evenodd" />
      </g>
    </svg>
  )
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <a href="/" aria-label="Yayın Altyazı ana sayfa" className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-[1.55rem] w-auto" />
      <span className="font-display text-[1.65rem] leading-none font-extrabold tracking-[-0.005em] whitespace-nowrap">yayın altyazı</span>
    </a>
  )
}
