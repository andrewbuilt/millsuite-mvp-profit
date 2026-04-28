// ============================================================================
// lib/composer-persist.ts — persistence helpers for the composer.
// ============================================================================
// - Last-used slots (orgs.last_used_slots_by_product) — shop-wide default
//   carry-over keyed by product. Read on composer open, written on save.
// - Subproject defaults (subprojects.defaults) — consumables + waste %
//   consumed by the breakdown panel.
// - Save-line — creates an estimate_lines row from a composer draft with
//   product_key + product_slots populated + override columns populated so
//   the existing subproject rollup math sees the right numbers without
//   needing to know about composer internals.
// ============================================================================

import { supabase } from './supabase'
import type {
  ComposerDefaults,
  ComposerDraft,
  ComposerBreakdown,
  ComposerRateBook,
  ComposerSlots,
} from './composer'
import { productLabelFromKey, summarizeSlots } from './composer'
import type { ProductKey } from './products'
import {
  recomputeProjectBidTotalForLine,
  recomputeProjectBidTotalForSubproject,
} from './project-totals'

export interface LastUsedPerProduct {
  qty: number
  slots: ComposerSlots
}

/** Read last_used_slots_by_product fresh from the org — no caching. */
export async function loadLastUsedByProduct(
  orgId: string
): Promise<Record<ProductKey, LastUsedPerProduct>> {
  const { data } = await supabase
    .from('orgs')
    .select('last_used_slots_by_product')
    .eq('id', orgId)
    .single()
  const raw = (data as any)?.last_used_slots_by_product
  if (!raw || typeof raw !== 'object') {
    return {} as Record<ProductKey, LastUsedPerProduct>
  }
  return raw as Record<ProductKey, LastUsedPerProduct>
}

/** Overwrite a single product's last-used entry. */
export async function saveLastUsedForProduct(
  orgId: string,
  productKey: ProductKey,
  entry: LastUsedPerProduct
): Promise<void> {
  // Read-modify-write instead of using jsonb merge operators so we don't
  // carry stale keys from other products into the write. Small payload,
  // simple semantics.
  const current = await loadLastUsedByProduct(orgId)
  const next = { ...current, [productKey]: entry }
  const { error } = await supabase
    .from('orgs')
    .update({ last_used_slots_by_product: next })
    .eq('id', orgId)
  if (error) {
    console.error('saveLastUsedForProduct', error)
    throw error
  }
}

// ── Subproject defaults ──

/** Read { consumablesPct, wastePct } for a subproject. Returns null when
 *  the column hasn't been initialized yet (pre-item-6 rows). Callers
 *  should fall back to their own defaults when null. */
export async function loadSubprojectDefaults(
  subprojectId: string
): Promise<ComposerDefaults | null> {
  const { data } = await supabase
    .from('subprojects')
    .select('defaults')
    .eq('id', subprojectId)
    .single()
  const raw = (data as any)?.defaults
  if (!raw || typeof raw !== 'object') return null
  const out: ComposerDefaults = {
    consumablesPct: Number(raw.consumablesPct) || 0,
    wastePct: Number(raw.wastePct) || 0,
  }
  return out
}

/** Update the subprojects.defaults jsonb. */
export async function saveSubprojectDefaults(
  subprojectId: string,
  defaults: ComposerDefaults
): Promise<void> {
  const { error } = await supabase
    .from('subprojects')
    .update({ defaults })
    .eq('id', subprojectId)
  if (error) {
    console.error('saveSubprojectDefaults', error)
    throw error
  }
}

/** Compute the initial defaults for a fresh subproject, given the org's
 *  consumable_markup_pct. Callers use this on insert so new subprojects
 *  land with a non-null defaults payload. */
export function initialSubprojectDefaults(
  orgConsumablePct: number | null | undefined
): ComposerDefaults {
  const consumablesPct =
    typeof orgConsumablePct === 'number' && orgConsumablePct > 0 ? orgConsumablePct : 10
  return { consumablesPct, wastePct: 5 }
}

// ── Storage-value helper ──

/**
 * The estimate_lines storage contract for composer lines:
 *   - dept_hour_overrides   keys: eng/cnc/assembly/finish/install, PER-UNIT hours
 *                           (computeLineBuildup multiplies by quantity at
 *                           read time). Only positive entries written;
 *                           null when every dept is zero.
 *   - lump_cost_override    PER-UNIT material total (materialSubtotal +
 *                           waste, NO consumables). computeSubprojectRollup
 *                           multiplies by quantity AND re-applies
 *                           consumables via ctx.consumableMarkupPct, so
 *                           consumables must NOT be baked in here.
 *
 * computeBreakdown returns whole-line totals (qty already multiplied in).
 * Anywhere we persist or compare against storage we must divide by qty
 * and strip consumables.
 *
 * Issue 18 lived here for save (8× labor on round-trip). The same shape
 * is required by checkLineStaleness (false-positive banner if it
 * compares per-unit storage to whole-line fresh) and bulkRefreshStaleLines
 * (writes 8× back if it stores whole-line totals on refresh). One helper,
 * one contract, four callers.
 */
export interface ComposerStorageValues {
  /** Per-unit hours by dept; null when every dept is zero. */
  deptHourOverrides: Record<string, number> | null
  /** Per-unit (materialSubtotal + waste) — no consumables. */
  lumpCostOverride: number
}

export function breakdownToStorageValues(
  breakdown: ComposerBreakdown,
  qty: number
): ComposerStorageValues {
  const deptHourOverrides: Record<string, number> = {}
  if (qty > 0) {
    if (breakdown.hoursByDept.eng > 0)      deptHourOverrides.eng      = breakdown.hoursByDept.eng      / qty
    if (breakdown.hoursByDept.cnc > 0)      deptHourOverrides.cnc      = breakdown.hoursByDept.cnc      / qty
    if (breakdown.hoursByDept.assembly > 0) deptHourOverrides.assembly = breakdown.hoursByDept.assembly / qty
    if (breakdown.hoursByDept.finish > 0)   deptHourOverrides.finish   = breakdown.hoursByDept.finish   / qty
    if (breakdown.hoursByDept.install > 0)  deptHourOverrides.install  = breakdown.hoursByDept.install  / qty
  }
  const lumpCostOverride =
    qty > 0 ? (breakdown.materialSubtotal + breakdown.waste) / qty : 0
  return {
    deptHourOverrides:
      Object.keys(deptHourOverrides).length > 0 ? deptHourOverrides : null,
    lumpCostOverride,
  }
}

// ── Save a composer line ──

/**
 * Turn a composer draft + breakdown into an estimate_lines row. Writes:
 *   - product_key, product_slots     (for round-trip edit)
 *   - description, quantity, unit    (subproject list renders these)
 *   - dept_hour_overrides            (so subproject rollup math sees labor)
 *   - material_mode_override='lump'  +  lump_cost_override              (so
 *                                     subproject rollup sees material $
 *                                     without re-computing from a rate-
 *                                     book item — composer lines don't
 *                                     have a single rate_book_item_id)
 *   - rate_book_item_id = NULL       (composer lines are template-
 *                                     composed; no single item to back
 *                                     them)
 */
export async function saveComposerLine(input: {
  subprojectId: string
  draft: ComposerDraft
  breakdown: ComposerBreakdown
  rateBook: ComposerRateBook
}): Promise<{ id: string } | null> {
  const { subprojectId, draft, breakdown, rateBook } = input

  // sort_order = max + 1.
  const { data: last } = await supabase
    .from('estimate_lines')
    .select('sort_order')
    .eq('subproject_id', subprojectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = last?.sort_order != null ? Number(last.sort_order) + 1 : 0

  const summary = summarizeSlots(draft, rateBook)
  const productLabel = productLabelFromKey(draft.productId)
  const description = summary ? `${productLabel} · ${summary}` : productLabel

  // computeBreakdown returns whole-line totals; the storage columns are
  // per-unit. See breakdownToStorageValues for the full contract.
  const storage = breakdownToStorageValues(breakdown, Number(draft.qty) || 0)

  const { data, error } = await supabase
    .from('estimate_lines')
    .insert({
      subproject_id: subprojectId,
      sort_order: nextOrder,
      description,
      rate_book_item_id: null,
      quantity: draft.qty,
      unit: 'lf',
      product_key: draft.productId,
      product_slots: draft.slots,
      material_mode_override: 'lump',
      lump_cost_override: storage.lumpCostOverride,
      dept_hour_overrides: storage.deptHourOverrides,
      notes: draft.slots.notes || null,
      composer_hours_corrected: true,
    })
    .select('id')
    .single()
  if (error) {
    console.error('saveComposerLine', error)
    throw new Error(error.message || 'Failed to save line')
  }
  // Pricing-input write-back: keep projects.bid_total in sync with the
  // live priceTotal. Fire-and-forget; failures log but don't block the
  // save UI. See lib/project-totals.ts for the contract.
  void recomputeProjectBidTotalForSubproject(subprojectId)
  return data as { id: string }
}

// ── Update an existing composer line (edit mode) ──

/**
 * Mirror of saveComposerLine for an existing row. Used by AddLineComposer
 * when opened in edit mode (Issue 19) so a line click round-trips through
 * the same form the line was created in. sort_order stays put;
 * subproject_id, product_key, rate_book_item_id are left alone.
 *
 * Per-unit divides match the save path via breakdownToStorageValues.
 * Stamps composer_hours_corrected = true so this row is excluded from
 * any future rerun of migration 029.
 */
export async function updateComposerLine(input: {
  lineId: string
  draft: ComposerDraft
  breakdown: ComposerBreakdown
  rateBook: ComposerRateBook
}): Promise<void> {
  const { lineId, draft, breakdown, rateBook } = input

  const summary = summarizeSlots(draft, rateBook)
  const productLabel = productLabelFromKey(draft.productId)
  const description = summary ? `${productLabel} · ${summary}` : productLabel

  const storage = breakdownToStorageValues(breakdown, Number(draft.qty) || 0)

  const { error } = await supabase
    .from('estimate_lines')
    .update({
      description,
      quantity: draft.qty,
      product_slots: draft.slots,
      material_mode_override: 'lump',
      lump_cost_override: storage.lumpCostOverride,
      dept_hour_overrides: storage.deptHourOverrides,
      notes: draft.slots.notes || null,
      composer_hours_corrected: true,
    })
    .eq('id', lineId)
  if (error) {
    console.error('updateComposerLine', error)
    throw new Error(error.message || 'Failed to update line')
  }
  // Pricing-input write-back. The lineId path resolves project_id via a
  // single subproject_id lookup — see recomputeProjectBidTotalForLine.
  void recomputeProjectBidTotalForLine(lineId)
}
