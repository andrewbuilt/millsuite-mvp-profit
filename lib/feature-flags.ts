// lib/feature-flags.ts
// Per-seat pricing with three tiers. Features are cumulative (each tier includes everything below it).
// Pricing: Starter $40/seat, Pro $75/seat, Pro+AI $100/seat

export const PLANS = ['starter', 'pro', 'pro-ai'] as const
export type Plan = typeof PLANS[number]

export const PLAN_LABELS: Record<Plan, string> = {
  starter: 'Starter',
  pro: 'Pro',
  'pro-ai': 'Pro + AI',
}

export const PLAN_SEAT_PRICE: Record<Plan, number> = {
  starter: 40,
  pro: 75,
  'pro-ai': 100,
}

export const PLAN_SEAT_MINIMUM: Record<Plan, number> = {
  starter: 1,
  pro: 3,
  'pro-ai': 5,
}

// ── Usage limits (per seat, per month) ──
export const PLAN_LIMITS: Record<Plan, { takeoffParses: number; aiReports: number }> = {
  starter: { takeoffParses: 3, aiReports: 2 },
  pro: { takeoffParses: -1, aiReports: 10 },       // -1 = unlimited
  'pro-ai': { takeoffParses: -1, aiReports: -1 },
}

// ── Feature access per tier ──

const STARTER_FEATURES = [
  'dashboard',
  'projects',
  'time',
  'settings',
  'invoices',
  'shop-rate',
  'ai-report',       // gated by usage limit, not feature flag
  'outcomes',
] as const

const PRO_FEATURES = [
  ...STARTER_FEATURES,
  'team',
  'departments',
  'capacity',
  'schedule',
  'production-calendar',
  'diagnostics',
  'sales',
  'pre-production',
  'quickbooks',
  'google-drive',
  'rate-book',
] as const

const PRO_AI_FEATURES = [
  ...PRO_FEATURES,
  'ai-estimating',
  'learning-loop',
  'financials',
  'custom-reporting',
] as const

const PLAN_FEATURES: Record<Plan, readonly string[]> = {
  starter: STARTER_FEATURES,
  pro: PRO_FEATURES,
  'pro-ai': PRO_AI_FEATURES,
}

export function hasAccess(plan: string | undefined | null, feature: string): boolean {
  const p = normalizePlan(plan)
  return PLAN_FEATURES[p]?.includes(feature) ?? false
}

export function getMinPlan(feature: string): Plan {
  for (const plan of PLANS) {
    if (PLAN_FEATURES[plan].includes(feature)) return plan
  }
  return 'pro-ai'
}

export function getPlanFeatures(plan: string): readonly string[] {
  return PLAN_FEATURES[normalizePlan(plan)] || STARTER_FEATURES
}

export function getSeatPrice(plan: string): number {
  return PLAN_SEAT_PRICE[normalizePlan(plan)]
}

export function getUsageLimits(plan: string, seatCount: number) {
  const limits = PLAN_LIMITS[normalizePlan(plan)]
  return {
    takeoffParses: limits.takeoffParses === -1 ? -1 : limits.takeoffParses * seatCount,
    aiReports: limits.aiReports === -1 ? -1 : limits.aiReports * seatCount,
  }
}

// Normalize legacy plan strings to current tiers
function normalizePlan(plan: string | undefined | null): Plan {
  const p = plan || 'starter'
  if (p === 'team' || p === 'enterprise') return 'pro-ai'
  if (PLANS.includes(p as Plan)) return p as Plan
  return 'starter'
}

/** Validate a plan string from an untrusted source (URL query param,
 *  request body) against the current PLANS list. Returns the typed
 *  Plan when it matches, null otherwise — caller picks the fallback.
 *  Use this for signup / API entry points; existing data should keep
 *  going through normalizePlan so legacy 'team' / 'trial' rows still
 *  resolve. */
export function validatePlan(plan: unknown): Plan | null {
  if (typeof plan !== 'string') return null
  return PLANS.includes(plan as Plan) ? (plan as Plan) : null
}
