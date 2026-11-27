import { sql } from "drizzle-orm"
import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"

// Better Auth core tables.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
})

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

// App tables.

/** One per user: secret overlay/viewer tokens and settings. */
export const profile = pgTable("profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  overlayToken: text("overlay_token").notNull().unique(),
  viewToken: text("view_token").notNull().unique(),
  settings: jsonb("settings").notNull().default({}),
  /** Active minutes of the free trial used (only counted while billing is on). */
  trialMinutesUsed: integer("trial_minutes_used").notNull().default(0),
  /** Unused; kept so existing databases need no migration. */
  trialWordsUsed: integer("trial_words_used").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

/** Current paid plan, kept in sync from Polar webhooks. */
export const subscription = pgTable("subscription", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(), // informational; any live row counts as the paid plan
  status: text("status").notNull(), // Polar status: active, trialing, canceled, past_due...
  polarSubscriptionId: text("polar_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  /** Manual grants (admin) bypass Polar. */
  manual: boolean("manual").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
})

/** Overlay minutes and translation counts per user per day. */
export const usageDay = pgTable(
  "usage_day",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    minutes: integer("minutes").notNull().default(0),
    aiMinutes: integer("ai_minutes").notNull().default(0),
    lines: integer("lines").notNull().default(0),
    /** Minutes in which at least one line was delivered (what billing meters). */
    activeMinutes: integer("active_minutes").notNull().default(0),
    /** English words of the lines delivered this day (stats only). */
    words: integer("words").notNull().default(0),
    cacheHits: integer("cache_hits").notNull().default(0),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.day] })],
)

/** Shared EN to TR line memory. Same story lines repeat across every streamer. */
export const translation = pgTable(
  "translation",
  {
  key: text("key").primaryKey(), // `${game}:${normalized english}`
  game: text("game").notNull(),
  en: text("en").notNull(),
  tr: text("tr").notNull(),
  source: text("source").notNull(), // "ai" | "human"
  model: text("model"), // the model, or "alias:<key>" for an OCR variant of another row
  hits: integer("hits").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  // Trigram index for near-miss lookups (OCR noise); needs the pg_trgm extension (migration 0002).
  (t) => [index("translation_key_trgm").using("gin", sql`${t.key} gin_trgm_ops`)],
)
