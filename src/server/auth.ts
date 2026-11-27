import { betterAuth } from "better-auth"
import { captcha } from "better-auth/plugins"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { tanstackStartCookies } from "better-auth/tanstack-start"
import { checkout, polar, portal, webhooks } from "@polar-sh/better-auth"
import { createPolarCore } from "@polar-sh/sdk/2026-10"
import { db, schema } from "./db"
import { randomToken } from "./crypto"
import { syncSubscription } from "./billing"
import { billingEnabled, signUpDisabled } from "./plan"
import { clientIpHeaders } from "./rate-limit"
import { PLAN_SLUG } from "@/shared/settings"

/** Optional billing through Polar, on when POLAR_ACCESS_TOKEN and POLAR_PRODUCT are set. */
function polarPlugins() {
  if (!billingEnabled()) return []
  const client = createPolarCore({
    accessToken: process.env.POLAR_ACCESS_TOKEN!,
    environment: process.env.POLAR_ENV === "production" ? "production" : "sandbox",
  })
  return [
    polar({
      client,
      // The plugin would create the Polar customer in an after-create hook and throw when Polar rejects
      // the email or is down, failing sign-up after the user row exists. Checkout passes
      // external_customer_id = user.id instead, so Polar creates the customer there.
      createCustomerOnSignUp: false,
      use: [
        checkout({
          products: [{ productId: process.env.POLAR_PRODUCT!, slug: PLAN_SLUG }],
          successUrl: "/panel?odeme=tamam&checkout_id={CHECKOUT_ID}",
          authenticatedUsersOnly: true,
        }),
        portal(),
        // Without a secret the signature check would use an empty key, so anyone could forge events.
        ...(process.env.POLAR_WEBHOOK_SECRET
          ? [
              webhooks({
                secret: process.env.POLAR_WEBHOOK_SECRET,
                onPayload: async (payload) => {
                  const p = payload as { type: string; data: unknown }
                  if (p.type.startsWith("subscription.")) {
                    await syncSubscription(p.data as Parameters<typeof syncSubscription>[0])
                  }
                },
              }),
            ]
          : []),
      ],
    }),
  ]
}

/**
 * Turnstile on sign-up and sign-in: every account can spend translation calls on the server's API key,
 * so scripted sign-ups cost money. Off when TURNSTILE_SECRET_KEY is unset.
 */
function captchaPlugins() {
  const secretKey = process.env.TURNSTILE_SECRET_KEY
  if (!secretKey) return []
  return [captcha({ provider: "cloudflare-turnstile", secretKey, endpoints: ["/sign-up/email", "/sign-in/email"] })]
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  advanced: {
    // Client address for rate limits: CLIENT_IP_HEADER first (cf-connecting-ip behind Cloudflare), then X-Forwarded-For.
    ipAddress: { ipAddressHeaders: clientIpHeaders() },
  },
  rateLimit: {
    enabled: process.env.NODE_ENV === "production",
    window: 60,
    max: 100,
    customRules: {
      // Each account can translate on the server's key: few sign-ups per address per hour.
      "/sign-up/email": { window: 3600, max: 5 },
      "/sign-in/email": { window: 60, max: 10 },
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification },
  }),
  emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true, disableSignUp: signUpDisabled() },
  session: { expiresIn: 60 * 60 * 24 * 60 },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await db
            .insert(schema.profile)
            .values({ userId: user.id, overlayToken: randomToken(), viewToken: randomToken(12) })
            .onConflictDoNothing()
        },
      },
    },
  },
  plugins: [...captchaPlugins(), ...polarPlugins(), tanstackStartCookies()],
})
