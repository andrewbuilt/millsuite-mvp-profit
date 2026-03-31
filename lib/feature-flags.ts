// lib/feature-flags.ts
// Plan-based feature gating. Single source of truth for what each tier can access.

export const PLANS = ['starter', 'pro', 'team', 'enterprise'] as const
export type Plan = typeof PLANS[number]

export const PLAN_LABELS: Record<Plan, string> = {
  starter: 'Starter',
  pro: 'Pro',
  team: 'Team',
  enterprise: 'Enterprise',
}

// Features available per plan (cumulative — each tier includes everything below it)
const STARTER_FEATURES = [
  'dashboard',
  'projects',
  'time',
  'settings',
  'invoices',
  'shop-rate',
  'ai-report',
] as const

const PRO_FEATURES = [
  ...STARTER_FEATURES,
  'team',
  'departments',
  'capacity',
  'schedule',
  'production-calendar',
] as const

const TEAM_FEATURES = [
  ...PRO_FEATURES,
  'leads',
  'pre-production',
  'financials',
  'portal',
  'ai-estimating',
  'quickbooks',
  'google-drive',
] as const

const ENTERPRISE_FEATURES = [
  ...TEAM_FEATURES,
  'custom-reporting',
  'api-access',
  'sso',
] as const

const PLAN_FEATURES: Record<Plan, readonly string[]> = {
  starter: STARTER_FEATURES,
  pro: PRO_FEATURES,
  team: TEAM_FEATURES,
  enterprise: ENTERPRISE_FEATURES,
}

export function hasAccess(plan: string | undefined | null, feature: string): boolean {
  const p = (plan || 'starter') as Plan
  return PLAN_FEATURES[p]?.includes(feature) ?? false
}

export function getMinPlan(feature: string): Plan {
  for (const plan of PLANS) {
    if (PLAN_FEATURES[plan].includes(feature)) return plan
  }
  return 'enterprise'
}

export function getPlanFeatures(plan: string): readonly string[] {
  return PLAN_FEATURES[(plan || 'starter') as Plan] || STARTER_FEATURES
}
