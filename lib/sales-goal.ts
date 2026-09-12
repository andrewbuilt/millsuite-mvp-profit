// ============================================================================
// lib/sales-goal.ts — the monthly cash target.
// ============================================================================
// PURE. No supabase import, so scripts/verify-sales-goal.mjs runs it without
// credentials. Same rule as lib/payment-ledger and lib/receivables.
//
// Andrew's model, 2026-09-12. Every dollar received splits three ways —
// overhead, material (COGS), profit — so the revenue that covers one month of
// fixed cost is:
//
//     goal = monthlyFixed / (1 - materialPct - profitPct)
//
// He was explicit about what this is NOT: it is not a P&L, it does not blend
// per-job margins, and it does not compare bookings to the goal. "Just a
// target to aim for." A thermostat, not an accounting system.
//
// ⛔ CONSUMABLES ARE DERIVED, NOT TYPED — ANDREW'S CALL, 2026-09-12.
//
//     goal = monthlyFixed / (1 − materialPct − materialPct×markup − profitPct)
//
// The app prices a JOB four ways (labour / material / consumables / margin),
// so a three-way revenue split was short a destination: a 7%-of-revenue
// consumable spend moves an $80,000 goal to $93,023. The fix adds NO fourth
// setting. Consumables in this app are already a function of material —
// `consumablesCost = materialCost × consumableMarkupPct` (lib/change-orders)
// — so the goal applies the SAME relationship to the revenue split. One
// input stays one input; the shop never has to estimate a consumables share.
//
//   · `materialPct` is MATERIAL ONLY here. ⛔ Do not widen it to "everything
//     bought" — the markup is applied on top, so a materialPct that already
//     included consumables would charge for them twice.
//   · An org with a 0 markup gets exactly the old number, so this cannot
//     move a goal that was already set up unless consumables really apply.
//   · ⚠️ THE DOUBLE-COUNT TO WATCH IS IN OVERHEAD, not here.
//     `DEFAULT_OVERHEAD_CATEGORIES` ships 'Shop consumables' and 'Tools'.
//     Money in those AND recovered through the markup is paid for twice —
//     once in `monthlyFixed`, once in the divisor — and the goal reads HIGH.
//     The settings card names the offending categories. It deliberately does
//     NOT silently exclude them: which side is right is the shop's call.
//
// ⛔ PERCENTS, NOT FRACTIONS, ON THE WAY IN. The columns store 0-100 to match
// `profit_margin_pct`. Getting that wrong is a 100× error in a revenue
// target, so the conversion happens exactly once — here.
// ============================================================================

/** Above this, the divisor is so small the goal explodes. See `computeGoal`. */
export const MAX_COMBINED_PCT = 90

export interface GoalInputs {
  /** Dollars per month. Derived from the shop-rate setup, or overridden. */
  monthlyFixed: number
  /** Percent of revenue, 0-100. Null = not set up. */
  materialPct: number | null
  /** Percent of revenue, 0-100. Null = not set up. */
  profitPct: number | null
  /**
   * The org's consumable markup as a PERCENT of material cost
   * (`orgs.consumable_markup_pct`; pricing defaults it to 10). Consumables
   * are derived from this rather than asked for — see the header.
   *
   * Omitted ⇒ 0, which reproduces the pre-2026-09-12 goal exactly. That
   * default is deliberate: a missing markup must not silently inflate a
   * target someone is planning against.
   */
  consumableMarkupPct?: number | null
  /**
   * ⛔ CAN THIS VIEWER SEE THE REAL FIXED COST? Team compensation is
   * owner-only at the DATABASE level (`team_compensation_owner_only`, 087),
   * and `loadTeamComp` returns an empty map rather than an error for anyone
   * else. So an admin's `sumTeamAnnualComp` is 0, their derived fixed cost is
   * overhead-only, and their goal comes out a fraction of the owner's — on
   * the same page, on the same day, with nothing saying why. Measured at 4×
   * on a test org ($80,000 vs $20,000).
   *
   * Pass false when the viewer can't see payroll AND no override is pinned.
   * The goal then reports `blind` instead of a small confident lie.
   */
  fixedIsKnown?: boolean
}

export type GoalStatus =
  /** Nothing to show — the shop hasn't set the percentages yet. */
  | 'unset'
  /** matPct + profitPct is at or above MAX_COMBINED_PCT. */
  | 'impossible'
  /** matPct or profitPct is negative — a stored value, not a typed one. */
  | 'negative'
  /** No fixed costs known, so the target would be $0. */
  | 'no_fixed'
  /** This viewer can't see payroll, so the fixed cost would be understated. */
  | 'blind'
  | 'ok'

export interface Goal {
  status: GoalStatus
  /** Dollars/month the shop needs to collect. 0 unless status is 'ok'. */
  amount: number
  /** Echoed back so a caller can explain the number without re-deriving it. */
  monthlyFixed: number
  materialPct: number
  profitPct: number
  /** Consumables as a percent of REVENUE — `materialPct × markup`. Shown on
   *  the settings card so the derivation is legible rather than magic. */
  consumablesPct: number
}

/**
 * The month's revenue target.
 *
 * ⛔ THE DIVISOR IS THE WHOLE RISK. As materialPct + profitPct approaches
 * 100, `1 - that` approaches zero and the goal approaches infinity — at 99%
 * a $20k fixed cost demands $2,000,000 a month, and at 100% it's `Infinity`,
 * which formats as "$Infinity" on a page a shop owner is trying to plan
 * against. So anything at or above MAX_COMBINED_PCT returns 'impossible' and
 * the UI explains it, rather than rendering a number nobody can act on.
 */
export function computeGoal(inputs: GoalInputs): Goal {
  const materialPct = Number(inputs.materialPct ?? NaN)
  const profitPct = Number(inputs.profitPct ?? NaN)
  const monthlyFixed = Number(inputs.monthlyFixed) || 0
  // Defaults to 0, NOT to pricing's 10. A caller that forgets to pass the
  // markup gets the old, smaller goal rather than a silently inflated one.
  const markupRaw = Number(inputs.consumableMarkupPct ?? 0)
  const markup = Number.isFinite(markupRaw) && markupRaw > 0 ? markupRaw : 0

  // Consumables ride on MATERIAL, exactly as they do when pricing a job:
  // consumablesCost = materialCost × markup.
  const consumablesPct =
    Number.isFinite(materialPct) && materialPct > 0
      ? +((materialPct * markup) / 100).toFixed(4)
      : 0

  const base: Goal = {
    status: 'unset',
    amount: 0,
    monthlyFixed,
    materialPct: Number.isFinite(materialPct) ? materialPct : 0,
    profitPct: Number.isFinite(profitPct) ? profitPct : 0,
    consumablesPct,
  }

  // Either percentage missing ⇒ not set up. Zero IS a legitimate value (a
  // shop with no material cost, or no profit target), so this tests for
  // null/NaN, never for falsiness.
  if (!Number.isFinite(materialPct) || !Number.isFinite(profitPct)) {
    return base
  }

  // Its own state: "85% of each dollar is left for overhead, so the target
  // runs away to infinity" is gibberish, and that's what the impossible copy
  // said when a stored value was negative.
  if (materialPct < 0 || profitPct < 0) return { ...base, status: 'negative' }
  // ⛔ THE CAP MUST INCLUDE THE DERIVED CONSUMABLES. Checking only material +
  // profit would let the three together reach 100% through the back door —
  // 60% material with a 40% markup is 24 more points, and the divisor goes
  // to zero without a single input looking unreasonable.
  if (materialPct + consumablesPct + profitPct >= MAX_COMBINED_PCT) {
    return { ...base, status: 'impossible' }
  }
  // ⛔ BEFORE `no_fixed`: a blind viewer's fixed cost may be a plausible
  // non-zero (overhead with payroll missing), which is the dangerous case —
  // it wouldn't trip any other guard.
  if (inputs.fixedIsKnown === false) return { ...base, status: 'blind' }
  if (monthlyFixed <= 0) return { ...base, status: 'no_fixed' }

  const divisor = 1 - (materialPct + consumablesPct + profitPct) / 100
  return {
    ...base,
    status: 'ok',
    amount: +(monthlyFixed / divisor).toFixed(2),
  }
}

/**
 * Monthly fixed cost from the shop-rate setup.
 *
 * ⛔ SAME NUMERATOR AS THE DERIVED SHOP RATE (`computeDerivedShopRate`):
 * ALL overhead + ALL payroll, including non-billable people, because they
 * cost money whether or not they touch a job. Labour is salary here — it's
 * fixed, not variable — which is exactly why the split above is only
 * material and profit. Don't add a labour percentage; it's already inside
 * monthlyFixed, and counting it twice would inflate the target.
 */
export function deriveMonthlyFixed(
  overheadAnnual: number,
  teamCompAnnual: number,
): number {
  const annual = (Number(overheadAnnual) || 0) + (Number(teamCompAnnual) || 0)
  return annual > 0 ? +(annual / 12).toFixed(2) : 0
}

export interface SoldJobCost {
  /** What the client is paying. */
  price: number
  /** Material cost on that job. */
  materialCost: number
}

/**
 * "Your last N sold jobs averaged X% material" — the suggestion beside the
 * material input.
 *
 * ⛔ SUGGESTS, NEVER APPLIES (Andrew's call for v1). Returns null when
 * there's nothing to learn from, so the UI can stay quiet rather than
 * proposing a number derived from one job.
 *
 * Weighted by PRICE, not a mean of per-job percentages: a $200k job and a
 * $5k job are not equal evidence about where the shop's money goes, and an
 * unweighted mean lets a tiny odd job drag the suggestion around.
 */
export function suggestMaterialPct(jobs: SoldJobCost[]): number | null {
  const usable = (jobs || []).filter(
    (j) => Number(j.price) > 0 && Number(j.materialCost) >= 0,
  )
  if (usable.length === 0) return null
  const price = usable.reduce((s, j) => s + Number(j.price), 0)
  const material = usable.reduce((s, j) => s + Number(j.materialCost), 0)
  if (price <= 0) return null
  const pct = +((material / price) * 100).toFixed(1)

  // ⛔ REFUSE TO SUGGEST A NUMBER THE GOAL CAN'T USE. Vendor bills can exceed
  // the contract — a loss job, or bills posted to the wrong project — which
  // yields >100%. The card offered a "Use it" button beside "averaged 120%"
  // that, when clicked, put the goal straight into its impossible state.
  // Saying nothing is the honest answer; the shop's real material share is
  // not knowable from data that says it spent more than it charged.
  if (!Number.isFinite(pct) || pct < 0 || pct >= MAX_COMBINED_PCT) return null
  return pct
}

/** Progress toward the goal, for the bar. Clamped to [0, 100] for WIDTH only
 *  — `pct` below is uncapped so a caller can still say "112%". */
export function goalProgress(received: number, goal: number): {
  pct: number
  width: number
  tone: 'red' | 'amber' | 'green'
} {
  // ⛔ BOTH SIDES. Guarding only the divisor let a NaN numerator through as
  // `width: NaN%`, which is invalid CSS — the browser drops it and the bar
  // falls back to full width, so "nothing received" renders as a complete
  // green-adjacent bar next to "NaN% of target".
  if (!(goal > 0) || !Number.isFinite(received)) {
    return { pct: 0, width: 0, tone: 'red' }
  }
  const pct = (received / goal) * 100
  return {
    pct: +pct.toFixed(1),
    width: Math.max(0, Math.min(100, pct)),
    tone: pct >= 100 ? 'green' : pct >= 70 ? 'amber' : 'red',
  }
}
