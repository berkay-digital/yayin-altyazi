import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import { overlaySettingsSchema } from "@/shared/settings"

async function requireUser() {
  const { auth } = await import("@/server/auth")
  const { dbReady } = await import("@/server/db")
  await dbReady
  const session = await auth.api.getSession({ headers: getRequestHeaders() as unknown as Headers })
  if (!session) throw new Error("unauthorized")
  return session.user
}

/**
 * Public auth page config: the Turnstile site key (public by design, null when Turnstile is off), whether
 * sign-up is open, the trial length when billing is on, and the optional support address.
 */
export const getAuthConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { planInfo, signUpDisabled, supportEmail } = await import("@/server/plan")
  const plan = planInfo()
  return {
    turnstileSiteKey: process.env.TURNSTILE_SECRET_KEY ? (process.env.TURNSTILE_SITE_KEY ?? null) : null,
    signUpOpen: !signUpDisabled(),
    trialMinutes: plan.billing ? plan.trialMinutes : null,
    supportEmail: supportEmail(),
  }
})

export const getMe = createServerFn({ method: "GET" }).handler(async () => {
  const { auth } = await import("@/server/auth")
  const { dbReady } = await import("@/server/db")
  await dbReady
  const session = await auth.api.getSession({ headers: getRequestHeaders() as unknown as Headers })
  return session ? { id: session.user.id, email: session.user.email, name: session.user.name } : null
})

export const getDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser()
  const { db, schema } = await import("@/server/db")
  const { profileByUser, entitlementFor } = await import("@/server/overlay")
  const { getSubscription } = await import("@/server/billing")
  const { planInfo, supportEmail } = await import("@/server/plan")
  const { eq, desc } = await import("drizzle-orm")
  const { randomToken } = await import("@/server/crypto")
  const { parseSettings } = await import("@/shared/settings")
  let profile = await profileByUser(user.id)
  if (!profile) {
    await db
      .insert(schema.profile)
      .values({ userId: user.id, overlayToken: randomToken(), viewToken: randomToken(12) })
      .onConflictDoNothing()
    profile = (await profileByUser(user.id))!
  }
  const [entitlement, sub, usage] = await Promise.all([
    entitlementFor(profile),
    getSubscription(user.id),
    db.select().from(schema.usageDay).where(eq(schema.usageDay.userId, user.id)).orderBy(desc(schema.usageDay.day)).limit(30),
  ])
  return {
    user: { email: user.email, name: user.name },
    overlayToken: profile.overlayToken,
    viewToken: profile.viewToken,
    settings: parseSettings(profile.settings),
    entitlement,
    subscription: sub ? { status: sub.status, live: sub.live, currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null } : null,
    usage: usage.map((u) => ({ day: String(u.day), minutes: u.minutes, activeMinutes: u.activeMinutes, lines: u.lines, cacheHits: u.cacheHits })),
    plan: planInfo(),
    supportEmail: supportEmail(),
  }
})

export const saveSettings = createServerFn({ method: "POST" })
  .validator((d: unknown) => {
    const parsed = overlaySettingsSchema.parse(d)
    // Real settings are about 2 KB; refuse anything that is clearly not settings.
    if (JSON.stringify(parsed).length > 20_000) throw new Error("settings too large")
    return parsed
  })
  .handler(async ({ data }) => {
    const user = await requireUser()
    const { db, schema } = await import("@/server/db")
    const { eq } = await import("drizzle-orm")
    await db.update(schema.profile).set({ settings: data, updatedAt: new Date() }).where(eq(schema.profile.userId, user.id))
    return { ok: true }
  })

export const rotateTokens = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireUser()
  const { db, schema } = await import("@/server/db")
  const { eq } = await import("drizzle-orm")
  const { randomToken } = await import("@/server/crypto")
  await db
    .update(schema.profile)
    .set({ overlayToken: randomToken(), viewToken: randomToken(12), updatedAt: new Date() })
    .where(eq(schema.profile.userId, user.id))
  return { ok: true }
})

/** What the streamer's overlay is doing right now, polled by the panel every few seconds. */
export const getLiveStatus = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser()
  const { profileByUser, entitlementFor } = await import("@/server/overlay")
  const { liveStatus } = await import("@/server/live-status")
  const profile = await profileByUser(user.id)
  if (!profile) return { status: null, entitlement: null }
  return { status: liveStatus(profile.overlayToken), entitlement: await entitlementFor(profile) }
})
