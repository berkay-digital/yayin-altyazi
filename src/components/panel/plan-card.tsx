import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { authClient } from "@/lib/auth-client"
import { fmtMinutes, PLAN_SLUG, type Entitlement, type PlanInfo } from "@/shared/settings"

type Sub = { status: string; live: boolean; currentPeriodEnd: string | null } | null

/** Trial and paid plan. Only shown when billing is on. */
export function PlanCard({
  entitlement,
  subscription,
  plan,
  supportEmail,
}: {
  entitlement: Entitlement
  subscription: Sub
  plan: PlanInfo
  supportEmail: string | null
}) {
  const live = Boolean(subscription?.live)
  const trialUsed = plan.trialMinutes - entitlement.trialMinutesLeft
  const monthUsed = entitlement.monthMinutesUsed ?? 0
  const contact = supportEmail ? ` ${supportEmail} adresine yaz.` : ""

  async function buy() {
    const res = await (authClient as unknown as { checkout: (o: { slug: string }) => Promise<{ error?: { message?: string } }> }).checkout({
      slug: PLAN_SLUG,
    })
    if (res?.error) toast.error(res.error.message ?? "Ödeme sayfası açılamadı.")
  }

  async function portal() {
    await (authClient as unknown as { customer: { portal: () => Promise<unknown> } }).customer.portal()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-cond flex items-center gap-2 text-2xl font-extrabold">
          Paketin
          {live ? (
            <Badge>{plan.name}</Badge>
          ) : entitlement.active ? (
            <Badge variant="secondary">Deneme</Badge>
          ) : (
            <Badge variant="destructive">Deneme bitti</Badge>
          )}
        </CardTitle>
        <CardDescription>
          {live
            ? subscription?.currentPeriodEnd
              ? `Yenileme: ${new Date(subscription.currentPeriodEnd).toLocaleDateString("tr-TR")}`
              : "Aktif"
            : `Ücretsiz deneme: ${fmtMinutes(plan.trialMinutes)} çeviri. Sadece altyazı çevrilen dakikalar sayılır; menüler, sürüş ve sohbet saymaz.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {live ? (
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span>Bu ay çeviri yapılan süre</span>
              <span className="tabular-nums text-muted-foreground">{fmtMinutes(monthUsed)}</span>
            </div>
            {monthUsed > plan.fairUseMinutes * 0.8 ? (
              <p className="text-sm text-amber-400">Adil kullanım sınırı ayda {fmtMinutes(plan.fairUseMinutes)}. Sınıra yaklaştın.</p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span>Kullanılan deneme süresi</span>
              <span className="tabular-nums text-muted-foreground">
                {fmtMinutes(trialUsed)} / {fmtMinutes(plan.trialMinutes)}
              </span>
            </div>
            <Progress value={plan.trialMinutes ? (trialUsed / plan.trialMinutes) * 100 : 100} />
          </div>
        )}
        {entitlement.reason === "fair_use" ? (
          <p className="text-sm text-amber-400">Bu ayki adil kullanım sınırına ulaştın.{contact}</p>
        ) : null}

        {!live ? (
          <div className="rounded-lg border border-altyazi/70 bg-altyazi/5 p-4">
            <div className="flex items-baseline justify-between">
              <span className="font-medium">{plan.name}</span>
              {plan.price ? <span className="text-lg font-semibold tabular-nums">{plan.price}</span> : null}
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>• Sınırsız Türkçe altyazı, görev yazıları dahil</li>
              <li>• Telefon ekranı ve tüm stil ayarları</li>
              <li>• İstediğin zaman iptal</li>
            </ul>
            <Button className="mt-3 w-full sm:w-auto" onClick={() => void buy()}>
              {plan.name} pakete geç
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void portal()}>
            Aboneliği yönet / iptal et
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
