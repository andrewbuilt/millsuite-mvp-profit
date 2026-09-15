// ============================================================================
// lib/composer-row.ts — the composer's estimate_lines STORAGE SHAPE, pure.
// ============================================================================
// ⛔ WHY THIS IS ITS OWN MODULE.
//
// `saveComposerLine` and `updateComposerLine` each built this payload inline,
// from the same six lines of code, in `lib/composer-persist.ts` — which
// imports `lib/supabase` at module scope and therefore cannot be loaded by a
// verify script. So the one piece of composer logic that decides what the
// rollup math will later SEE was both duplicated and untestable.
//
// Change orders v2 makes that worse: a CO draft has to be priced BEFORE any
// row exists, and the number quoted to the client has to be the same number
// the project total moves by when the draft is accepted. The only way to
// guarantee that is for the draft and the eventual insert to go through one
// function. This is that function.
//
// ⚠️ THE PER-UNIT CONTRACT (this is the trap, stated once):
// `computeBreakdown` returns WHOLE-LINE totals (qty already multiplied in).
// The storage columns are PER-UNIT — `computeSubprojectRollup` multiplies by
// quantity at read time, and re-applies consumables from the subproject's own
// pct. So hours are divided by qty, material excludes consumables, and
// anything that skips this helper writes qty× too much. Issue 18 (8× labor on
// round-trip) was exactly that.
// ============================================================================

import type { ComposerBreakdown, ComposerDraft, ComposerRateBook } from './composer'
import { productLabelFromKey, summarizeSlots } from './composer'
import { PRODUCTS } from './products'

/** Per-unit hours by dept; null when every dept is zero. */
export interface ComposerStorageValues {
  deptHourOverrides: Record<string, number> | null
  /** Per-unit (materialSubtotal + waste) — NO consumables. */
  lumpCostOverride: number
}

export function breakdownToStorageValues(
  breakdown: ComposerBreakdown,
  qty: number,
): ComposerStorageValues {
  const deptHourOverrides: Record<string, number> = {}
  if (qty > 0) {
    if (breakdown.hoursByDept.eng > 0) deptHourOverrides.eng = breakdown.hoursByDept.eng / qty
    if (breakdown.hoursByDept.cnc > 0) deptHourOverrides.cnc = breakdown.hoursByDept.cnc / qty
    if (breakdown.hoursByDept.assembly > 0)
      deptHourOverrides.assembly = breakdown.hoursByDept.assembly / qty
    if (breakdown.hoursByDept.finish > 0)
      deptHourOverrides.finish = breakdown.hoursByDept.finish / qty
    if (breakdown.hoursByDept.install > 0)
      deptHourOverrides.install = breakdown.hoursByDept.install / qty
  }
  const lumpCostOverride = qty > 0 ? (breakdown.materialSubtotal + breakdown.waste) / qty : 0
  return {
    deptHourOverrides: Object.keys(deptHourOverrides).length > 0 ? deptHourOverrides : null,
    lumpCostOverride,
  }
}

/**
 * Every column a composer line owns, minus `subproject_id` and `sort_order` —
 * the two things only the caller knows. Loose `Record` on purpose at the
 * insert boundary; the named fields below are what the rollup reads.
 */
export interface ComposerLineRow {
  description: string
  rate_book_item_id: null
  quantity: number
  unit: string
  product_key: string
  product_slots: ComposerDraft['slots']
  material_mode_override: 'lump'
  lump_cost_override: number
  dept_hour_overrides: Record<string, number> | null
  notes: string | null
  composer_hours_corrected: true
}

/**
 * Build the estimate_lines payload for a composer draft.
 *
 * Used three ways, and it MUST be the same shape in all three or a CO's quoted
 * price won't match the project total it produces:
 *   1. `saveComposerLine`   — insert (adds subproject_id + sort_order)
 *   2. `updateComposerLine` — update (drops product_key / rate_book_item_id)
 *   3. `lib/co-docs`        — priced in memory as a DRAFT, then inserted
 *                             verbatim when the change order is accepted.
 */
export function composerLineRow(input: {
  draft: ComposerDraft
  breakdown: ComposerBreakdown
  rateBook: ComposerRateBook
}): ComposerLineRow {
  const { draft, breakdown, rateBook } = input

  const cp =
    draft.productId === 'custom'
      ? rateBook.customProducts.find((p) => p.id === draft.slots.customProductId)
      : null
  const summary = summarizeSlots(draft, rateBook)
  const productLabel = cp ? cp.name : productLabelFromKey(draft.productId)
  const description = summary ? `${productLabel} · ${summary}` : productLabel

  const storage = breakdownToStorageValues(breakdown, Number(draft.qty) || 0)

  return {
    description,
    rate_book_item_id: null,
    quantity: draft.qty,
    // Per-product unit from lib/products. Cabinet products are 'lf'; Solid
    // Wood Top is 'piece'; custom products carry their own — so the line
    // list's Unit column reads correctly.
    unit: cp ? cp.unit : PRODUCTS[draft.productId].unit,
    product_key: draft.productId,
    product_slots: draft.slots,
    material_mode_override: 'lump',
    lump_cost_override: storage.lumpCostOverride,
    dept_hour_overrides: storage.deptHourOverrides,
    notes: draft.slots.notes || null,
    composer_hours_corrected: true,
  }
}
