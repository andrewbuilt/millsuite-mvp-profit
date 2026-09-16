// ============================================================================
// margin-bar-geometry.ts — where a diverging margin bar starts and ends.
// ============================================================================
// ⛔ PURE. No `lib/supabase` import, directly or transitively, so
// `scripts/verify-margin-bar-geometry.mjs` can exercise it without a client
// (supabase is built at module scope and would throw).
//
// ⛔ THE AXIS IS FIXED: −100% … 0 … +100%, WITH 0 DEAD CENTRE.
// It is NOT derived from the data. That is the whole point, and it is the
// third design this chart has had — each previous one failed in a way that
// only shows up on a rendered page:
//
//   1. `Math.abs(marginPct)` scaled to the set's max, drawn left-to-right.
//      A LOSS DREW LIKE A PROFIT. −15% and +15% were the same length,
//      separated only by colour.
//
//   2. Dollar profit, diverging, scaled to the set's max. Fixed the loss, but
//      THE BAR DISAGREED WITH THE NUMBER PRINTED NEXT TO IT: Gulfview drew
//      the longest bar in the set at +31.9% while Vega drew shorter at
//      +35.3%, because Gulfview is a bigger job. A reader sees a longer bar
//      against a smaller percentage and cannot trust either.
//
//   3. This one. The bar IS the number beside it, on an absolute scale, so
//      length and text cannot drift apart and no row's length depends on any
//      other row.
//
// ⚠️ WHAT A FIXED AXIS COSTS, ON PURPOSE: bars no longer stretch to fill the
// track. A 30% job fills 30% of its half, because 30% IS 30% of the way to a
// job that cost nothing to build. A data-relative scale always makes the best
// row look maximal — so a shop having a terrible year renders exactly like a
// shop having a great one, and the chart can never say "this is bad".
//
// ⚠️ 100% IS A REAL CEILING on the gain side (margin = profit ÷ revenue, and
// cost ≥ 0). It is NOT a real floor on the loss side: a job that costs three
// times its price is −200%. Those clamp to the end of the track and the text
// keeps telling the truth. Rare, and better than rescaling the whole chart
// around one disaster.
// ============================================================================

/** Each side of the 0 line spans 0…100% margin. */
export const AXIS_MAX_PCT = 100

/** The 0 line, as a % of track width. Dead centre, by definition of the axis. */
export const ZERO_X = 50

/** A non-zero margin never draws as nothing — but exactly 0% draws as 0. */
export const MIN_BAR_PCT = 0.6

export interface BarGeometry {
  leftPct: number
  widthPct: number
}

/**
 * Where one bar sits on the track. Gains run right of 0, losses run left.
 *
 * ⛔ TAKES THE PERCENTAGE THAT IS PRINTED IN THE ROW. Not dollars, not a
 * derived figure — the same number, so the two cannot disagree.
 */
export function barGeometry(marginPct: number): BarGeometry {
  if (!marginPct || !Number.isFinite(marginPct)) {
    return { leftPct: ZERO_X, widthPct: 0 }
  }

  const half = ZERO_X // each side of the axis is this many % of the track
  const magnitude = Math.min(Math.abs(marginPct), AXIS_MAX_PCT)
  const widthPct = Math.min(Math.max((magnitude / AXIS_MAX_PCT) * half, MIN_BAR_PCT), half)

  return marginPct > 0
    ? { leftPct: ZERO_X, widthPct }
    : { leftPct: ZERO_X - widthPct, widthPct }
}

/**
 * Where the margin target tick sits — ONE x for every row.
 *
 * ⛔ THIS IS WHAT THE FIXED AXIS BUYS BACK. The target tick had to be deleted
 * when the bar was drawn in dollars, because a percentage has no single x on a
 * dollar axis: 25% of $21,300 is $5,325 and 25% of $102,500 is $25,625, so one
 * "target" would have sat in a different place on every row. On a percentage
 * axis it is a single vertical line down the whole chart, and every row is
 * readable at a glance as left of it or right of it.
 */
export function targetX(targetPct: number): number {
  const clamped = Math.min(Math.max(targetPct, -AXIS_MAX_PCT), AXIS_MAX_PCT)
  return ZERO_X + (clamped / AXIS_MAX_PCT) * ZERO_X
}

/**
 * ΣProfit / ΣRevenue — the shop's actual margin.
 *
 * ⛔ NOT the mean of the per-job percentages. That is an average of ratios: a
 * $5k job at 60% moves it exactly as much as a $500k job at 20%, so a handful
 * of small jobs can carry the headline number away from the money. On the
 * Bayside demo set the two differ by 4.9 points AND land on opposite sides of
 * the 25% target — 23.8% (amber, missed) vs 28.7% (green, beat). Same seven
 * jobs, opposite verdict.
 */
export function blendedMarginPct(rows: { profit: number; revenue: number }[]): number {
  const revenue = rows.reduce((s, r) => s + (Number(r.revenue) || 0), 0)
  if (revenue <= 0) return 0
  const profit = rows.reduce((s, r) => s + (Number(r.profit) || 0), 0)
  return (profit / revenue) * 100
}

/** Mean profit per job — the dollar figure on the Average row. */
export function averageProfit(rows: { profit: number }[]): number {
  if (rows.length === 0) return 0
  return rows.reduce((s, r) => s + (Number(r.profit) || 0), 0) / rows.length
}
