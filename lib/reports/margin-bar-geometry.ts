// ============================================================================
// margin-bar-geometry.ts — where a diverging profit bar starts and ends.
// ============================================================================
// ⛔ PURE. No `lib/supabase` import, directly or transitively, so
// `scripts/verify-margin-bar-geometry.mjs` can exercise it without a client
// (supabase is built at module scope and would throw).
//
// WHY THIS IS A MODULE AND NOT FOUR LINES IN THE COMPONENT. The last bug in
// this chart was geometry: an elastic column meant every row's bar track was a
// different width, so bar LENGTHS WERE NOT COMPARABLE BETWEEN ROWS — the one
// thing the chart exists to do. It rendered as "one bar looks wrong" and cost
// two investigations that both went looking in the data, which was correct the
// whole time. Geometry that carries meaning gets tested.
//
// The invariant every function here protects: ONE SCALE, BOTH SIDES, EVERY
// ROW. A dollar of profit and a dollar of loss are the same number of pixels,
// in every row, or the picture lies.
// ============================================================================

/** Set to 0.5 to CENTER the 0 line (both clamps collapse to 0.5). */
export const MIN_SIDE = 0.14

/** A non-zero value never draws as nothing — but zero draws as zero. */
export const MIN_BAR_PCT = 0.6

export interface BarScale {
  /** x of the 0 line, as a % of track width. Constant for every row. */
  zeroPct: number
  /** % of track width per dollar. Identical left and right. */
  pctPerDollar: number
  maxGain: number
  /** Magnitude, positive. */
  maxLoss: number
}

export interface BarGeometry {
  leftPct: number
  widthPct: number
}

/**
 * Place the 0 line and fix the scale for a set of profits.
 *
 * ⚠️ THE 0 LINE IS NOT CENTERED BY DEFAULT, AND THAT IS DELIBERATE.
 * Centering splits the track 50/50 regardless of the data. With one small loss
 * and six healthy gains — the ordinary shape of a shop's year — half the track
 * sits permanently empty and every gain is compressed into the other half, so
 * the six bars that carry the most information get half the resolution to say
 * it. Instead the split follows the data's own loss:gain ratio, which keeps a
 * single scale on both sides AND uses the whole track.
 *
 * It is still a CONSTANT x for every row in the set, which is the property that
 * makes rows comparable. It varies with the set, never within it.
 *
 * MIN_SIDE floors each side so the loss region is never a hairline (the
 * "Amount lost" legend has to point at something) and so an all-gains shop
 * still shows a 0 line rather than an edge.
 */
export function computeBarScale(profits: number[]): BarScale {
  const maxGain = Math.max(0, ...profits.filter((p) => p > 0))
  const maxLoss = Math.max(0, ...profits.filter((p) => p < 0).map((p) => -p))
  const span = maxGain + maxLoss

  const natural = span > 0 ? maxLoss / span : MIN_SIDE
  const zeroFrac = Math.min(Math.max(natural, MIN_SIDE), 1 - MIN_SIDE)

  // ⛔ ONE scale, chosen so NEITHER side overflows. Taking the min is what
  // keeps a dollar the same width on both sides of the line. Scaling each
  // side to its own extreme would make a $3k loss and a $32k gain draw the
  // same length — the exact misread this redesign exists to kill.
  const forGain = maxGain > 0 ? (1 - zeroFrac) / maxGain : Infinity
  const forLoss = maxLoss > 0 ? zeroFrac / maxLoss : Infinity
  const scale = Math.min(forGain, forLoss)

  return {
    zeroPct: zeroFrac * 100,
    pctPerDollar: Number.isFinite(scale) ? scale * 100 : 0,
    maxGain,
    maxLoss,
  }
}

/** Where one bar sits on the track. Gains run right of 0, losses run left. */
export function barGeometry(profit: number, scale: BarScale): BarGeometry {
  if (!profit || !Number.isFinite(profit)) {
    return { leftPct: scale.zeroPct, widthPct: 0 }
  }

  const raw = Math.abs(profit) * scale.pctPerDollar
  const room = profit > 0 ? 100 - scale.zeroPct : scale.zeroPct
  // Clamp to the room available BEFORE the minimum, so a sliver can't be
  // pushed past the end of the track on a degenerate set.
  const widthPct = Math.min(Math.max(raw, MIN_BAR_PCT), room)

  return profit > 0
    ? { leftPct: scale.zeroPct, widthPct }
    : { leftPct: scale.zeroPct - widthPct, widthPct }
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

/** Mean profit per job — the Average row's bar length, on the rows' own scale. */
export function averageProfit(rows: { profit: number }[]): number {
  if (rows.length === 0) return 0
  return rows.reduce((s, r) => s + (Number(r.profit) || 0), 0) / rows.length
}
