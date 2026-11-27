import { useEffect, useState } from "react"
import { toast } from "sonner"
import { CopyIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export function LinksCard({
  overlayToken,
  viewToken,
  onRotate,
}: {
  overlayToken: string
  viewToken: string
  onRotate: () => void
}) {
  const origin = typeof window === "undefined" ? "" : window.location.origin
  const overlayUrl = `${origin}/o/${overlayToken}`
  const viewUrl = `${origin}/v/${viewToken}`
  const [qr, setQr] = useState("")
  useEffect(() => {
    void import("qrcode").then((q) => q.toDataURL(viewUrl, { margin: 1, width: 220 }).then(setQr))
  }, [viewUrl])

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text)
    toast.success("Kopyalandı")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-cond text-2xl font-extrabold">1. OBS'e ekle</CardTitle>
        <CardDescription>
          OBS'te sahnene <b>Tarayıcı (Browser)</b> kaynağı ekle, bu adresi yapıştır, genişlik 1920, yükseklik 1080 yap ve
          oyun kaynağının üstüne koy. Bu adres gizli kalmalı, yayında gösterme.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex gap-2">
          <Input readOnly value={overlayUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <Button variant="outline" size="icon" aria-label="Overlay adresini kopyala" onClick={() => copy(overlayUrl)}>
            <CopyIcon />
          </Button>
        </div>
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <p className="text-sm font-medium">Altyazıyı sen de oku</p>
            <p className="text-sm text-muted-foreground">
              Konsolda TV'ye bakarken Türkçe satırları telefonda, tablette ya da ikinci ekranda gör. QR'ı okut ya da adresi
              aç. OBS'te <i>Docklar &gt; Özel Tarayıcı Dockları</i> ile panel olarak da ekleyebilirsin.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={viewUrl} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" aria-label="Telefon adresini kopyala" onClick={() => copy(viewUrl)}>
                <CopyIcon />
              </Button>
            </div>
          </div>
          {qr ? <img src={qr} alt="Telefon ekranı için QR kod" className="mx-auto size-36 rounded-md bg-white p-1" /> : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onRotate}>
          <RefreshCwIcon /> Adresleri yenile (eski adresler çalışmaz)
        </Button>
      </CardContent>
    </Card>
  )
}
