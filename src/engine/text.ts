/**
 * OCR text cleanup and line comparison.
 */

export interface OcrWord {
  text: string
  confidence: number
}

export interface OcrLineInput {
  words: OcrWord[]
}

export interface CleanOptions {
  /** Lines whose mean word confidence is below this (0..100) are dropped. */
  minConfidence?: number
  /** Edge words below this confidence are trimmed as stray marks. */
  edgeWordConfidence?: number
}

export interface CleanResult {
  text: string
  confidence: number
}

const QUOTES: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  "`": "'",
  "´": "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "″": '"',
  "–": "-",
  "—": "-",
  "…": "...",
}

const LETTER = /\p{L}/u

function countLetters(s: string): number {
  let n = 0
  for (const ch of s) if (LETTER.test(ch)) n++
  return n
}

/** Fix character confusions inside a single token. */
function fixToken(tok: string): string {
  if (tok === "|" || tok === "l" || tok === "1" || tok === "i") return "I"
  // "|m", "|'m", "i'm", "|;" -> "I'm", "I;"
  tok = tok.replace(/^[|il1]'?m$/, "I'm").replace(/^[|]'?(ll|d|ve)$/, "I'$1")
  tok = tok.replace(/^\|(?=[^\p{L}]|$)/u, "I")
  // Contractions with a misread I: "l'm", "|'ll", "1'd".
  tok = tok.replace(/^[|l1]('(?:m|ll|d|ve|s)\b)/, "I$1")
  if (tok === "|t" || tok === "lt") return "It"
  if (/^[|l]f$/.test(tok)) return "If"
  if (/^[|l]s$/.test(tok)) return "Is"
  if (/^[|l]n$/.test(tok)) return "In"

  const core = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
  const letters = countLetters(core)
  const digits = (core.match(/\d/g) ?? []).length
  // Mostly-letter words with stray digits or pipes: 0 -> o, 1/| -> l, 5 -> s.
  if (letters >= 2 && digits > 0 && digits < letters) {
    tok = tok
      .replace(/(?<=\p{L})0|0(?=\p{L})/gu, "o")
      .replace(/(?<=\p{L})[1|]|[1|](?=\p{Ll})/gu, "l")
      .replace(/(?<=\p{Ll})5(?=\p{Ll})/gu, "s")
  }
  tok = tok.replace(/(?<=\p{L})\|(?=\p{L})/gu, "l")
  // Capital I inside a lowercase word is almost always l: "heIlo" -> "hello".
  if (/\p{Ll}I\p{Ll}|\p{Ll}\p{Ll}I\b/u.test(tok) && !/^[A-Z]{2,}/.test(tok)) {
    tok = tok.replace(/(?<=\p{Ll})I(?=\p{Ll})|(?<=\p{Ll}\p{Ll})I(?=$|[^\p{L}])/gu, "l")
  }
  return tok
}

/** Contractions whose apostrophe small subtitle fonts often lose. */
const CONTRACTIONS: Record<string, string> = {
  dont: "don't",
  aint: "ain't",
  isnt: "isn't",
  doesnt: "doesn't",
  didnt: "didn't",
  wasnt: "wasn't",
  werent: "weren't",
  couldnt: "couldn't",
  wouldnt: "wouldn't",
  shouldnt: "shouldn't",
  havent: "haven't",
  hasnt: "hasn't",
  hadnt: "hadn't",
  arent: "aren't",
  cant: "can't",
  youre: "you're",
  theyre: "they're",
  youve: "you've",
  theyve: "they've",
  weve: "we've",
  youll: "you'll",
  theyll: "they'll",
  thats: "that's",
  whats: "what's",
  theres: "there's",
  heres: "here's",
  wheres: "where's",
  hes: "he's",
  shes: "she's",
  im: "I'm",
  ive: "I've",
  ya: "ya",
}

function fixContraction(tok: string): string {
  const m = /^(\p{L}+)(.*)$/u.exec(tok)
  if (!m) return tok
  const fixed = CONTRACTIONS[m[1].toLowerCase()]
  if (!fixed || fixed === m[1]) return tok
  const cased = /^\p{Lu}/u.test(m[1]) && fixed[0] !== "I" ? fixed[0].toUpperCase() + fixed.slice(1) : fixed
  return cased + m[2]
}

/**
 * Tesseract often reads a capital I in this kind of sans-serif font as "!".
 * An exclamation mark is never followed by a lowercase word in subtitles, so
 * those are fixed here.
 */
function fixBangI(s: string): string {
  return (
    s
      // "Shit,! m doing" -> "Shit, I'm doing", "Nah,! ain't" -> "Nah, I ain't"
      .replace(/([,;:])\s*!\s*'?m\b/g, "$1 I'm")
      .replace(/([,;:])!(?=\s)/g, "$1 I")
      // "But! know" -> "But I know"
      .replace(/(\p{L})!(?=\s+\p{Ll})/gu, "$1 I")
      // Standalone "!" before a lowercase word.
      .replace(/(^|\s)!(?=\s+\p{Ll})/gu, "$1I")
      // "!'m", "!'ll" at a word start.
      .replace(/(^|\s)!(?='(?:m|ll|d|ve)\b)/g, "$1I")
      // "foo!, man" -> "fool, man": a bang inside punctuation after letters.
      .replace(/(\p{Ll})!(?=[,.;:])/gu, "$1l")
      // "I m" -> "I'm" after the fixes above.
      .replace(/\bI m\b/g, "I'm")
      .replace(/\bI ll\b/g, "I'll")
  )
}

/** Normalize punctuation and spacing in already joined text. */
export function tidyText(input: string): string {
  let s = input
  for (const [from, to] of Object.entries(QUOTES)) s = s.split(from).join(to)
  // Joined hyphenation across a line break: "some-\nthing" -> "something".
  s = s.replace(/(\p{Ll})-\s*\n\s*(\p{Ll})/gu, "$1$2")
  s = s.replace(/\s+/g, " ").trim()
  // Stray marks at the edges: leading "- ", "~", "_", "|" or trailing "|", "_".
  s = s.replace(/^[\s\-~_|=*•·.,;:]+(?=[\p{L}\p{N}"'¿¡(.])/u, (m) => (m.trim() === "..." ? "..." : ""))
  s = s.replace(/[\s~_|=*•·]+$/u, "")
  s = fixBangI(s)
  s = s
    .split(" ")
    .map((t) => fixContraction(fixToken(t)))
    .join(" ")
  // Space before closing punctuation, missing space after sentence punctuation.
  s = s.replace(/\s+([.,!?;:%)])/g, "$1")
  s = s.replace(/([(])\s+/g, "$1")
  s = s.replace(/([,!?;])(?=\p{L})/gu, "$1 ")
  s = s.replace(/\.{4,}/g, "...")
  s = s.replace(/\s{2,}/g, " ").trim()
  return s
}

/**
 * Turn Tesseract line/word output into one clean subtitle line, or null if it
 * looks like garbage.
 */
export function cleanOcrLines(lines: OcrLineInput[], opts: CleanOptions = {}): CleanResult | null {
  const minConfidence = opts.minConfidence ?? 40
  const edgeConf = opts.edgeWordConfidence ?? 40
  const kept: string[] = []
  let confSum = 0
  let confWeight = 0
  for (const line of lines) {
    const words = line.words.filter((w) => w.text.trim().length > 0)
    // Trim low-confidence junk at the line edges (speck, outline fragment).
    while (words.length && isEdgeJunk(words[0], edgeConf)) words.shift()
    while (words.length && isEdgeJunk(words[words.length - 1], edgeConf)) words.pop()
    if (words.length === 0) continue
    const text = words.map((w) => w.text).join(" ")
    const letters = countLetters(text)
    // A whole line that is mostly symbols is noise.
    if (letters < 2 || letters / text.replace(/\s/g, "").length < 0.5) continue
    for (const w of words) {
      const weight = Math.max(1, countLetters(w.text))
      confSum += w.confidence * weight
      confWeight += weight
    }
    kept.push(text)
  }
  if (kept.length === 0 || confWeight === 0) return null
  const confidence = confSum / confWeight
  const text = tidyText(kept.join("\n"))
  if (!isPlausibleText(text)) return null
  if (confidence < minConfidence) return null
  return { text, confidence }
}

/** Short words that are real and often read with low confidence. */
const SHORT_WORDS = new Set(
  "i a o an as at be by do go he hi if in is it me my no of oh ok on or so to up us we ya yo uh eh ah hm".split(" "),
)

function isEdgeJunk(w: OcrWord, edgeConf: number): boolean {
  const letters = countLetters(w.text)
  if (letters === 0) return !/^(\.{3}|[-"'!?]|\d+[%$]?)$/.test(w.text)
  if (w.confidence < edgeConf && letters <= 2) {
    const core = w.text.replace(/[^\p{L}]/gu, "").toLowerCase()
    return !SHORT_WORDS.has(core) && !/^[|!1l]$/.test(w.text.trim())
  }
  return false
}

const INTERJECTION = /^(m+h*m+|m+h+m+|h+m+|h+m+p+h+|s+h+|p+s+t+|p+f+t+|b+r+|g+r+|t+s+k+|z+|n+h+)$/i

/** Text that is long enough and mostly letters. */
export function isPlausibleText(text: string): boolean {
  const compact = text.replace(/\s/g, "")
  if (compact.length < 2) return false
  const letters = countLetters(compact)
  if (letters < 2) return false
  if (letters / compact.length < 0.6) return false
  // Words made of only one letter repeated, or no vowel at all in a long
  // word, point at texture read as text. Vowelless interjections ("Mm-hmm",
  // "Shhh", "Psst", "Hmph") are real subtitle lines.
  const words = text
    .split(" ")
    .filter((w) => countLetters(w) >= 4 && !INTERJECTION.test(w.replace(/[^\p{L}]/gu, "")))
  const vowelless = words.filter((w) => !/[aeiouyAEIOUY]/.test(w)).length
  if (words.length > 0 && vowelless / words.length > 0.5) return false
  return true
}

/**
 * Lowercase, strip punctuation, collapse spaces. Used as the shared
 * translation cache key, so keep it stable.
 */
export function normalizeForCache(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/** Levenshtein distance, O(min(a,b)) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length < b.length) [a, b] = [b, a]
  if (b.length === 0) return a.length
  let prev = new Uint32Array(b.length + 1)
  let cur = new Uint32Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    const ca = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
    }
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** 1 - normalized Levenshtein distance on normalized text (1 = same). */
export function similarity(a: string, b: string): number {
  const na = normalizeForCache(a)
  const nb = normalizeForCache(b)
  const max = Math.max(na.length, nb.length)
  if (max === 0) return 1
  return 1 - levenshtein(na, nb) / max
}

/**
 * True when `next` is `prev` with more text appended (word-by-word reveal),
 * allowing small OCR differences in the shared part.
 */
export function isExtension(prev: string, next: string, minSimilarity = 0.85): boolean {
  const np = normalizeForCache(prev)
  const nn = normalizeForCache(next)
  if (nn.length <= np.length) return false
  const head = nn.slice(0, np.length)
  const max = Math.max(head.length, np.length)
  return max > 0 && 1 - levenshtein(head, np) / max >= minSimilarity
}
