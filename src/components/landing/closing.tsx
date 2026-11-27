import { Logo } from "@/components/brand"
import { REPO_URL } from "@/shared/site"
import { Container } from "./kit"

export function Footer() {
  return (
    <footer className="border-t border-cloud/[0.08] bg-ink-950">
      <Container className="grid gap-10 py-14 md:grid-cols-[1.4fr_1fr]">
        <div>
          <Logo className="text-cloud" />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-mist">
            Konsoldan yayın yapanlar için canlı Türkçe altyazı. Açık kaynak, MIT lisanslı.
          </p>
        </div>
        <nav aria-label="Bağlantılar" className="text-sm">
          <ul className="space-y-2.5 text-mist">
            <li><a className="hover:text-cloud" href="#nasil">Nasıl çalışır</a></li>
            <li><a className="hover:text-cloud" href="#kurulum">Kurulum</a></li>
            <li><a className="hover:text-cloud" href={REPO_URL}>Kaynak kodu (GitHub)</a></li>
            <li><a className="hover:text-cloud" href="/giris?mod=giris">Giriş</a></li>
          </ul>
        </nav>
      </Container>
      <Container className="border-t border-cloud/[0.08] py-6">
        <p className="text-xs leading-relaxed text-mist/80">
          Grand Theft Auto ve GTA, Take-Two Interactive Software, Inc.'in markalarıdır. Yayın Altyazı bağımsız, açık kaynaklı bir
          projedir; Rockstar Games veya Take-Two ile bağlantısı yoktur.
        </p>
      </Container>
    </footer>
  )
}
