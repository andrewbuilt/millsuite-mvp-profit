// lib/financial-engine.ts
// Shared financial computation engine for the reporting architecture.
// Computes shop grade, utilization confidence, margin analysis.
// Pure functions — no React, no Supabase. Takes data in, returns computations.

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface WeeklySnapshot {
  id: string
  week_start: string
  shop_rate: number | null
  utilization_assumed: number
  utilization_actual: number | null
  total_revenue: number
  total_labor_cost: number
  total_material_cost: number
  total_overhead: number
  gross_margin_pct: number | null
  headcount: number
  billable_hours: number
  paid_hours: number
  projects_active: number
  projects_shipped: number
}

export interface ProjectOutcome {
  id: string
  project_id: string
  estimated_hours: number
  estimated_materials: number
  estimated_price: number
  actual_hours: number
  actual_labor_cost: number
  actual_materials: number
  actual_revenue: number
  actual_margin: number
  actual_margin_pct: number
  hours_variance: number
  hours_variance_pct: number
  material_variance: number
  material_variance_pct: number
  dept_hours_estimated: Record<string, number> | null
  dept_hours_actual: Record<string, number> | null
  shop_rate_at_completion: number | null
  utilization_at_completion: number | null
  change_order_count: number
  change_order_revenue: number
  completed_at: string
}

export interface ShopEvent {
  id: string
  event_date: string
  event_type: string
  title: string
  description: string | null
  financial_impact: number | null
  person_name: string | null
}

// ═══════════════════════════════════════════════════════════════
// SHOP GRADE
// ═══════════════════════════════════════════════════════════════

export interface ShopGrade {
  overall: string          // A, B, C, D, F
  overallScore: number     // 0-100
  projectScore: number     // 0-100
  projectGrade: string
  shopScore: number        // 0-100
  shopGrade: string
  estimateHitRate: number  // % of projects at or under estimated hours
  avgMargin: number        // average actual margin %
  utilizationGap: number   // actual - assumed (negative = bad)
  marginOverstatement: number // estimated margin adjustment due to utilization gap
}

function letterGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

export function computeShopGrade(
  outcomes: ProjectOutcome[],
  latestSnapshot: WeeklySnapshot | null
): ShopGrade {
  // Axis 1: Project execution
  const hitCount = outcomes.filter(o => o.actual_hours <= o.estimated_hours * 1.05).length // 5% tolerance
  const estimateHitRate = outcomes.length > 0 ? (hitCount / outcomes.length) * 100 : 0
  const avgMargin = outcomes.length > 0
    ? outcomes.reduce((s, o) => s + o.actual_margin_pct, 0) / outcomes.length
    : 0

  // Project score: 50% hit rate + 50% margin performance
  const targetMargin = 25 // target margin %
  const marginScore = Math.min(100, (avgMargin / targetMargin) * 100)
  const projectScore = Math.round((estimateHitRate * 0.5) + (marginScore * 0.5))

  // Axis 2: Shop efficiency
  const utilizationAssumed = latestSnapshot?.utilization_assumed || 80
  const utilizationActual = latestSnapshot?.utilization_actual || 0
  const utilizationGap = utilizationActual - utilizationAssumed

  // Shop score based on how close actual utilization is to assumed
  // 100 = actual >= assumed, decreases as gap widens
  const shopScore = Math.max(0, Math.min(100, Math.round(100 + (utilizationGap * 2.5))))

  // Margin overstatement from utilization gap
  // If rate assumed 80% and actual is 76%, every hour was underpriced
  // Rough: each point of utilization gap ≈ 0.5 points of margin overstatement
  const marginOverstatement = utilizationGap < 0 ? Math.abs(utilizationGap) * 0.5 : 0

  const overallScore = Math.round((projectScore + shopScore) / 2)

  return {
    overall: letterGrade(overallScore),
    overallScore,
    projectScore,
    projectGrade: letterGrade(projectScore),
    shopScore,
    shopGrade: letterGrade(shopScore),
    estimateHitRate: Math.round(estimateHitRate),
    avgMargin: Math.round(avgMargin * 10) / 10,
    utilizationGap: Math.round(utilizationGap * 10) / 10,
    marginOverstatement: Math.round(marginOverstatement * 10) / 10,
  }
}

// ═══════════════════════════════════════════════════════════════
// UTILIZATION CONFIDENCE
// ═══════════════════════════════════════════════════════════════

export interface UtilizationConfidence {
  assumed: number
  actual: number
  gap: number
  marginAdjustment: number
  status: 'healthy' | 'warning' | 'critical'
  message: string
}

export function computeUtilizationConfidence(
  assumed: number,
  actualBillable: number,
  actualPaid: number
): UtilizationConfidence {
  const actual = actualPaid > 0 ? (actualBillable / actualPaid) * 100 : 0
  const gap = actual - assumed
  const marginAdjustment = gap < 0 ? Math.abs(gap) * 0.5 : 0

  let status: 'healthy' | 'warning' | 'critical' = 'healthy'
  let message = ''

  if (gap >= 0) {
    status = 'healthy'
    message = `Utilization is ${actual.toFixed(0)}%, meeting the ${assumed}% assumption. Project margins are reliable.`
  } else if (gap >= -5) {
    status = 'warning'
    message = `Utilization is ${actual.toFixed(0)}% vs ${assumed}% assumed. Margins may be overstated by ~${marginAdjustment.toFixed(1)} points.`
  } else {
    status = 'critical'
    message = `Utilization is ${actual.toFixed(0)}% vs ${assumed}% assumed. All project margins are overstated by ~${marginAdjustment.toFixed(1)} points.`
  }

  return { assumed, actual: Math.round(actual * 10) / 10, gap: Math.round(gap * 10) / 10, marginAdjustment: Math.round(marginAdjustment * 10) / 10, status, message }
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC WATERFALL
// ═══════════════════════════════════════════════════════════════

export interface WaterfallItem {
  label: string
  value: number
  type: 'positive' | 'negative' | 'neutral' | 'total'
  detail: string
}

export function computeWaterfall(outcome: ProjectOutcome): WaterfallItem[] {
  const items: WaterfallItem[] = []

  // Start: estimated margin
  const estimatedCost = (outcome.estimated_hours * (outcome.shop_rate_at_completion || 75)) + outcome.estimated_materials
  const estimatedMargin = outcome.estimated_price - estimatedCost
  const estimatedMarginPct = outcome.estimated_price > 0 ? (estimatedMargin / outcome.estimated_price) * 100 : 0

  items.push({
    label: 'Estimated Margin',
    value: estimatedMarginPct,
    type: 'neutral',
    detail: `$${Math.round(estimatedMargin).toLocaleString()} (${estimatedMarginPct.toFixed(1)}%)`,
  })

  // Hours variance impact
  const hoursOverUnder = outcome.actual_hours - outcome.estimated_hours
  const hoursCostImpact = hoursOverUnder * (outcome.shop_rate_at_completion || 75)
  const hoursMarginImpact = outcome.estimated_price > 0 ? -(hoursCostImpact / outcome.estimated_price) * 100 : 0

  items.push({
    label: 'Hours Variance',
    value: hoursMarginImpact,
    type: hoursMarginImpact >= 0 ? 'positive' : 'negative',
    detail: `${hoursOverUnder > 0 ? '+' : ''}${Math.round(hoursOverUnder)}h (${hoursOverUnder > 0 ? 'over' : 'under'} estimate)`,
  })

  // Material variance impact
  const materialOverUnder = outcome.actual_materials - outcome.estimated_materials
  const materialMarginImpact = outcome.estimated_price > 0 ? -(materialOverUnder / outcome.estimated_price) * 100 : 0

  items.push({
    label: 'Material Variance',
    value: materialMarginImpact,
    type: materialMarginImpact >= 0 ? 'positive' : 'negative',
    detail: `${materialOverUnder > 0 ? '+' : ''}$${Math.round(Math.abs(materialOverUnder)).toLocaleString()} ${materialOverUnder > 0 ? 'over' : 'under'} budget`,
  })

  // Revenue variance — the net difference between what was estimated and what was collected.
  // This captures everything: change orders, discounts, partial payments, extras.
  // We show it as one clear line rather than splitting CO revenue and "adjustment"
  // separately (which made COs look like they cancelled themselves out).
  const revenueGap = outcome.actual_revenue - outcome.estimated_price
  if (Math.abs(revenueGap) > 1) {
    const revenueImpact = outcome.estimated_price > 0 ? (revenueGap / outcome.estimated_price) * 100 : 0

    // Build a descriptive detail line
    let detail = ''
    if (outcome.change_order_revenue > 0 && Math.abs(revenueGap) > 1) {
      const coCount = outcome.change_order_count || 1
      const otherGap = revenueGap - outcome.change_order_revenue
      if (Math.abs(otherGap) <= 1) {
        // Revenue change is fully explained by change orders
        detail = `${coCount} change order${coCount !== 1 ? 's' : ''} added $${Math.round(outcome.change_order_revenue).toLocaleString()}`
      } else {
        // Change orders plus other adjustments
        detail = `${coCount} CO${coCount !== 1 ? 's' : ''} ($${Math.round(outcome.change_order_revenue).toLocaleString()}) ${otherGap > 0 ? '+' : ''}${otherGap <= -1 ? `$${Math.round(Math.abs(otherGap)).toLocaleString()} discount/shortfall` : `$${Math.round(otherGap).toLocaleString()} other`}`
      }
    } else {
      detail = `${revenueGap > 0 ? '+' : '-'}$${Math.round(Math.abs(revenueGap)).toLocaleString()} vs estimate`
    }

    items.push({
      label: revenueGap >= 0 ? 'Revenue Gained' : 'Revenue Lost',
      value: revenueImpact,
      type: revenueImpact >= 0 ? 'positive' : 'negative',
      detail,
    })
  }

  // Final: actual margin
  items.push({
    label: 'Actual Margin',
    value: outcome.actual_margin_pct,
    type: 'total',
    detail: `$${Math.round(outcome.actual_margin).toLocaleString()} (${outcome.actual_margin_pct.toFixed(1)}%)`,
  })

  return items
}

// ═══════════════════════════════════════════════════════════════
// TRAJECTORY HELPERS
// ═══════════════════════════════════════════════════════════════

export function computeTrailingAvg(
  snapshots: WeeklySnapshot[],
  field: keyof WeeklySnapshot,
  windowSize: number = 4
): { week: string; value: number; avg: number }[] {
  return snapshots.map((s, i) => {
    const window = snapshots.slice(Math.max(0, i - windowSize + 1), i + 1)
    const values = window.map(w => (w[field] as number) || 0)
    const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0
    return { week: s.week_start, value: (s[field] as number) || 0, avg: Math.round(avg * 100) / 100 }
  })
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY STATS
// ═══════════════════════════════════════════════════════════════

export interface OutcomeSummary {
  totalProjects: number
  totalRevenue: number
  totalProfit: number
  avgMargin: number
  estimateHitRate: number
  bestProject: { name: string; margin: number } | null
  worstProject: { name: string; margin: number } | null
}

export function computeOutcomeSummary(
  outcomes: (ProjectOutcome & { project_name?: string })[]
): OutcomeSummary {
  if (outcomes.length === 0) {
    return { totalProjects: 0, totalRevenue: 0, totalProfit: 0, avgMargin: 0, estimateHitRate: 0, bestProject: null, worstProject: null }
  }

  const totalRevenue = outcomes.reduce((s, o) => s + o.actual_revenue, 0)
  const totalProfit = outcomes.reduce((s, o) => s + o.actual_margin, 0)
  const avgMargin = outcomes.reduce((s, o) => s + o.actual_margin_pct, 0) / outcomes.length
  const hitCount = outcomes.filter(o => o.actual_hours <= o.estimated_hours * 1.05).length
  const estimateHitRate = (hitCount / outcomes.length) * 100

  const sorted = [...outcomes].sort((a, b) => b.actual_margin_pct - a.actual_margin_pct)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]

  return {
    totalProjects: outcomes.length,
    totalRevenue: Math.round(totalRevenue),
    totalProfit: Math.round(totalProfit),
    avgMargin: Math.round(avgMargin * 10) / 10,
    estimateHitRate: Math.round(estimateHitRate),
    bestProject: best ? { name: (best as any).project_name || 'Unknown', margin: Math.round(best.actual_margin_pct * 10) / 10 } : null,
    worstProject: worst ? { name: (worst as any).project_name || 'Unknown', margin: Math.round(worst.actual_margin_pct * 10) / 10 } : null,
  }
}
