import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { GAMES, type OverlaySettings } from "@/shared/settings"

export function TranslateCard({ settings, onChange }: { settings: OverlaySettings; onChange: (s: OverlaySettings) => void }) {
  const gameItems = Object.entries(GAMES).map(([value, label]) => ({ value, label }))
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-cond text-2xl font-extrabold">3. Çeviri</CardTitle>
        <CardDescription>Çeviri sunucuda yapılır; API anahtarı ya da başka bir ayar gerekmez. Sadece oynadığın oyunu seç.</CardDescription>
      </CardHeader>
      <CardContent>
        <Field className="max-w-sm">
          <FieldLabel>Oyun</FieldLabel>
          <Select items={gameItems} value={settings.game} onValueChange={(v) => onChange({ ...settings, game: v as OverlaySettings["game"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {gameItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>Karakter adları ve argo bu oyuna göre çevrilir.</FieldDescription>
        </Field>
      </CardContent>
    </Card>
  )
}
