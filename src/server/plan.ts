import type { PlanInfo } from "@/shared/settings"

function minutesFromEnv(name: string, fallback: number) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

/** Billing is on only when Polar is configured. Without it every account translates without limits. */
export function billingEnabled() {
  return Boolean(process.env.POLAR_ACCESS_TOKEN && process.env.POLAR_PRODUCT)
}

/** The paid plan as configured through the environment. Safe to send to the browser. */
export function planInfo(): PlanInfo {
  return {
    billing: billingEnabled(),
    name: process.env.PLAN_NAME || "Aylık",
    price: process.env.PLAN_PRICE || "",
    trialMinutes: minutesFromEnv("TRIAL_MINUTES", 180),
    fairUseMinutes: minutesFromEnv("FAIR_USE_MINUTES", 250 * 60),
  }
}

/** SIGNUP=closed turns off new accounts, for a private instance once your own account exists. */
export function signUpDisabled() {
  return process.env.SIGNUP === "closed"
}

/** Contact address shown for password resets and plan questions, or null when unset. */
export function supportEmail() {
  return process.env.SUPPORT_EMAIL || null
}
