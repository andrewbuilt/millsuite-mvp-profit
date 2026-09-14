// ============================================================================
// lib/divide-block.ts — the splitting rules behind DivideBlockModal. PURE.
// ============================================================================
// ⛔ NO REACT, NO SUPABASE. The modal is a .tsx client component that a
// verification script can't import, and these rules decide how a block of
// scheduled HOURS gets carved up — which the operator then saves over the
// real allocation. Worth pinning.
//
// ⛔ THE INVARIANT: the split must sum to the block's total, exactly. The
// modal's Save button is gated on it, and `evenSplit` guarantees it on the
// generated path by stuffing the rounding remainder into the last row.
// ============================================================================

export interface SplitRow {
  /** ISO yyyy-mm-dd, Monday of the week. */
  startDate: string
  /** String while editing so the field can be cleared and retyped. */
  hours: string
}

export const MIN_SPLITS = 2
/** ⛔ 52, NOT 6. The old dropdown capped at six and a long run genuinely
 *  needs more — Andrew hit the ceiling. A year is the sanity bound. */
export const MAX_SPLITS = 52

/**
 * Add days to an ISO day, staying in LOCAL time.
 *
 * ⛔ NOT `toISOString().slice(0, 10)`. The string parses as local noon, which
 * survives a UTC-negative offset — but in a UTC+ zone local noon is the
 * PREVIOUS day in UTC and every split date shifts back one. Formatting from
 * the local parts makes the zone irrelevant.
 */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/**
 * `count` rows, one week apart, hours spread evenly.
 *
 * Each slice rounds to the half hour because that's how the shop thinks about
 * a day's work; ⛔ the REMAINDER GOES IN THE LAST ROW so the sum still equals
 * the total exactly. Without that, 7h across 3 weeks would be 2.5+2.5+2.5 =
 * 7.5 and the operator would have to hunt down half an hour before Save
 * unlocked.
 */
export function evenSplit(count: number, total: number, weekStartIso: string): SplitRow[] {
  const base = Math.round((total / count) * 2) / 2
  const rows: SplitRow[] = []
  let remaining = total
  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1
    const slice = isLast ? +remaining.toFixed(2) : base
    rows.push({ startDate: addDays(weekStartIso, i * 7), hours: String(slice) })
    remaining = +(remaining - slice).toFixed(2)
  }
  return rows
}

/**
 * Grow or shrink the list WITHOUT disturbing what's already typed — used when
 * the week count changes while the operator is in custom mode.
 *
 * New rows continue the weekly cadence and start at 0h: adding a week must
 * not invent hours that then have to be found and removed.
 */
export function resizeRows(rows: SplitRow[], next: number, fallbackIso: string): SplitRow[] {
  if (next === rows.length) return rows
  if (next < rows.length) return rows.slice(0, next)
  const out = [...rows]
  while (out.length < next) {
    const last = out[out.length - 1]
    out.push({ startDate: addDays(last?.startDate || fallbackIso, 7), hours: '0' })
  }
  return out
}

/**
 * Move the first week.
 *
 * Default: the rest follow at one-week steps — "this whole run starts a
 * fortnight later" is the common edit, and doing it by hand down a dozen rows
 * is the tedium the typed week count just made possible.
 *
 * ⛔ In custom mode ONLY row 1 moves. The operator placed the others
 * deliberately; dragging them along would silently undo that.
 */
export function applyFirstDate(rows: SplitRow[], iso: string, custom: boolean): SplitRow[] {
  return rows.map((r, idx) =>
    idx === 0 ? { ...r, startDate: iso } : custom ? r : { ...r, startDate: addDays(iso, idx * 7) },
  )
}

/** Does an edit to row `i` mean the operator has taken over? Any hours edit,
 *  or a date on any row but the first — the first date is the auto-fill
 *  handle, not an edit. */
export function isCustomEdit(i: number, patch: Partial<SplitRow>): boolean {
  return patch.hours !== undefined || (patch.startDate !== undefined && i > 0)
}

/** The Save gate. Hours must sum to the total, every row dated, every row
 *  positive. */
export function splitIsValid(rows: SplitRow[], total: number): boolean {
  const sum = rows.reduce((acc, r) => acc + (Number(r.hours) || 0), 0)
  if (Math.abs(sum - total) >= 0.001) return false
  if (!rows.every((r) => r.startDate)) return false
  return rows.every((r) => (Number(r.hours) || 0) > 0)
}
