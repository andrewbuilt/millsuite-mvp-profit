// lib/pricing.ts
// Project pricing math — the single source of truth for turning costs
// into a customer price.
//
// Pricing model (migration 052): three independent TRUE gross-margin
// knobs applied to three groups of cost buckets:
//
//   labor margin      → labor + install        (shop time)
//   material margin   → material + hardware + options (purchased goods + upcharges)
//   consumable margin → consumables
//
// Each group: groupPrice = groupCost / (1 - margin/100). The project
// price is the sum of the three group prices. Because true margin is
// additive across buckets, equal knobs reproduce the old single-knob
// price exactly — see migration 052.
//
// NOTE: computeShopRate (below) still treats its "target profit %" as a
// MARKUP on cost (cost × (1 + p/100)), which is a different meaning of
// "profit %" than the project margins here. That's a deliberate, separate
// decision — changing it would re-price every shop's hourly rate. Don't
// conflate the two knobs.

export interface CostBuckets {
  laborCost: number
  materialCost: number
  hardwareCost: number
  consumablesCost: number
  installCost: number
  optionsCost: number
  /** Freeform / vendor lines priced by `unit_price_override` — the modal's
   *  "Cost each" × qty. These carry no hours and no component breakdown (the
   *  price IS the cost), so they can't land in any other bucket, and before
   *  this existed they were dropped from every rollup and priced at $0.
   *
   *  REQUIRED, not optional, on purpose: a money bucket that can be silently
   *  omitted is how the original bug survived. Make the compiler ask. */
  customCost: number
}

export interface BucketMargins {
  laborMarginPct: number
  materialMarginPct: number
  consumableMarginPct: number
}

export interface BucketedPrice {
  // Group costs (the three knobs' worth of cost)
  laborGroupCost: number // labor + install
  materialGroupCost: number // material + hardware + options
  consumableGroupCost: number // consumables
  // Group prices (each group's cost marked up by its own true margin)
  laborPrice: number
  materialPrice: number
  consumablePrice: number
  // Totals
  costTotal: number
  priceTotal: number
  marginAmount: number
  blendedMarginPct: number // effective margin across the whole project
}

/** Margin source shape — projects and orgs both expose these nullable
 *  columns. NULL means "inherit" (project → org → DEFAULT_MARGIN_PCT). */
export interface MarginSource {
  labor_margin_pct?: number | null
  material_margin_pct?: number | null
  consumable_margin_pct?: number | null
}

export const DEFAULT_MARGIN_PCT = 35

/**
 * Resolve the effective per-bucket margins for a project: each bucket
 * resolves independently as project pin → org default → 35. Centralizes
 * the inherit/fallback rule so every read path agrees.
 */
export function resolveBucketMargins(
  project: MarginSource | null | undefined,
  org: MarginSource | null | undefined,
): BucketMargins {
  const pick = (p?: number | null, o?: number | null) =>
    p ?? o ?? DEFAULT_MARGIN_PCT
  return {
    laborMarginPct: pick(project?.labor_margin_pct, org?.labor_margin_pct),
    materialMarginPct: pick(project?.material_margin_pct, org?.material_margin_pct),
    consumableMarginPct: pick(
      project?.consumable_margin_pct,
      org?.consumable_margin_pct,
    ),
  }
}

function marginFraction(pct: number): number {
  return Math.min(Math.max(pct / 100, 0), 0.99)
}

/** Mark a cost up to a customer price using a TRUE gross margin. */
function priceFromMargin(cost: number, pct: number): number {
  const f = marginFraction(pct)
  return f > 0 ? cost / (1 - f) : cost
}

/**
 * The canonical cost→price function. Buckets are grouped per the migration-
 * 052 mapping, each group is marked up by its own true margin, and the
 * three group prices are summed. Returns every intermediate value so the
 * UI can show the math transparently (cost → margin → price per group,
 * plus the blended margin).
 */
export function computeBucketedPrice(
  buckets: CostBuckets,
  margins: BucketMargins,
): BucketedPrice {
  const laborGroupCost = buckets.laborCost + buckets.installCost
  // Custom/vendor lines group with material: they're overwhelmingly bought
  // goods (a vendor product, a one-off slab), and it's where optionsCost —
  // the other "flat dollars, no hours" bucket — already sits. Grouping them
  // with labor would mark bought goods up at the labor margin.
  const materialGroupCost =
    buckets.materialCost + buckets.hardwareCost + buckets.optionsCost + buckets.customCost
  const consumableGroupCost = buckets.consumablesCost

  const laborPrice = priceFromMargin(laborGroupCost, margins.laborMarginPct)
  const materialPrice = priceFromMargin(
    materialGroupCost,
    margins.materialMarginPct,
  )
  const consumablePrice = priceFromMargin(
    consumableGroupCost,
    margins.consumableMarginPct,
  )

  const costTotal = laborGroupCost + materialGroupCost + consumableGroupCost
  const priceTotal = laborPrice + materialPrice + consumablePrice
  const marginAmount = priceTotal - costTotal
  const blendedMarginPct =
    priceTotal > 0 ? (marginAmount / priceTotal) * 100 : 0

  return {
    laborGroupCost: round(laborGroupCost),
    materialGroupCost: round(materialGroupCost),
    consumableGroupCost: round(consumableGroupCost),
    laborPrice: round(laborPrice),
    materialPrice: round(materialPrice),
    consumablePrice: round(consumablePrice),
    costTotal: round(costTotal),
    priceTotal: round(priceTotal),
    marginAmount: round(marginAmount),
    blendedMarginPct: round(blendedMarginPct, 1),
  }
}

/**
 * Compute project-level P&L from actuals.
 */
export function computeProjectPL(params: {
  bidTotal: number
  actualLaborCost: number
  actualMaterialCost: number
}) {
  const actualTotal = params.actualLaborCost + params.actualMaterialCost
  const variance = params.bidTotal - actualTotal
  const variancePct = params.bidTotal > 0 ? (variance / params.bidTotal) * 100 : 0

  return {
    bidTotal: round(params.bidTotal),
    actualTotal: round(actualTotal),
    actualLaborCost: round(params.actualLaborCost),
    actualMaterialCost: round(params.actualMaterialCost),
    variance: round(variance),
    variancePct: round(variancePct, 1),
    isOverBudget: variance < 0,
  }
}

/**
 * Compute shop rate from overhead inputs.
 */
export function computeShopRate(params: {
  monthlyRent: number
  monthlyUtilities: number
  monthlyInsurance: number
  monthlyEquipment: number
  monthlyMisc: number
  ownerSalary: number
  totalPayroll: number
  targetProfitPct: number
  workingDaysPerMonth: number
  hoursPerDay: number
}) {
  const monthlyOverhead = params.monthlyRent + params.monthlyUtilities +
    params.monthlyInsurance + params.monthlyEquipment + params.monthlyMisc
  const monthlyLaborCost = params.ownerSalary + params.totalPayroll
  const totalMonthlyCost = monthlyOverhead + monthlyLaborCost
  const productionHoursPerMonth = params.workingDaysPerMonth * params.hoursPerDay
  const costPerHour = productionHoursPerMonth > 0 ? totalMonthlyCost / productionHoursPerMonth : 0
  const shopRate = costPerHour * (1 + params.targetProfitPct / 100)

  return {
    monthlyOverhead: round(monthlyOverhead),
    monthlyLaborCost: round(monthlyLaborCost),
    totalMonthlyCost: round(totalMonthlyCost),
    productionHoursPerMonth: round(productionHoursPerMonth),
    costPerHour: round(costPerHour),
    shopRate: round(shopRate),
  }
}

function round(n: number, decimals = 2) {
  const factor = Math.pow(10, decimals)
  return Math.round(n * factor) / factor
}
