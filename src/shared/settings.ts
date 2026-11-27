import { z } from "zod"

/** Rectangle as fractions (0..1) of the captured frame. */
export const regionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
})
export type Region = z.infer<typeof regionSchema>

/** Default subtitle area: dialogue plus the mission objective line under it. */
export const DEFAULT_REGION: Region = { x: 0.12, y: 0.8, w: 0.76, h: 0.19 }
/** The earlier default, which stopped too high for objective descenders. */
const LEGACY_REGION: Region = { x: 0.12, y: 0.8, w: 0.76, h: 0.17 }

export const GAMES = {
  gta6: "GTA 6",
  generic: "Diğer oyunlar",
} as const
export type GameId = keyof typeof GAMES

export const FONTS = {
  inter: { label: "Inter", family: "'Inter Variable', sans-serif" },
  montserrat: { label: "Montserrat", family: "'Montserrat Variable', sans-serif" },
  roboto: { label: "Roboto", family: "'Roboto Variable', sans-serif" },
  nunito: { label: "Nunito (yuvarlak)", family: "'Nunito Variable', sans-serif" },
  rubik: { label: "Rubik (oyun)", family: "'Rubik Variable', sans-serif" },
  oswald: { label: "Oswald (dar)", family: "'Oswald Variable', sans-serif" },
  geist: { label: "Geist", family: "'Geist Variable', sans-serif" },
  system: { label: "Sistem (Arial)", family: "Arial, Helvetica, sans-serif" },
} as const
export type FontId = keyof typeof FONTS

/** Sizes are in pixels on a 1080p canvas and scale with the OBS source. */
export const styleSchema = z.object({
  /**
   * above: just above the English subtitle. below: just under it. cover: on top of it (best with a background).
   * top: top of the screen. custom: anywhere (customX/customY).
   */
  placement: z.enum(["above", "below", "cover", "top", "custom"]).default("above"),
  customX: z.number().min(0).max(1).default(0.5),
  customY: z.number().min(0).max(1).default(0.75),
  /** Max text width as a fraction of the screen. */
  width: z.number().min(0.2).max(1).default(0.8),
  /** Extra vertical nudge in px (1080p), applied to every placement. */
  offsetY: z.number().min(-300).max(300).default(0),
  align: z.enum(["left", "center", "right"]).default("center"),

  font: z.enum(Object.keys(FONTS) as [FontId, ...FontId[]]).default("inter"),
  fontSize: z.number().min(16).max(120).default(42),
  fontWeight: z.number().min(300).max(900).default(700),
  textColor: z.string().default("#ffffff"),
  uppercase: z.boolean().default(false),
  italic: z.boolean().default(false),
  lineHeight: z.number().min(0.9).max(2).default(1.25),
  letterSpacing: z.number().min(-0.05).max(0.3).default(0),

  outlineWidth: z.number().min(0).max(12).default(3),
  outlineColor: z.string().default("#000000"),
  shadow: z.boolean().default(true),
  shadowColor: z.string().default("#000000"),
  shadowBlur: z.number().min(0).max(40).default(8),

  background: z.boolean().default(false),
  boxColor: z.string().default("#000000"),
  boxOpacity: z.number().min(0).max(1).default(0.75),
  boxPadding: z.number().min(0).max(2).default(0.4),
  boxRadius: z.number().min(0).max(40).default(8),
  /** Box spans the full text width instead of hugging the text. */
  boxFullWidth: z.boolean().default(false),

  showEnglish: z.boolean().default(false),
  englishScale: z.number().min(0.3).max(1).default(0.55),
  englishColor: z.string().default("#d4d4d4"),

  /** Also read and translate the mission objective line games draw under the subtitles. */
  objectives: z.boolean().default(true),
  /** Objective line color and size relative to the dialogue line. */
  objectiveColor: z.string().default("#ffd166"),
  objectiveScale: z.number().min(0.5).max(1.2).default(0.8),

  animation: z.enum(["fade", "pop", "slide", "none"]).default("fade"),
  /** Seconds a line stays after the English subtitle disappears. */
  holdSeconds: z.number().min(0).max(10).default(1),
})
export type SubtitleStyle = z.infer<typeof styleSchema>
export const DEFAULT_STYLE: SubtitleStyle = styleSchema.parse({})

export const STYLE_PRESETS: { id: string; name: string; style: Partial<SubtitleStyle> }[] = [
  { id: "sade", name: "Sade (varsayılan)", style: {} },
  {
    id: "kutu",
    name: "Kutu, İngilizceyi kapatır",
    style: { placement: "cover", background: true, boxOpacity: 1, outlineWidth: 0, shadow: false },
  },
  { id: "sari", name: "Sarı klasik", style: { textColor: "#ffe14d", outlineWidth: 3, fontWeight: 700 } },
  { id: "buyuk", name: "Büyük ve kalın", style: { font: "montserrat", fontSize: 56, fontWeight: 800, outlineWidth: 4 } },
  { id: "minimal", name: "Minimal", style: { font: "geist", fontSize: 34, fontWeight: 600, outlineWidth: 2, shadowBlur: 4 } },
  {
    id: "neon",
    name: "Neon",
    style: { font: "rubik", fontWeight: 700, textColor: "#fdf4ff", outlineWidth: 2, outlineColor: "#86198f", shadowColor: "#e879f9", shadowBlur: 18 },
  },
  {
    id: "yarisaydam",
    name: "Yarı saydam şerit",
    style: { background: true, boxOpacity: 0.5, boxRadius: 4, outlineWidth: 0, shadow: true, shadowBlur: 4 },
  },
]

export const overlaySettingsSchema = z.object({
  game: z.enum(["gta6", "generic"]).default("gta6"),
  obs: z
    .object({
      url: z.string().default("ws://127.0.0.1:4455"),
      password: z.string().default(""),
      sourceName: z.string().default(""),
    })
    .default({ url: "ws://127.0.0.1:4455", password: "", sourceName: "" }),
  /**
   * Subtitle area in the game frame. GTA-style subtitles sit bottom center, and the mission objective
   * line under them reaches about 97.5% of the frame height (its descenders), so the area runs to 99%.
   */
  region: regionSchema.default(DEFAULT_REGION),
  /** Engine tuning, passed through to the subtitle reader. */
  engine: z.record(z.string(), z.union([z.number(), z.boolean(), z.string()])).default({}),
  style: styleSchema.prefault({}),
})
export type OverlaySettings = z.infer<typeof overlaySettingsSchema>

export function parseSettings(raw: unknown): OverlaySettings {
  const parsed = overlaySettingsSchema.safeParse(raw ?? {})
  const s = parsed.success ? parsed.data : overlaySettingsSchema.parse({})
  // The old default area stopped at 97% and cut the objective line's descenders: move it to the new one.
  const r = s.region
  if (r.x === LEGACY_REGION.x && r.y === LEGACY_REGION.y && r.w === LEGACY_REGION.w && r.h === LEGACY_REGION.h) {
    s.region = { ...DEFAULT_REGION }
  }
  return s
}

/**
 * Optional billing (see src/server/plan.ts). When it is on, usage is metered in active minutes: a minute
 * counts only when the overlay delivered at least one translated line in it, so menus, driving and talking
 * cost nothing. A minute covers up to LINES_PER_MINUTE lines; a script sending more uses more minutes.
 */
export type PlanInfo = {
  /** Polar is configured: accounts start on a trial and need the paid plan afterwards. */
  billing: boolean
  name: string
  /** Display price, such as "₺99/ay". Empty to hide it. */
  price: string
  trialMinutes: number
  /** Monthly cap for the paid plan. */
  fairUseMinutes: number
}
export const LINES_PER_MINUTE = 30
/** Polar checkout slug of the paid plan. */
export const PLAN_SLUG = "plan"

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** "2 sa 15 dk", "45 dk", "3 saat" */
export function fmtMinutes(min: number) {
  const m = Math.max(0, Math.round(min))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (!h) return `${r} dk`
  return r ? `${h} sa ${r} dk` : `${h} saat`
}

/** What the overlay is allowed to do right now. */
export type Entitlement = {
  active: boolean
  /** "open": billing is off, no limits. "paid": live subscription. */
  plan: "open" | "paid" | "trial" | null
  trialMinutesLeft: number
  /** Paid plan: active minutes used this calendar month. */
  monthMinutesUsed?: number
  reason?: "trial_over" | "fair_use"
}
