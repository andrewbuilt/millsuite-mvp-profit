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
// Labor $ is hours × the JOB's pinned rate (projects.locked_shop_rate,
// stamped at creation since 118), so a shop-rate edit alone is NOT stale
// here and moves nothing by itself — the project page's ShopRateBanner
// (lib/shop-rate-gateway) offers the new rate per project instead.
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
  unresolvedSlotIds,
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
  storedHoursByDept: { eng: number; cnc: number; assembly: number; finish: number; install: number }
  storedMaterial: number
  /** Recomputed PER-UNIT values mirrored as plain numbers, for diff
   *  display alongside storedHoursByDept / storedMaterial. */
  freshHoursByDept: { eng: number; cnc: number; assembly: number; finish: number; install: number }
  freshMaterial: number
  /** What the recompute priced the material WITH, from the current rate
   *  book — "Carcass: 0.90 sht × $180". The banner shows these so a fire is
   *  diagnosable on sight (October batch item 8): the operator sees today's
   *  price and recognises it's not the price they quoted. */
  freshMaterialNotes: string[]
  /** The waste % the recompute used (baked into lump_cost_override). */
  wastePct: number
}

const DEPT_LABEL: Record<keyof StaleLineInfo['storedHoursByDept'], string> = {
  eng: 'Eng',
  cnc: 'CNC',
  assembly: 'Assembly',
  finish: 'Finish',
  install: 'Install',
}

/** The diff the banner prints — one call so the panel can't do its own math. */
export interface StaleLineMath {
  /** Per-dept PER-UNIT hours that moved: label, stored, fresh. */
  hours: Array<{ dept: string; stored: number; fresh: number }>
  /** PER-UNIT material (before consumables), stored vs fresh. Null when it
   *  didn't move past the threshold. */
  material: { stored: number; fresh: number } | null
  /** Whole-line $ change if refreshed: Δmaterial×qty + Δhours×qty×rate.
   *  Before consumables (the rollup re-applies them on top). */
  dollarDelta: number
  /** The labour rate the hours delta was priced at. */
  rate: number
}

export function staleLineMath(info: StaleLineInfo, shopRate: number): StaleLineMath {
  const hours: StaleLineMath['hours'] = []
  let hoursDelta = 0
  for (const k of Object.keys(DEPT_LABEL) as Array<keyof typeof DEPT_LABEL>) {
    const st = info.storedHoursByDept[k]
    const fr = info.freshHoursByDept[k]
    if (Math.abs(st - fr) > EPS_HR) hours.push({ dept: DEPT_LABEL[k], stored: st, fresh: fr })
    hoursDelta += fr - st
  }
  const matMoved = Math.abs(info.storedMaterial - info.freshMaterial) > EPS_DOLLARS
  const rate = Number(shopRate) || 0
  return {
    hours,
    material: matMoved ? { stored: info.storedMaterial, fresh: info.freshMaterial } : null,
    dollarDelta: (info.freshMaterial - info.storedMaterial) * info.qty + hoursDelta * info.qty * rate,
    rate,
  }
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

  const slots = line.product_slots as unknown as ComposerSlots

  // ⛔ FIRST, BEFORE ANY COMPARISON. A slot id that no longer resolves makes
  // computeBreakdown price that component at ZERO (it resolves with
  // `find() || null` and treats null as free), so the line recomputes far
  // cheaper and looks stale. It isn't — it's UNRESOLVABLE.
  //
  // Returning null here fixes two things at once:
  //   · the banner stops firing on lines nobody touched, which is the
  //     "pops up randomly and doesn't make sense" report; and
  //   · more importantly it keeps the line OUT of bulkRefreshStaleLines,
  //     which would otherwise write the zeroed cost straight into a live
  //     estimate and quietly delete real material money.
  //
  // The fix for these lines is to re-pick the slot, which the editor already
  // tells the operator to do — it can't be recomputed.
  const missing = unresolvedSlotIds(slots, rateBook)
  if (missing.length > 0) {
    if (typeof console !== 'undefined') {
      console.warn(
        `checkLineStaleness: line ${line.id} references ${missing.length} slot(s) that no ` +
          `longer exist in the rate book (${missing.join(', ')}). NOT marking stale — a ` +
          `refresh would price the missing part at $0. Re-pick the slot on this line.`,
      )
    }
    return null
  }

  const qty = Number(line.quantity) || 0
  const draft: ComposerDraft = {
    productId: line.product_key as ProductKey,
    qty,
    slots,
  }
  const fresh = computeBreakdown(draft, rateBook, defaults)

  // ⛔ Same hazard, different cause. A door type or drawer style that resolves
  // but is UNCALIBRATED prices its labour at zero — computeBreakdown guards
  // with `if (dt && dt.calibrated)`. If it was calibrated when the line was
  // saved and isn't now (someone cleared the walkthrough), the recompute drops
  // real hours and a refresh would bank that loss. The breakdown already tells
  // us; we just have to not act on it.
  if (fresh.doorLaborWarn || fresh.drawerLaborWarn) {
    if (typeof console !== 'undefined') {
      console.warn(
        `checkLineStaleness: line ${line.id} prices against an UNCALIBRATED ` +
          `${fresh.doorLaborWarn ? 'door type' : 'drawer style'} — its labour recomputes to 0. ` +
          `NOT marking stale; calibrate it in the rate book instead.`,
      )
    }
    return null
  }

  const freshStorage = breakdownToStorageValues(fresh, qty)
  const freshHoursByDept = {
    eng: Number(freshStorage.deptHourOverrides?.eng) || 0,
    cnc: Number(freshStorage.deptHourOverrides?.cnc) || 0,
    assembly: Number(freshStorage.deptHourOverrides?.assembly) || 0,
    finish: Number(freshStorage.deptHourOverrides?.finish) || 0,
    install: Number(freshStorage.deptHourOverrides?.install) || 0,
  }

  const stored = {
    eng: Number((line.dept_hour_overrides as any)?.eng) || 0,
    cnc: Number((line.dept_hour_overrides as any)?.cnc) || 0,
    assembly: Number((line.dept_hour_overrides as any)?.assembly) || 0,
    finish: Number((line.dept_hour_overrides as any)?.finish) || 0,
    install: Number((line.dept_hour_overrides as any)?.install) || 0,
  }
  const storedMat = Number(line.lump_cost_override) || 0

  const hoursDrift =
    Math.abs(stored.eng - freshHoursByDept.eng) > EPS_HR ||
    Math.abs(stored.cnc - freshHoursByDept.cnc) > EPS_HR ||
    Math.abs(stored.assembly - freshHoursByDept.assembly) > EPS_HR ||
    Math.abs(stored.finish - freshHoursByDept.finish) > EPS_HR ||
    Math.abs(stored.install - freshHoursByDept.install) > EPS_HR
  const matDrift = Math.abs(storedMat - freshStorage.lumpCostOverride) > EPS_DOLLARS

  if (!hoursDrift && !matDrift) return null

  // Defensive: if the fresh recompute returns all-zero hours but the
  // stored row had non-zero hours, treat this as a transient compute
  // failure (e.g. solidWoodTopCalibration missing because PGRST hadn't
  // reloaded the schema cache yet, or a rate-book row got archived
  // mid-session) rather than legitimate staleness. Marking stale here
  // would tee up bulkRefreshStaleLines to wipe the stored hours to
  // null on the next click — silently zeroing a working line. Skip
  // until the caller has a non-zero recompute to compare against.
  const storedHasHours =
    stored.eng + stored.cnc + stored.assembly + stored.finish + stored.install > 0
  const freshHasHours =
    freshHoursByDept.eng +
      freshHoursByDept.cnc +
      freshHoursByDept.assembly +
      freshHoursByDept.finish +
      freshHoursByDept.install >
    0
  if (storedHasHours && !freshHasHours) {
    if (typeof console !== 'undefined') {
      console.warn(
        'checkLineStaleness: fresh recompute returned 0 hours; preserving stored values',
        line.id,
      )
    }
    return null
  }

  // Diagnostic: log whenever drift trips so we can tell genuine
  // recalibration drift from float-noise false positives. Printed at
  // debug level so it doesn't pollute regular logs unless the user
  // opens the browser console with Verbose enabled. Includes the
  // exact stored vs fresh values + which dept(s) tripped the threshold
  // so a screenshot is enough to diagnose.
  if (typeof console !== 'undefined') {
    console.debug('staleness', line.id, {
      stored,
      freshHoursByDept,
      hoursDeltas: {
        eng: stored.eng - freshHoursByDept.eng,
        cnc: stored.cnc - freshHoursByDept.cnc,
        assembly: stored.assembly - freshHoursByDept.assembly,
        finish: stored.finish - freshHoursByDept.finish,
        install: stored.install - freshHoursByDept.install,
      },
      storedMat,
      freshMat: freshStorage.lumpCostOverride,
      matDelta: storedMat - freshStorage.lumpCostOverride,
      hoursDrift,
      matDrift,
      eps: { EPS_HR, EPS_DOLLARS },
    })
  }

  const notes: string[] = []
  const note = (label: string, detail: string | null | undefined) => {
    if (detail) notes.push(`${label}: ${detail}`)
  }
  note('Carcass', fresh.carcassMaterialDetail)
  note('Back', fresh.backPanelMaterialDetail)
  note('Doors', fresh.doorMaterialDetail)
  note('Drawers', fresh.drawerMaterialDetail)
  note('Features', fresh.featureDetail)
  note('Interior finish', fresh.interiorFinishDetail)
  note('Exterior finish', fresh.exteriorFinishDetail)

  return {
    lineId: line.id,
    productKey: line.product_key as ProductKey,
    qty,
    freshMaterialNotes: notes,
    wastePct: Number(defaults.wastePct) || 0,
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
  // Pricing-input write-back. The fresh storage values change line totals,
  // so the project price moves with them. One refresh per touched
  // subproject would be lighter; recompute-by-line dedupes implicitly when
  // batched lines share a project.
  if (stale.length > 0) {
    void recomputeProjectBidTotalForLine(stale[0].lineId)
  }
  return updated
}

// ── The ignore (2026-10-21 shop-rate audit) ─────────────────────────────────
// "Ignore" must cost nothing forever: the banner used to re-fire identically
// on every visit with no way to decline. Declining a line stores the
// SIGNATURE of the fresh values it was offered (estimate_lines
// .stale_ignored_sig, migration 118). The line stays quiet while the rate
// book keeps offering that same number, and speaks up again only when the
// rate book moves it somewhere NEW.

const r4 = (n: number) => Math.round((Number(n) || 0) * 10000) / 10000

/** Stable signature of what a refresh would write for this line. */
export function staleSignature(s: StaleLineInfo): string {
  const h = s.freshHoursByDept
  return JSON.stringify([r4(h.eng), r4(h.cnc), r4(h.assembly), r4(h.finish), r4(h.install), r4(s.freshMaterial)])
}

/** lineId → ignored signature for one subproject. Empty on any failure,
 *  including a pre-118 database (nothing ignored = today's behaviour). */
export async function loadIgnoredStaleSigs(subprojectId: string): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('estimate_lines')
    .select('id, stale_ignored_sig')
    .eq('subproject_id', subprojectId)
    .not('stale_ignored_sig', 'is', null)
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const r of data as Array<{ id: string; stale_ignored_sig: string }>) out[r.id] = r.stale_ignored_sig
  return out
}

/** Decline these lines' offers. Nothing is repriced. */
export async function ignoreStaleLines(stale: StaleLineInfo[]): Promise<void> {
  for (const s of stale) {
    const { error } = await supabase
      .from('estimate_lines')
      .update({ stale_ignored_sig: staleSignature(s) })
      .eq('id', s.lineId)
    if (error) {
      throw new Error(
        /stale_ignored_sig/.test(error.message) ? 'Run migration 118 to remember this choice.' : error.message,
      )
    }
  }
}

/** What each stale line's fresh storage would write — the what-if input for
 *  computeProjectPrice, so the sent-price guard can show the new total. */
export function staleLineOverrides(stale: StaleLineInfo[]): Record<string, Partial<EstimateLine>> {
  const out: Record<string, Partial<EstimateLine>> = {}
  for (const s of stale) {
    out[s.lineId] = {
      dept_hour_overrides: s.freshStorage.deptHourOverrides as EstimateLine['dept_hour_overrides'],
      lump_cost_override: s.freshStorage.lumpCostOverride,
    }
  }
  return out
}
