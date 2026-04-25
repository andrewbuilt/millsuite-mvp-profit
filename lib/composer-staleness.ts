// ============================================================================
// lib/composer-staleness.ts — per-line staleness detection + bulk refresh.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 10 + specs/add-line-composer/README.md.
//
// Composer lines are snapshots. The rate book and walkthroughs can change
// after a line is saved; this module surfaces "stale" lines so the editor
// can show the banner + "Update to latest rates" bulk action.
//
// What counts as stale
// --------------------
// A composer line stores two snapshots on the estimate_lines row:
//   - dept_hour_overrides  — PER-UNIT hours by dept
//   - lump_cost_override   — PER-UNIT (materialSubtotal + waste, no
//                            consumables — the rollup re-applies them)
// Labor $ is computed live at read time (computeSubprojectRollup reads
// current orgs.shop_rate), so a shop-rate edit alone is NOT stale —
// every displayed labor cost already reflects the new rate.
//
// Staleness is triggered by:
//   - Walkthrough recalibration (base cab, door, finish) — shifts the
//     per-unit labor hours pulled into the breakdown. Stored
//     dept_hour_overrides no longer match a fresh computeBreakdown.
//   - Material template edits (sheet cost / sheets-per-LF) — shift the
//     material total. Stored lump_cost_override no longer matches.
//
// Per-unit contract
// -----------------
// Storage is per-unit; computeBreakdown returns whole-line totals.
// Both the comparison (checkLineStaleness) and the writeback
// (bulkRefreshStaleLines) MUST go through breakdownToStorageValues so
// the units match storage. Without that:
//   - Comparing per-unit stored to whole-line fresh gives a false-positive
//     banner on every untouched line at qty > 1.
//   - Writing whole-line back as the override regenerates Issue 18's 8×
//     labor / 8× material bug — every "Update to latest rates" click
//     multiplies the line by qty.
//
// Freeform lines (no product_key) and lines whose product is inactive
// (drawer / led / countertop stubs) are skipped — they were never
// composer-priced.
//
// Gate on the caller, not here: "Only shows on unsold subprojects."
// The editor checks project.stage with isPresold() before rendering.
// ============================================================================

import { supabase } from './supabase'
import type { EstimateLine } from './estimate-lines'
import {
  computeBreakdown,
  type ComposerDefaults,
  type ComposerDraft,
  type ComposerRateBook,
  type ComposerSlots,
} from './composer'
import {
  breakdownToStorageValues,
  type ComposerStorageValues,
} from './composer-persist'
import { PRODUCTS, type ProductKey } from './products'

const EPS_HR = 0.01
const EPS_DOLLARS = 0.5

export interface StaleLineInfo {
  lineId: string
  productKey: ProductKey
  qty: number
  /** Recomputed PER-UNIT storage values — what bulkRefreshStaleLines
   *  writes back into estimate_lines. */
  freshStorage: ComposerStorageValues
  /** Stored values, normalized to the same shape, for diff display. */
  storedHoursByDept: { eng: number; cnc: number; assembly: number; finish: number }
  storedMaterial: number
  /** Recomputed PER-UNIT values mirrored as plain numbers, for diff
   *  display alongside storedHoursByDept / storedMaterial. */
  freshHoursByDept: { eng: number; cnc: number; assembly: number; finish: number }
  freshMaterial: number
}

/**
 * Return null if the line isn't stale (or isn't a composer line); otherwise
 * return fresh PER-UNIT values the caller can use to write the refresh
 * back via bulkRefreshStaleLines.
 */
export function checkLineStaleness(
  line: EstimateLine,
  defaults: ComposerDefaults,
  rateBook: ComposerRateBook
): StaleLineInfo | null {
  if (!line.product_key || !line.product_slots) return null
  const product = PRODUCTS[line.product_key as ProductKey]
  if (!product || !product.active) return null

  const qty = Number(line.quantity) || 0
  const draft: ComposerDraft = {
    productId: line.product_key as ProductKey,
    qty,
    slots: line.product_slots as unknown as ComposerSlots,
  }
  const fresh = computeBreakdown(draft, rateBook, defaults)
  const freshStorage = breakdownToStorageValues(fresh, qty)
  const freshHoursByDept = {
    eng: Number(freshStorage.deptHourOverrides?.eng) || 0,
    cnc: Number(freshStorage.deptHourOverrides?.cnc) || 0,
    assembly: Number(freshStorage.deptHourOverrides?.assembly) || 0,
    finish: Number(freshStorage.deptHourOverrides?.finish) || 0,
  }

  const stored = {
    eng: Number((line.dept_hour_overrides as any)?.eng) || 0,
    cnc: Number((line.dept_hour_overrides as any)?.cnc) || 0,
    assembly: Number((line.dept_hour_overrides as any)?.assembly) || 0,
    finish: Number((line.dept_hour_overrides as any)?.finish) || 0,
  }
  const storedMat = Number(line.lump_cost_override) || 0

  const hoursDrift =
    Math.abs(stored.eng - freshHoursByDept.eng) > EPS_HR ||
    Math.abs(stored.cnc - freshHoursByDept.cnc) > EPS_HR ||
    Math.abs(stored.assembly - freshHoursByDept.assembly) > EPS_HR ||
    Math.abs(stored.finish - freshHoursByDept.finish) > EPS_HR
  const matDrift = Math.abs(storedMat - freshStorage.lumpCostOverride) > EPS_DOLLARS

  if (!hoursDrift && !matDrift) return null

  return {
    lineId: line.id,
    productKey: line.product_key as ProductKey,
    qty,
    freshStorage,
    freshHoursByDept,
    freshMaterial: freshStorage.lumpCostOverride,
    storedHoursByDept: stored,
    storedMaterial: storedMat,
  }
}

/** Find every stale composer line in a subproject. */
export function findStaleLines(
  lines: EstimateLine[],
  defaults: ComposerDefaults,
  rateBook: ComposerRateBook
): StaleLineInfo[] {
  const out: StaleLineInfo[] = []
  for (const line of lines) {
    const stale = checkLineStaleness(line, defaults, rateBook)
    if (stale) out.push(stale)
  }
  return out
}

/**
 * Overwrite each stale line's stored overrides with the recomputed values.
 * One UPDATE per line — subprojects have tens of lines, not thousands, so
 * the sequential cost is negligible. Returns the number of rows written.
 */
export async function bulkRefreshStaleLines(stale: StaleLineInfo[]): Promise<number> {
  let updated = 0
  for (const s of stale) {
    const { error } = await supabase
      .from('estimate_lines')
      .update({
        dept_hour_overrides: s.freshStorage.deptHourOverrides,
        lump_cost_override: s.freshStorage.lumpCostOverride,
        composer_hours_corrected: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', s.lineId)
    if (!error) updated++
    else console.error('bulkRefreshStaleLines row', s.lineId, error)
  }
  return updated
}
