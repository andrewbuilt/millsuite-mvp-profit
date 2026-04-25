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
import { summarizeSlots } from './composer'
import type { ProductKey } from './products'

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
  const productLabel =
    draft.productId === 'base'
      ? 'Base cabinet'
      : draft.productId === 'upper'
      ? 'Upper cabinet'
      : draft.productId === 'full'
      ? 'Full height'
      : draft.productId
  const description = summary ? `${productLabel} · ${summary}` : productLabel

  // computeBreakdown returns hours-by-dept for the WHOLE LINE (qty
  // already multiplied in). estimate_lines.dept_hour_overrides is a
  // PER-UNIT contract — computeLineBuildup multiplies by quantity at
  // read time. Divide here so the saved line round-trips correctly.
  // Issue 18 (Phase 12 dogfood-4): without this divide the line reads
  // back at qty² hours, producing 8× labor cost on an 8-LF line.
  const qty = Number(draft.qty) || 0
  const deptHourOverrides: Record<string, number> = {}
  if (qty > 0) {
    if (breakdown.hoursByDept.eng > 0)      deptHourOverrides.eng      = breakdown.hoursByDept.eng      / qty
    if (breakdown.hoursByDept.cnc > 0)      deptHourOverrides.cnc      = breakdown.hoursByDept.cnc      / qty
    if (breakdown.hoursByDept.assembly > 0) deptHourOverrides.assembly = breakdown.hoursByDept.assembly / qty
    if (breakdown.hoursByDept.finish > 0)   deptHourOverrides.finish   = breakdown.hoursByDept.finish   / qty
  }

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
      lump_cost_override: breakdown.totals.material,
      dept_hour_overrides:
        Object.keys(deptHourOverrides).length > 0 ? deptHourOverrides : null,
      notes: draft.slots.notes || null,
      composer_hours_corrected: true,
    })
    .select('id')
    .single()
  if (error) {
    console.error('saveComposerLine', error)
    throw new Error(error.message || 'Failed to save line')
  }
  return data as { id: string }
}
