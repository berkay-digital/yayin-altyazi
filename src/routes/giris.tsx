import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Loader2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Logo } from "@/components/brand"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import { getAuthConfig } from "@/lib/api"
import { Turnstile } from "@/components/turnstile"
import { fmtMinutes } from "@/shared/settings"

type Mode = "up" | "in"

/** `/giris?mod=giris` opens sign-in; anything else opens sign-up. */
export const Route = createFileRoute("/giris")({
  validateSearch: (search: Record<string, unknown>): { mod?: "giris" } => (search.mod === "giris" ? { mod: "giris" } : {}),
  head: () => ({ meta: [{ title: "Giriş · Yayın Altyazı" }] }),
  loader: () => getAuthConfig(),
  component: AuthPage,
})

const ERRORS: Record<string, string> = {
  USER_ALREADY_EXISTS: "Bu e-posta ile zaten bir hesap var. Giriş yap.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Bu e-posta ile zaten bir hesap var. Giriş yap.",
  INVALID_EMAIL_OR_PASSWORD: "E-posta veya şifre hatalı.",
  PASSWORD_TOO_SHORT: "Şifre en az 8 karakter olmalı.",
  INVALID_EMAIL: "Geçerli bir e-posta gir.",
  MISSING_RESPONSE: "Güvenlik doğrulaması bitmedi. Birkaç saniye bekleyip tekrar dene.",
  VERIFICATION_FAILED: "Güvenlik doğrulaması geçmedi. Sayfayı yenileyip tekrar dene.",
}

/** Layout from shadcn's login-04 / signup-04 blocks. */
function AuthPage() {
  const navigate = useNavigate()
  const { mod } = Route.useSearch()
  const { turnstileSiteKey, signUpOpen, trialMinutes, supportEmail } = Route.useLoaderData()
  const mode: Mode = mod === "giris" || !signUpOpen ? "in" : "up"
  const setMode = (m: Mode) => void navigate({ to: "/giris", search: m === "in" ? { mod: "giris" } : {}, replace: true })
  const [busy, setBusy] = useState(false)
  const up = mode === "up"
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaReset, setCaptchaReset] = useState(0)
  const [captchaClick, setCaptchaClick] = useState(false)
  const waitingCaptcha = Boolean(turnstileSiteKey) && !captcha

  async function submit(form: HTMLFormElement) {
    const fd = new FormData(form)
    const email = String(fd.get("email") ?? "").trim()
    const password = String(fd.get("password") ?? "")
    const name = String(fd.get("name") ?? "").trim() || email.split("@")[0]
    setBusy(true)
    const fetchOptions = captcha ? { headers: { "x-captcha-response": captcha } } : undefined
    const res = up
      ? await authClient.signUp.email({ email, password, name, fetchOptions })
      : await authClient.signIn.email({ email, password, fetchOptions })
    setBusy(false)
    // Turnstile tokens are single use.
    if (turnstileSiteKey) setCaptchaReset((n) => n + 1)
    if (res.error) {
      const msg = res.error.status === 429 ? "Çok fazla deneme yaptın. Biraz bekleyip tekrar dene." : ERRORS[res.error.code ?? ""]
      toast.error(msg ?? res.error.message ?? "Bir şeyler ters gitti.")
      return
    }
    await navigate({ to: "/panel" })
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-ink-950 p-5 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <Logo className="self-center text-cloud" />
        <Card className="overflow-hidden p-0 shadow-[0_40px_120px_-40px_color-mix(in_oklab,var(--sun)_30%,transparent)]">
          <CardContent className="p-0">
            {/* key: switching modes mounts a fresh form, so password managers rescan it instead of
                filling stale field positions from the other mode. */}
            <form
              key={mode}
              name={up ? "signup" : "login"}
              className="p-6 md:p-10"
              onSubmit={(e) => {
                e.preventDefault()
                void submit(e.currentTarget)
              }}
            >
              <FieldGroup>
                <div className="flex flex-col gap-2">
                  <h1 className="font-display text-[2.4rem] leading-none font-black text-cloud">{up ? "Hesabını aç" : "Tekrar hoş geldin"}</h1>
                  <p className="text-balance text-muted-foreground">
                    {!up
                      ? "Panele gir, yayına devam et."
                      : trialMinutes
                        ? `İlk ${fmtMinutes(trialMinutes)} çeviri ücretsiz. Kart gerekmez.`
                        : "Kayıt ol, OBS'e ekleyeceğin adresi al."}
                  </p>
                </div>
                {up ? (
                  <Field>
                    <FieldLabel htmlFor="name">Yayıncı adın</FieldLabel>
                    <Input id="name" name="name" placeholder="Kick / Twitch adın" autoComplete="nickname" className="h-11" />
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="email">E-posta</FieldLabel>
                  <Input id="email" name="email" type="email" placeholder="ornek@mail.com" required autoComplete="username" className="h-11" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">Şifre</FieldLabel>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    minLength={8}
                    required
                    autoComplete={up ? "new-password" : "current-password"}
                    className="h-11"
                  />
                  {up ? (
                    <FieldDescription>En az 8 karakter.</FieldDescription>
                  ) : supportEmail ? (
                    <FieldDescription>
                      Şifreni mi unuttun?{" "}
                      <a
                        className="text-cloud underline underline-offset-4"
                        href={`mailto:${supportEmail}?subject=${encodeURIComponent("Şifre sıfırlama")}&body=${encodeURIComponent("Hesabımın e-postası: ")}`}
                      >
                        {supportEmail}
                      </a>{" "}
                      adresine kayıtlı e-postandan yaz.
                    </FieldDescription>
                  ) : null}
                </Field>
                {turnstileSiteKey ? (
                  <Turnstile siteKey={turnstileSiteKey} onToken={setCaptcha} onNeedsClick={setCaptchaClick} resetKey={captchaReset} />
                ) : null}
                <Field>
                  <Button type="submit" disabled={busy || waitingCaptcha} className="h-11 text-[0.95rem] font-semibold">
                    {busy || (waitingCaptcha && !captchaClick) ? <Loader2Icon className="size-4 animate-spin" aria-hidden /> : null}
                    {waitingCaptcha
                      ? captchaClick
                        ? "Önce yukarıdaki kutuyu işaretle"
                        : "Güvenlik kontrolü…"
                      : up
                        ? trialMinutes
                          ? "Ücretsiz denemeyi başlat"
                          : "Hesap aç"
                        : "Giriş yap"}
                  </Button>
                </Field>
                {signUpOpen ? (
                  <FieldDescription className="text-center">
                    {up ? "Zaten hesabın var mı? " : "Hesabın yok mu? "}
                    <button type="button" className="font-medium text-cloud underline underline-offset-4" onClick={() => setMode(up ? "in" : "up")}>
                      {up ? "Giriş yap" : "Kayıt ol"}
                    </button>
                  </FieldDescription>
                ) : null}
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
