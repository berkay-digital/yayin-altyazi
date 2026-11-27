import { eq } from "drizzle-orm"
import { db, schema } from "./db"

type SubscriptionLike = {
  id?: string
  status?: string
  product_id?: string | null
  current_period_end?: string | Date | null
  customer?: { external_id?: string | null } | null
  metadata?: Record<string, unknown> | null
}

/** Upserts the subscription row from a Polar subscription webhook payload for the configured product. */
export async function syncSubscription(sub: SubscriptionLike) {
  const userId = sub.customer?.external_id
  if (!userId || !sub.status || !sub.product_id || sub.product_id !== process.env.POLAR_PRODUCT) return
  const row = {
    userId,
    plan: "paid",
    status: sub.status,
    polarSubscriptionId: sub.id ?? null,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
    manual: false,
    updatedAt: new Date(),
  }
  await db
    .insert(schema.subscription)
    .values(row)
    .onConflictDoUpdate({ target: schema.subscription.userId, set: row })
}

export async function getSubscription(userId: string) {
  const [row] = await db.select().from(schema.subscription).where(eq(schema.subscription.userId, userId))
  if (!row) return null
  const live =
    (row.status === "active" || row.status === "trialing" || row.manual) &&
    (!row.currentPeriodEnd || row.currentPeriodEnd.getTime() > Date.now() - 6 * 3600_000)
  return { ...row, live }
}
