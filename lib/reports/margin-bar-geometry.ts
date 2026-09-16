// ============================================================================
// margin-bar-geometry.ts — the Completed Projects profit bar.
// ============================================================================
// ⛔ PURE. No `lib/supabase` import, directly or transitively, so
// `scripts/verify-margin-bar-geometry.mjs` can exercise it without a client
// (supabase is built at module scope and would throw).
//
// ⛔ ZERO AT THE FAR LEFT. EVERY BAR GROWS RIGHT. LENGTH IS DOLLARS.
// Andrew's call, 2026-09-16: *"zero can to the far left. negative would just be
// red. i think we need to add some gradations on the top up to $100k?
// otherwise the scale would need to resize to accommodate larger and small
// values."*
//
// ⚠️⚠️ READ THIS BEFORE CHANGING ANYTHING HERE. A bar anchored at the left
// means A LOSS AND A GAIN OF THE SAME SIZE DRAW THE SAME LENGTH. −$3,190 and
// +$3,190 are the same bar. That is the exact misread the redesign brief was
// written to kill ("losses and gains need to be visually distinguishable by
// more than color alone"), and it is back by deliberate choice, because on a
// DOLLAR axis the length now answers "how much money moved" and the direction
// is carried elsewhere. Two things carry it, and both must survive:
//   1. COLOUR — red for a loss (`marginBarColor` already does this).
//   2. PATTERN — losses render with a striped fill, not a solid one.
// ⛔ THE STRIPES ARE NOT DECORATION. Red/green is the single worst colour pair
// for colour-vision deficiency (~8% of men, and this chart is going on a
// marketing site). Without the pattern, ~1 reader in 12 sees a loss and a
// profit as identical bars in identical grey. Do not remove it and leave hue
// as the only signal.
//
// THE SCALE IS A LADDER, NOT A HARD CAP AND NOT A FREE FIT:
//   · a hard $100k ceiling CLIPS a job that made $150k — silently, and a
//     clipped bar reads as "exactly the maximum", which is a wrong number.
//   · fitting the axis to the data makes the best row always look maximal, so
//     a shop having a terrible year renders exactly like one having a great
//     year, and the axis twitches every time a project closes.
//   · the ladder snaps to the next round rung up. It is stable across normal
//     data changes, it can never clip, and the gradation labels say out loud
//     what the scale currently is — so a reader is never guessing.
// ============================================================================

/** Round rungs, smallest first. The axis is always one of these. */
export const AXIS_LADDER = [
  10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000,
  5_000_000, 10_000_000,
]

/** A non-zero profit never draws as nothing — but exactly $0 draws as $0. */
export const MIN_BAR_PCT = 0.6

/** Gradation lines drawn across the track, including both ends. */
export const GRADATION_STEPS = 5

/**
 * The smallest rung that contains the data.
 *
 * ⚠️ Uses the ABSOLUTE value, so a catastrophic loss widens the axis the same
 * way a big win does. A −$400k job has to fit on the chart too.
 */
export function chooseAxisMax(profits: number[]): number {
  const peak = Math.max(0, ...profits.map((p) => Math.abs(Number(p) || 0)))
  for (const rung of AXIS_LADDER) {
    if (peak <= rung) return rung
  }
  // ⛔ Past the top rung, round UP to the next whole multiple of the largest
  // rung rather than clipping. A bar that runs off the end is a wrong number.
  const top = AXIS_LADDER[AXIS_LADDER.length - 1]
  return Math.ceil(peak / top) * top
}

/**
 * Bar width as a % of the track. ALWAYS anchored at the left edge.
 *
 * Losses use their magnitude — see the header. The caller is responsible for
 * rendering them red AND striped.
 */
export function barWidthPct(profit: number, axisMax: number): number {
  const v = Number(profit)
  if (!v || !Number.isFinite(v) || axisMax <= 0) return 0
  const raw = (Math.abs(v) / axisMax) * 100
  return Math.min(Math.max(raw, MIN_BAR_PCT), 100)
}

/** True when the axis had to clip this value. Should never happen — assert it. */
export function overflowsAxis(profit: number, axisMax: number): boolean {
  return Math.abs(Number(profit) || 0) > axisMax
}

export interface Gradation {
  /** Position across the track, 0–100. */
  pct: number
  value: number
  /** Short money label: $0, $10k, $1.5M. */
  label: string
}

/** The ticks drawn across the top, so the scale is never a guess. */
export function gradations(axisMax: number, steps: number = GRADATION_STEPS): Gradation[] {
  const out: Gradation[] = []
  for (let i = 0; i <= steps; i++) {
    const value = (axisMax / steps) * i
    out.push({ pct: (i / steps) * 100, value, label: shortMoney(value) })
  }
  return out
}

/** $0 · $12.5k · $250k · $1.5M — short enough to sit above a bar track. */
export function shortMoney(n: number): string {
  const v = Math.abs(n)
  if (v === 0) return '$0'
  if (v >= 1_000_000) return `$${trim(v / 1_000_000)}M`
  if (v >= 1_000) return `$${trim(v / 1_000)}k`
  return `$${Math.round(v)}`
}

function trim(n: number): string {
  // One decimal only when it carries information — $12.5k, but $50k not $50.0k.
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
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

/** Mean profit per job — the Average row's bar length and its big number. */
export function averageProfit(rows: { profit: number }[]): number {
  if (rows.length === 0) return 0
  return rows.reduce((s, r) => s + (Number(r.profit) || 0), 0) / rows.length
}
