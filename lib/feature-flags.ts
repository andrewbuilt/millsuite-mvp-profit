// lib/feature-flags.ts
// Per-seat pricing with three tiers. Features are cumulative (each tier includes everything below it).
// Pricing: Profit $49/seat, Pro $99/seat, Pro+ $119/seat
//
// Internal plan keys (database, Stripe metadata) stay as 'starter' | 'pro' |
// 'pro-ai' so we don't have to migrate orgs.plan or rewrite Stripe metadata.
// Display names are the only thing that changed in the rebrand: Profit / Pro
// / Pro+. Plan keys are stable identifiers; PLAN_LABELS is what users see.

export const PLANS = ['starter', 'pro', 'pro-ai'] as const
export type Plan = typeof PLANS[number]

export const PLAN_LABELS: Record<Plan, string> = {
  starter: 'Profit',
  pro: 'Pro',
  'pro-ai': 'Pro+',
}

export const PLAN_SEAT_PRICE: Record<Plan, number> = {
  starter: 49,
  pro: 99,
  'pro-ai': 119,
}

export const PLAN_SEAT_MINIMUM: Record<Plan, number> = {
  starter: 1,
  pro: 3,
  'pro-ai': 5,
}

// ── Usage limits ──
// aiReports is per-org per-month (NOT multiplied by seat count). The
// Profit tier gets a monthly report, Pro gets bi-weekly (2/mo), Pro+
// gets weekly (4/mo). Caps stay deliberately small so the AI report
// feels like a deliverable rather than a throwaway.
//
// takeoffParses applies only to Pro+ since the drawing parser is gated
// behind the 'ai-estimating' feature flag — Profit and Pro never reach
// the limit check at all. Kept at -1 (unlimited) for Pro+, 0 elsewhere
// so a stray code path can't run a parse without a feature gate.
export const PLAN_LIMITS: Record<Plan, { takeoffParses: number; aiReports: number }> = {
  starter: { takeoffParses: 0, aiReports: 1 },
  pro: { takeoffParses: 0, aiReports: 2 },
  'pro-ai': { takeoffParses: -1, aiReports: 4 },
}

// ── Feature access per tier ──
//
// Hybrid breakdown (PR #113):
//   Profit (Tier 1): bare-bones for 1-3 person shops. Track work, time,
//     invoices, project outcomes. Team management included so a small
//     shop can add their helper.
//   Pro   (Tier 2): full operational package without AI bells. Sales
//     pipeline (manual leads), rate book, learning loop, pre-production,
//     QuickBooks (optional), capacity calendar.
//   Pro+  (Tier 3): everything in Pro plus the AI extras — drawing
//     parser, week-by-week schedule with AI assistant, diagnostics
//     drawer (margin waterfall on /reports).

const STARTER_FEATURES = [
  'dashboard',
  'projects',
  'time',
  'settings',
  'invoices',
  'shop-rate',
  'ai-report',       // gated by usage limit (1/mo), not feature flag
  'outcomes',
  'team',            // moved down from Pro — small shops need to add a helper
] as const

const PRO_FEATURES = [
  ...STARTER_FEATURES,
  'departments',
  'capacity',           // 12-month planning view (PTO + holidays)
  'sales',              // Leads kanban — drop zone gated by 'ai-estimating' inside the page
  'pre-production',
  'quickbooks',         // optional integration
  'rate-book',
  'learning-loop',      // moved down from Pro+AI — Suggestions feed the rate book
] as const

const PRO_AI_FEATURES = [
  ...PRO_FEATURES,
  'schedule',           // week-by-week department dispatch + AI chat assistant
  'production-calendar',// merged with /schedule (no separate page)
  'diagnostics',        // margin waterfall drawer on /reports
  'ai-estimating',      // drawing parser drop zone on /sales
] as const

// NOTE: removed 'financials', 'custom-reporting', 'google-drive' — they
// were flag stubs with no UI. Don't sell what's not built.

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
    // Drawing parser (takeoffs) — Pro+ only, unlimited. seatCount irrelevant
    // because the feature is route-gated, but kept multiplied for legacy
    // callers in case anything still passes it through.
    takeoffParses: limits.takeoffParses === -1 ? -1 : limits.takeoffParses * seatCount,
    // AI shop reports — per ORG per month (NOT per seat). The cap should
    // feel like a deliverable, not a per-head allowance: 1/mo on Profit,
    // 2/mo on Pro, 4/mo on Pro+. Keeping it small makes it feel special.
    aiReports: limits.aiReports,
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

// ── Subscription status (from orgs.plan_status, set by stripe-webhook) ──
//
// Two separate questions the app needs to answer:
//   1. Does this PLAN allow this FEATURE? → hasAccess()
//   2. Is the subscription paid up? → hasActiveSubscription()
// Components combine the two (e.g. PlanGate checks both before rendering).

export const PLAN_STATUSES = [
  'pending',     // signed up, hasn't paid yet
  'active',      // subscription in good standing
  'past_due',    // recurring charge failed; grace period before downgrade
  'canceled',    // canceled and period ended
  'incomplete',  // initial payment failed or 3DS pending
] as const
export type PlanStatus = typeof PLAN_STATUSES[number]

/** Subscription is in good standing — full access granted.
 *  past_due is a soft state — Stripe will retry. We treat it as still-
 *  active to avoid yanking access during a transient card failure;
 *  the billing banner nudges them to update their card. If the dunning
 *  cycle exhausts, Stripe sends customer.subscription.deleted and we
 *  flip to 'canceled'. */
export function hasActiveSubscription(planStatus: string | undefined | null): boolean {
  return planStatus === 'active' || planStatus === 'past_due'
}
