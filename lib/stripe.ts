// lib/stripe.ts
// Single typed Stripe client + per-tier price ID lookup.
//
// The price IDs live in env vars rather than the codebase so the same
// build can target test mode (sk_test_... + price_test_...) and live
// mode (sk_live_... + price_live_...) just by swapping env vars in
// Vercel. Stripe products and prices are NOT shared across modes — when
// flipping to live, recreate the products in live mode and update the
// env vars accordingly.

import Stripe from 'stripe'
import type { Plan } from './feature-flags'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY

// Lazy export — modules importing `stripe` at the top level shouldn't
// crash when STRIPE_SECRET_KEY isn't set in local dev. Routes that
// actually use Stripe should call getStripe() and handle the null.
export function getStripe(): Stripe | null {
  if (!STRIPE_SECRET_KEY) return null
  return new Stripe(STRIPE_SECRET_KEY, {
    // Pin the API version so behavior doesn't shift under us when Stripe
    // releases new versions. Bump deliberately.
    apiVersion: '2024-12-18.acacia',
    typescript: true,
  })
}

// Per-tier env var names — kept aligned with the legacy fallback in the
// original /api/checkout stub. STRIPE_PRICE_ID is the single-tier
// fallback used when only one tier is wired up (which is true for the
// first customer — only Pro+AI exists in Stripe right now).
export const PLAN_PRICE_ENV: Record<Plan, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  'pro-ai': 'STRIPE_PRICE_PRO_AI',
}

export function resolvePriceId(plan: Plan): string | null {
  const envKey = PLAN_PRICE_ENV[plan]
  return process.env[envKey] || process.env.STRIPE_PRICE_ID || null
}
