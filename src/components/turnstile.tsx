import { useEffect, useRef } from "react"

type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id: string) => void
  remove: (id: string) => void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<void> | null = null
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement("script")
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => {
      scriptPromise = null
      reject(new Error("turnstile script failed"))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

/**
 * Cloudflare Turnstile in managed mode: invisible for most people, a checkbox only when Cloudflare is
 * unsure. Calls onToken with a fresh single-use token, or null when it expires. Bump `resetKey` after
 * each submit to get a new token.
 */
export function Turnstile({
  siteKey,
  onToken,
  onNeedsClick,
  resetKey,
}: {
  siteKey: string
  onToken: (t: string | null) => void
  /** True while Cloudflare shows its checkbox and waits for a click. */
  onNeedsClick?: (needs: boolean) => void
  resetKey: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useRef<string | null>(null)
  const cb = useRef(onToken)
  cb.current = onToken
  const needs = useRef(onNeedsClick)
  needs.current = onNeedsClick

  useEffect(() => {
    let gone = false
    void loadScript()
      .then(() => {
        if (gone || !ref.current || !window.turnstile) return
        id.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          appearance: "interaction-only",
          theme: "dark",
          language: "tr",
          callback: (t: string) => {
            needs.current?.(false)
            cb.current(t)
          },
          "before-interactive-callback": () => needs.current?.(true),
          "after-interactive-callback": () => needs.current?.(false),
          "expired-callback": () => cb.current(null),
          "error-callback": () => cb.current(null),
        })
      })
      .catch(() => cb.current(null))
    return () => {
      gone = true
      if (id.current && window.turnstile) window.turnstile.remove(id.current)
      id.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetKey && id.current && window.turnstile) {
      cb.current(null)
      window.turnstile.reset(id.current)
    }
  }, [resetKey])

  return <div ref={ref} className="flex justify-center empty:hidden" />
}
