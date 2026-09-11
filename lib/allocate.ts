// ============================================================================
// lib/allocate.ts — making rounded parts add up to the rounded whole
// ============================================================================
// A project's price is shown as one whole-dollar number. Each subproject's
// price is shown as a whole-dollar number too. Round them independently and
// they don't add up:
//
//     3 subs at $1,000.40 each  →  $1,000 + $1,000 + $1,000 = $3,000
//     the project               →  $3,001.20                = $3,001
//
// Nobody accepts "the parts don't sum to the total" on a page about money, and
// they're right not to — it reads as a bug even when every figure is correct
// to the cent.
//
// LARGEST REMAINDER (the Hare quota rule): floor everything, then hand the
// leftover dollars to whichever rows were robbed of the most. Each row lands
// within $1 of its true value, the sum is exact, and the same inputs always
// produce the same answer.
//
// ⛔ THIS IS A DISPLAY RULE, NOT A PRICING RULE. It never decides what
// something costs — it only decides where a rounding penny lands. Nothing here
// may ever be written back to the database.
// ============================================================================

/**
 * Round `values` to integers that sum to exactly `target`.
 *
 * Returns integers in the same order as the input. `target` is rounded to a
 * whole number first: allocating to a fractional target is meaningless.
 *
 * The caller is expected to pass values that genuinely sum to the target (up
 * to float noise) — see `allocationDrift` if you need to prove that before
 * trusting the output.
 */
export function allocateRounded(values: number[], target: number): number[] {
  const n = values.length
  if (n === 0) return []

  const goal = Math.round(target)
  const floors = values.map((v) => Math.floor(v))
  const sumFloors = floors.reduce((a, b) => a + b, 0)
  let deficit = goal - sumFloors

  if (deficit === 0) return floors

  // Order by how much each row lost to the floor. Ties break on index so the
  // result is stable — a card must not swap a dollar with its neighbour just
  // because the list re-rendered.
  const order = values
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i)

  if (deficit > 0) {
    // Hand out the leftover dollars, biggest remainder first. Wraps if the
    // deficit somehow exceeds the row count (see the note in allocationDrift)
    // so we always hit the target rather than silently missing it.
    for (let k = 0; k < deficit; k++) {
      floors[order[k % n].i] += 1
    }
  } else {
    // Over-allocated: take dollars back from the rows that lost the least.
    for (let k = 0; k < -deficit; k++) {
      floors[order[n - 1 - (k % n)].i] -= 1
    }
  }

  return floors
}

/**
 * How far the parts are from the whole BEFORE any rounding, in dollars.
 *
 * `allocateRounded` will force its output to sum to the target no matter what,
 * which is the right behaviour for rounding noise and the WRONG behaviour for
 * a real modelling error — if the project total contained something that
 * belonged to no subproject, forcing the sum would smear that amount silently
 * across the cards.
 *
 * So: check this first. Cents mean rounding. Dollars mean a bug.
 */
export function allocationDrift(values: number[], target: number): number {
  const sum = values.reduce((a, b) => a + b, 0)
  return Math.abs(sum - target)
}
