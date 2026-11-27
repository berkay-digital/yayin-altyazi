// Compare translation models on GTA-style lines. Usage: tsx scripts/eval-models.ts model1 model2 ...
// Needs EVAL_BASE_URL and EVAL_API_KEY (OpenAI-compatible, e.g. OpenRouter).
import { chatTranslate } from "../src/server/llm"

const LINES = [
  "Hey, where the hell have you been? We gotta move, now!",
  "You think I'm gonna let some punk-ass cop ruin this for us?",
  "Relax, babe. I got this. Just keep the engine running.",
  "This whole city's a scam, man. Everybody's hustling somebody.",
  "Bro, that was insane! Did you see the look on his face?",
  "If we pull this off, we're out. No more of this shit.",
  "Lucia, listen to me. We stick together, or we don't do it at all.",
  "Get in the car! Go, go, go!",
  "Nah, nah, nah. That's not how this works, Jason.",
  "Yo, you're live right now? Say hi to the chat!",
  "I swear to God, if you screw this up, I'm leaving you in Vice City.",
  "Lose the cops before heading to the safehouse.",
  "Ya know what? Screw it. Let's hit the bank.",
  "You owe me, big time.",
  "Take the boat to Leonida Keys and meet Cal at the marina.",
]

const baseUrl = process.env.EVAL_BASE_URL ?? "https://openrouter.ai/api/v1"
const apiKey = process.env.EVAL_API_KEY ?? ""
const extra = process.env.EVAL_EXTRA ? JSON.parse(process.env.EVAL_EXTRA) : undefined

for (const model of process.argv.slice(2)) {
  const prev: { en: string; tr: string }[] = []
  let tin = 0, tout = 0, ms = 0
  console.log(`\n=== ${model}`)
  for (const en of LINES) {
    const t0 = Date.now()
    try {
      const r = await chatTranslate({ baseUrl, apiKey, model, extraBody: extra }, "gta6", en, prev)
      const dt = Date.now() - t0
      ms += dt; tin += r.tokensIn; tout += r.tokensOut
      prev.push({ en, tr: r.tr })
      console.log(`${String(dt).padStart(5)}ms  ${r.tr}`)
    } catch (e) {
      console.log("ERR", String(e).slice(0, 200))
    }
  }
  console.log(`avg ${Math.round(ms / LINES.length)}ms, tokens in/out per line ${Math.round(tin / LINES.length)}/${Math.round(tout / LINES.length)}`)
}
