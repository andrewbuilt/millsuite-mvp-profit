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
//   - dept_hour_overrides  — per-dept hours computed at save time
//   - lump_cost_override   — material subtotal (incl. consumables + waste)
// Labor $ is computed live at read time (computeSubprojectRollup reads
// current shop_labor_rates), so a shop-rate edit alone is NOT stale —
// every displayed labor cost already reflects the new rate.
//
// Staleness is triggered by:
//   - Walkthrough recalibration (base cab, door, finish) — shifts the
//     per-unit labor hours pulled into the breakdown. Stored
//     dept_hour_overrides no longer match a fresh computeBreakdown.
//   - Material template edits (sheet cost / sheets-per-LF) — shift the
//     material total. Stored lump_cost_override no longer matches.
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
import { PRODUCTS, type ProductKey } from './products'

const EPS_HR = 0.01
const EPS_DOLLARS = 0.5

export interface StaleLineInfo {
  lineId: string
  productKey: ProductKey
  qty: number
  /** The recomputed hours — used by bulkRefreshStaleLines to write back. */
  freshHoursByDept: { eng: number; cnc: number; assembly: number; finish: number }
  /** The recomputed material total (incl. consumables + waste). */
  freshMaterial: number
  /** Stored values — so the UI can describe the delta if it wants. */
  storedHoursByDept: { eng: number; cnc: number; assembly: number; finish: number }
  storedMaterial: number
}

/**
 * Return null if the line isn't stale (or isn't a composer line); otherwise
 * return fresh values the caller can use to write the refresh back.
 */
export function checkLineStaleness(
  line: EstimateLine,
  defaults: ComposerDefaults,
  rateBook: ComposerRateBook
): StaleLineInfo | null {
  if (!line.product_key || !line.product_slots) return null
  const product = PRODUCTS[line.product_key as ProductKey]
  if (!product || !product.active) return null

  const draft: ComposerDraft = {
    productId: line.product_key as ProductKey,
    qty: Number(line.quantity) || 0,
    slots: line.product_slots as ComposerSlots,
  }
  const fresh = computeBreakdown(draft, rateBook, defaults)

  const stored = {
    eng: Number((line.dept_hour_overrides as any)?.eng) || 0,
    cnc: Number((line.dept_hour_overrides as any)?.cnc) || 0,
    assembly: Number((line.dept_hour_overrides as any)?.assembly) || 0,
    finish: Number((line.dept_hour_overrides as any)?.finish) || 0,
  }
  const storedMat = Number(line.lump_cost_override) || 0

  const hoursDrift =
    Math.abs(stored.eng - fresh.hoursByDept.eng) > EPS_HR ||
    Math.abs(stored.cnc - fresh.hoursByDept.cnc) > EPS_HR ||
    Math.abs(stored.assembly - fresh.hoursByDept.assembly) > EPS_HR ||
    Math.abs(stored.finish - fresh.hoursByDept.finish) > EPS_HR
  const matDrift = Math.abs(storedMat - fresh.totals.material) > EPS_DOLLARS

  if (!hoursDrift && !matDrift) return null

  return {
    lineId: line.id,
    productKey: line.product_key as ProductKey,
    qty: Number(line.quantity) || 0,
    freshHoursByDept: fresh.hoursByDept,
    freshMaterial: fresh.totals.material,
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
    const deptHourOverrides: Record<string, number> = {}
    if (s.freshHoursByDept.eng > 0)      deptHourOverrides.eng      = s.freshHoursByDept.eng
    if (s.freshHoursByDept.cnc > 0)      deptHourOverrides.cnc      = s.freshHoursByDept.cnc
    if (s.freshHoursByDept.assembly > 0) deptHourOverrides.assembly = s.freshHoursByDept.assembly
    if (s.freshHoursByDept.finish > 0)   deptHourOverrides.finish   = s.freshHoursByDept.finish

    const { error } = await supabase
      .from('estimate_lines')
      .update({
        dept_hour_overrides:
          Object.keys(deptHourOverrides).length > 0 ? deptHourOverrides : null,
        lump_cost_override: s.freshMaterial,
        updated_at: new Date().toISOString(),
      })
      .eq('id', s.lineId)
    if (!error) updated++
    else console.error('bulkRefreshStaleLines row', s.lineId, error)
  }
  return updated
}
