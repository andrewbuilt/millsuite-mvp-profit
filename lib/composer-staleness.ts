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
import { recomputeProjectBidTotalForLine } from './project-totals'

// EPS thresholds for "stale" detection. Real walkthrough recalibrations
// move per-dept hours by half-hours and material by tens of dollars, so
// these can be loose enough to swallow rounding / floating-point noise
// without missing genuine drift.
//
//   EPS_HR      — 0.05 hr/dept (3 minutes) per unit. A real recalibration
//                 typically shifts a dept by 0.5-2.0 hr. Sub-3-minute
//                 drift on per-unit values is float noise from
//                 (whole-line / qty) divides + walkthrough rounding.
//   EPS_DOLLARS — $1 per unit material total. Material recalibrations
//                 move sheet costs by $5+; sub-dollar drift is rounding.
//
// Bumped from 0.01 / 0.5 in the post-sale dogfood pass after Andrew saw
// the staleness banner fire on freshly-composed lines that hadn't been
// touched. Pre-bump thresholds were tight enough to surface every
// computed-vs-stored float wobble as fake staleness.
const EPS_HR = 0.05
const EPS_DOLLARS = 1.0

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

  // Diagnostic: log every drift trip at info level so the dogfood
  // staleness-banner-firing-repeatedly investigation can see exactly
  // which line drifted by how much. Reproduce → screenshot the
  // console → paste in the issue. Once we've identified the path,
  // dial this back to console.debug.
  if (typeof console !== 'undefined') {
    console.log('staleness drift', line.id, {
      product_key: line.product_key,
      stored,
      freshHoursByDept,
      hoursDeltas: {
        eng: stored.eng - freshHoursByDept.eng,
        cnc: stored.cnc - freshHoursByDept.cnc,
        assembly: stored.assembly - freshHoursByDept.assembly,
        finish: stored.finish - freshHoursByDept.finish,
      },
      storedMat,
      freshMat: freshStorage.lumpCostOverride,
      matDelta: storedMat - freshStorage.lumpCostOverride,
      hoursDrift,
      matDrift,
      eps: { EPS_HR, EPS_DOLLARS },
    })
  }

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
  // Diagnostic: summary print so the dogfood staleness-firing-
  // repeatedly investigation can see every call's count + per-line
  // breakdown in a single console entry. Reproduce the banner →
  // copy this entry → paste. Pull this back to console.debug once
  // we've identified the firing path.
  if (typeof console !== 'undefined') {
    console.log('findStaleLines', {
      totalLines: lines.length,
      composerLines: lines.filter((l) => l.product_key && l.product_slots).length,
      staleCount: out.length,
      stale: out.map((s) => ({
        lineId: s.lineId,
        productKey: s.productKey,
        hoursDeltas: {
          eng: s.storedHoursByDept.eng - s.freshHoursByDept.eng,
          cnc: s.storedHoursByDept.cnc - s.freshHoursByDept.cnc,
          assembly: s.storedHoursByDept.assembly - s.freshHoursByDept.assembly,
          finish: s.storedHoursByDept.finish - s.freshHoursByDept.finish,
        },
        matDelta: s.storedMaterial - s.freshMaterial,
      })),
    })
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
  // Pricing-input write-back. The fresh storage values change line totals,
  // so the project price moves with them. One refresh per touched
  // subproject would be lighter; recompute-by-line dedupes implicitly when
  // batched lines share a project.
  if (stale.length > 0) {
    void recomputeProjectBidTotalForLine(stale[0].lineId)
  }
  return updated
}

/**
 * Auto-refresh every stale line on a project. Called after rate-book
 * calibration changes (door type, drawer style, base cabinet, finish,
 * inline material/finish adds) so silent drift never accumulates: the
 * operator calibrated a thing, every line that uses it gets pulled up
 * to the new values immediately.
 *
 * Loads the project's subprojects + estimate_lines + composer rate book
 * + defaults, runs findStaleLines, calls bulkRefreshStaleLines. Returns
 * the count of lines updated. Skip the call entirely from the caller
 * side when no projectId is in context (calibrating from the rate
 * book page) — this helper assumes a project.
 *
 * Errors land as warnings; the calibration UI shouldn't block on
 * background staleness refresh.
 */
export async function autoRefreshStaleForProject(
  orgId: string,
  projectId: string,
): Promise<number> {
  try {
    // Load all subprojects under the project.
    const { data: subs } = await supabase
      .from('subprojects')
      .select('id, defaults')
      .eq('project_id', projectId)
    if (!subs || subs.length === 0) return 0

    // Load lines + rate book in parallel.
    const subIds = subs.map((s: any) => s.id as string)
    const [{ data: lines }, rateBook] = await Promise.all([
      supabase
        .from('estimate_lines')
        .select(
          'id, subproject_id, product_key, product_slots, quantity, dept_hour_overrides, lump_cost_override',
        )
        .in('subproject_id', subIds),
      loadComposerRateBookForProject(orgId),
    ])
    if (!lines || lines.length === 0) return 0
    if (!rateBook) return 0

    const linesBySub = new Map<string, EstimateLine[]>()
    for (const l of lines as EstimateLine[]) {
      const arr = linesBySub.get(l.subproject_id as string) ?? []
      arr.push(l)
      linesBySub.set(l.subproject_id as string, arr)
    }

    let allStale: StaleLineInfo[] = []
    for (const sub of subs as any[]) {
      const subLines = linesBySub.get(sub.id) ?? []
      const defaults: ComposerDefaults = {
        consumablesPct: Number(sub.defaults?.consumablesPct) || 0,
        wastePct: Number(sub.defaults?.wastePct) || 0,
      }
      const stale = findStaleLines(subLines, defaults, rateBook)
      allStale = allStale.concat(stale)
    }

    if (allStale.length === 0) {
      console.log('autoRefreshStaleForProject', { projectId, updated: 0 })
      return 0
    }
    const updated = await bulkRefreshStaleLines(allStale)
    console.log('autoRefreshStaleForProject', {
      projectId,
      updated,
      flagged: allStale.length,
    })
    return updated
  } catch (err) {
    console.warn('autoRefreshStaleForProject failed', err)
    return 0
  }
}

/** Side-import the rate-book loader without dragging the full module
 *  into the staleness file's static surface — keeps cold-load cheap on
 *  pages that never trigger a refresh. */
async function loadComposerRateBookForProject(
  orgId: string,
): Promise<ComposerRateBook | null> {
  try {
    const mod = await import('./composer-loader')
    return mod.loadComposerRateBook(orgId)
  } catch (err) {
    console.warn('loadComposerRateBookForProject failed', err)
    return null
  }
}
