import { AnimatePresence, motion } from "motion/react"
import { PlusIcon } from "lucide-react"
import { useId, useState } from "react"
import { Container, EASE, Reveal, SectionHead } from "./kit"

const QA = [
  ["Neye ihtiyacım var?", "PS5 ya da Xbox, bir capture kart ve OBS Studio 28 veya üstü. Oyunun ayarlarında İngilizce altyazılar açık olmalı."],
  [
    "Gecikme ne kadar?",
    "Daha önce çevrilmiş satırlar anında gelir, yeni satırlar bir saniyenin altında ekranda olur. Türkçe satır, İngilizcesi ekranda kaldığı sürece ekranda kalır.",
  ],
  ["Hangi oyunlarda çalışır?", "Altyazısı olan her oyunda. GTA 6 için karakter, yer adı ve argo sözlüğü hazır, diğer oyunlarda genel mod çalışır."],
  [
    "Görev yazıları da çevriliyor mu?",
    "Evet. Altyazının altındaki görev yazısı ayrı okunur ve kısa bir Türkçe talimat olarak kendi satırında, kendi renginde görünür. İstersen panelden kapatabilirsin.",
  ],
  [
    "OBS'te hangi kaynağı seçmeliyim?",
    "Capture kartını ya da oyun yakalama kaynağını. Sahne seçme: sahne, Türkçe yazının kendisini de içerdiği için okuma şaşar. Panel seni uyarır.",
  ],
  ["Streamlabs ile çalışıyor mu?", "Hayır, şimdilik sadece OBS Studio. Overlay, OBS'in yerleşik obs-websocket bağlantısını kullanır."],
  ["Oyun görüntüm sunucuya gidiyor mu?", "Hayır. Görüntü bilgisayarında, OBS'in içinde işlenir. Sunucuya sadece okunan İngilizce satır gider."],
  [
    "Çeviri için ne gerekiyor?",
    "Sunucuda bir Anthropic API anahtarı (Claude Haiku) ya da OpenAI uyumlu herhangi bir API. Aynı satırlar ortak hafızaya yazıldığı için tekrar eden satırlar için yeniden ödeme yapılmaz.",
  ],
  ["Kaynak kodu nerede?", "GitHub'da, MIT lisansıyla. Kendi sunucunda çalıştırabilirsin; tek maliyet kullandığın çeviri API'si."],
  ["Rockstar ile bağlantısı var mı?", "Hayır. Yayın Altyazı bağımsız bir projedir. Oyuna ya da dosyalarına dokunmaz, sadece yayın görüntüsündeki yazıyı okur."],
]

export function Faq() {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="sss" aria-labelledby="sss-title" className="scroll-mt-20 py-16 md:py-24">
      <Container className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <SectionHead id="sss-title" title="Sık sorulanlar" />
        <Reveal>
          <ul className="divide-y divide-cloud/10 border-y border-cloud/10">
            {QA.map(([q, a], k) => (
              <Item key={q} q={q} a={a} open={open === k} onToggle={() => setOpen(open === k ? null : k)} />
            ))}
          </ul>
        </Reveal>
      </Container>
    </section>
  )
}

function Item({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  const id = useId()
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-6 py-5 text-left text-[1.05rem] font-semibold text-cloud focus-visible:text-sun focus-visible:outline-none"
      >
        {q}
        <motion.span animate={{ rotate: open ? 45 : 0 }} transition={{ duration: 0.25 }} className="shrink-0 text-mist">
          <PlusIcon className="size-5" aria-hidden />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={id}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <p className="max-w-prose pb-5 leading-relaxed text-mist">{a}</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </li>
  )
}
