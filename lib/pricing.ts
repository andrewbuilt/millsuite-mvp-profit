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

/** The bits of a project row that decide how its lines are priced. */
export interface PricingProjectSource {
  imported_at?: string | null
  locked_shop_rate?: number | null
}

/** The bit of a SUBPROJECT row that decides whether its lines are frozen. */
export interface PricingSubSource {
  price_frozen?: boolean | null
}

/**
 * ⛔ THE MARGIN TO USE FOR SCOPE ADDED AFTER AN IMPORT.
 *
 * The import freeze is TWO mechanisms stacked, and fixing one without the
 * other still gives the work away:
 *   1. rate 0 + consumables 0  — handled by `isSubFrozen` / migration 108.
 *   2. the importer PINS `projects.*_margin_pct` to 0 ("the price is the
 *      price"), so `resolveBucketMargins` returns zeros for the whole project.
 *
 * Leave (2) alone and a change order's new scope prices at raw COST: labor and
 * material with no markup at all. So for the LIVE half of an imported project
 * the pins are ignored — they are an artifact of the freeze, not a decision
 * about what new work is worth — and margin resolves from the org (→ 35).
 *
 * ⚠️ THE COST: a margin Andrew pinned BY HAND on an imported job is
 * indistinguishable from the importer's zeros, so it won't apply to new scope
 * there. That's the safe side of the trade — the alternative is billing a
 * change order at cost — but it's the thing to remember if a CO on an imported
 * job ever prices higher than expected.
 *
 * Native projects are completely unaffected: their pins are real and are used.
 */
export function resolveMarginsForNewScope(
  project: (MarginSource & PricingProjectSource) | null | undefined,
  org: MarginSource | null | undefined,
): BucketMargins {
  if (project?.imported_at) return resolveBucketMargins(null, org)
  return resolveBucketMargins(project, org)
}

/**
 * ⛔ IS THIS SUBPROJECT'S STORED COST ALREADY ITS PRICE? (migration 108)
 *
 * `projects.imported_at` answers "did this project come from Built" — a fact
 * about its HISTORY. Pricing needs "does this row already contain its price" —
 * a fact about the ROW. They were identical on the day of the import and have
 * been drifting apart ever since: **a subproject added to an imported job
 * today holds real composer lines with real hours, and freezing it prices that
 * work at material cost with no labor and no margin.**
 *
 * ⚠️ THE FALLBACK DIRECTION IS LOAD-BEARING. `undefined` means the caller
 * didn't select the column, and that resolves to the OLD project-level answer
 * — frozen on an imported job. A forgotten select therefore behaves exactly as
 * it does today instead of quietly un-freezing a signed contract and marking
 * it up a second time. `false` is an explicit answer and is honoured.
 */
export function isSubFrozen(
  project: PricingProjectSource | null | undefined,
  sub?: PricingSubSource | null,
): boolean {
  if (sub && sub.price_frozen != null) return !!sub.price_frozen
  return !!project?.imported_at
}

/**
 * ⛔ THE ONE ANSWER TO "what rate and consumables price this project's lines".
 *
 * Two rules, and BOTH must travel together or money goes wrong:
 *
 *   IMPORTED (6c-2 frozen model) ⇒ rate 0 AND consumables 0. The stored line
 *   price IS the quoted price; layering labor $ or consumables on top
 *   double-counts work Built already charged for. Hours still accumulate.
 *
 *   LOCKED RATE WINS over the org's current rate, so a sold job's cost stops
 *   moving when the shop rate changes.
 *
 * This exists because the handoff page had NEITHER. It priced an imported job
 * with the live org rate plus consumables on top of the frozen lump and showed
 * $257,907 against the project page's $168,090 — and `handleConfirm` writes
 * that number into `projects.bid_total` before flipping the stage, so selling
 * would have overwritten a real contract with an invented one. Both pages read
 * this now; don't rebuild the rule at a call site.
 */
export function effectiveShopRate(
  project: PricingProjectSource | null | undefined,
  orgShopRate: number,
  // ⛔ PER-SUBPROJECT AS OF 108. Omit it and you get the project-level answer,
  // which is the safe (frozen) one on an imported job — see isSubFrozen.
  sub?: PricingSubSource | null,
): number {
  if (isSubFrozen(project, sub)) return 0
  return Number(project?.locked_shop_rate) || orgShopRate
}

/** Consumables markup for this subproject's lines — zero when it's frozen, for
 *  the same reason the rate is. `subPct` is a subproject-level override. */
export function effectiveConsumablePct(
  project: PricingProjectSource | null | undefined,
  orgPct: number | null | undefined,
  subPct?: number | null,
  sub?: PricingSubSource | null,
): number {
  if (isSubFrozen(project, sub)) return 0
  return subPct ?? orgPct ?? 10
}

/**
 * Price a project whose subprojects are NOT all on the same footing.
 *
 * ⛔ WHY THIS EXISTS. `computeBucketedPrice` applies margin ONCE over summed
 * buckets, which was fine while a project was entirely frozen or entirely
 * live. After 108 one project can hold both: Built's migrated rooms (their
 * cost IS their price) beside a change order's new scope (quoted today, at
 * margin). Running one bucket sum through one margin would either mark up the
 * contract a second time or give away the margin on the new work.
 *
 * Splitting is EXACT, not an approximation: `priceFromMargin` is linear in
 * cost, so price(frozen) + price(live) is the same number a single pass would
 * produce if the rates agreed.
 */
export function priceMixedBuckets(
  frozen: CostBuckets,
  live: CostBuckets,
  margins: BucketMargins,
): { priceTotal: number; frozenPrice: number; livePrice: number } {
  const NO_MARGIN: BucketMargins = {
    laborMarginPct: 0,
    materialMarginPct: 0,
    consumableMarginPct: 0,
  }
  const frozenPrice = computeBucketedPrice(frozen, NO_MARGIN).priceTotal
  const livePrice = computeBucketedPrice(live, margins).priceTotal
  return { frozenPrice, livePrice, priceTotal: round(frozenPrice + livePrice) }
}

/** An empty bucket set — the accumulator both halves start from. */
export function emptyBuckets(): CostBuckets {
  return {
    laborCost: 0,
    materialCost: 0,
    hardwareCost: 0,
    consumablesCost: 0,
    installCost: 0,
    optionsCost: 0,
    customCost: 0,
  }
}

/** Add `add` into `into`, in place. */
export function addBuckets(into: CostBuckets, add: Partial<CostBuckets>): void {
  into.laborCost += add.laborCost || 0
  into.materialCost += add.materialCost || 0
  into.hardwareCost += add.hardwareCost || 0
  into.consumablesCost += add.consumablesCost || 0
  into.installCost += add.installCost || 0
  into.optionsCost += add.optionsCost || 0
  into.customCost += add.customCost || 0
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
