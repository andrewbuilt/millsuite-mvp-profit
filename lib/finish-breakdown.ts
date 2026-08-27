// ============================================================================
// lib/finish-breakdown.ts — the real finish rates (small-fixes wave, item 5)
// ============================================================================
// A finish item's `base_labor_hours_*` columns are NOT what prices a finish.
// The composer reads `rate_book_finish_breakdown` (migration 019): one row per
// finish item × product category (base / upper / full), holding labor hr/LF
// plus four material $/LF buckets. See `loadFinishes` in composer-loader.
//
// Until now those rows were written only by `FinishWalkthrough` (which
// calibrates from an 8' run and divides by 8), so the rate book displayed
// numbers nothing priced from and offered no way to correct a rate without
// re-running the wizard. This module is the shared read/write surface for
// both the wizard and the Finishes tab's inline editor.
//
// NOT this table: per-DOOR finishes (`door_type_material_finishes`), which
// back the composer's Door Finish dropdown and are edited on the Doors tab.
// ============================================================================

import { supabase } from './supabase'

export const FINISH_PRODUCT_CATEGORIES = ['base', 'upper', 'full'] as const
export type FinishProductCategory = (typeof FINISH_PRODUCT_CATEGORIES)[number]

export const FINISH_PRODUCT_LABEL: Record<FinishProductCategory, string> = {
  base: 'Base',
  upper: 'Upper',
  full: 'Full height',
}

/** The four material buckets, in display order. Kept as data so the editor
 *  and the totals can't drift apart. */
export const FINISH_MATERIAL_FIELDS = [
  { key: 'primer_cost_per_lf', label: 'Primer' },
  { key: 'paint_cost_per_lf', label: 'Paint' },
  { key: 'stain_cost_per_lf', label: 'Stain' },
  { key: 'lacquer_cost_per_lf', label: 'Lacquer' },
] as const

export type FinishMaterialField = (typeof FINISH_MATERIAL_FIELDS)[number]['key']

export interface FinishPerLf {
  labor_hr_per_lf: number
  primer_cost_per_lf: number
  paint_cost_per_lf: number
  stain_cost_per_lf: number
  lacquer_cost_per_lf: number
}

export interface FinishBreakdownRow extends FinishPerLf {
  rate_book_item_id: string
  product_category: FinishProductCategory
}

export const EMPTY_PER_LF: FinishPerLf = {
  labor_hr_per_lf: 0,
  primer_cost_per_lf: 0,
  paint_cost_per_lf: 0,
  stain_cost_per_lf: 0,
  lacquer_cost_per_lf: 0,
}

const COLUMNS =
  'rate_book_item_id, product_category, labor_hr_per_lf, primer_cost_per_lf, paint_cost_per_lf, stain_cost_per_lf, lacquer_cost_per_lf'

/** Σ of the four material buckets — what the composer folds into a line. */
export function finishMaterialPerLf(row: FinishPerLf): number {
  return FINISH_MATERIAL_FIELDS.reduce((s, f) => s + (Number(row[f.key]) || 0), 0)
}

/** Breakdown rows for one finish item, keyed by product category. Missing
 *  categories are simply absent — a finish calibrated for base only has one
 *  row, and the editor renders the rest as zeros. */
export async function loadFinishBreakdown(
  itemId: string,
): Promise<Partial<Record<FinishProductCategory, FinishPerLf>>> {
  const { data, error } = await supabase
    .from('rate_book_finish_breakdown')
    .select(COLUMNS)
    .eq('rate_book_item_id', itemId)
  if (error) {
    console.error('loadFinishBreakdown', error)
    return {}
  }
  const out: Partial<Record<FinishProductCategory, FinishPerLf>> = {}
  for (const r of (data || []) as FinishBreakdownRow[]) {
    if (!FINISH_PRODUCT_CATEGORIES.includes(r.product_category)) continue
    out[r.product_category] = {
      labor_hr_per_lf: Number(r.labor_hr_per_lf) || 0,
      primer_cost_per_lf: Number(r.primer_cost_per_lf) || 0,
      paint_cost_per_lf: Number(r.paint_cost_per_lf) || 0,
      stain_cost_per_lf: Number(r.stain_cost_per_lf) || 0,
      lacquer_cost_per_lf: Number(r.lacquer_cost_per_lf) || 0,
    }
  }
  return out
}

/** Which of these finish items are actually calibrated — i.e. carry at least
 *  one breakdown row with a non-zero rate.
 *
 *  The roster's "uncalibrated ø" pill sums an item's base_labor_hours_*, and
 *  `ensureFinishItem` never writes those for a finish, so without this every
 *  finish read as uncalibrated forever no matter how well it was calibrated.
 *  One query for the whole roster. */
export async function loadCalibratedFinishItemIds(itemIds: string[]): Promise<Set<string>> {
  const out = new Set<string>()
  if (itemIds.length === 0) return out
  const { data, error } = await supabase
    .from('rate_book_finish_breakdown')
    .select(COLUMNS)
    .in('rate_book_item_id', itemIds)
  if (error) {
    console.error('loadCalibratedFinishItemIds', error)
    return out
  }
  for (const r of (data || []) as FinishBreakdownRow[]) {
    if ((Number(r.labor_hr_per_lf) || 0) > 0 || finishMaterialPerLf(r) > 0) {
      out.add(r.rate_book_item_id)
    }
  }
  return out
}

/** Write one finish item × product-category row. The UNIQUE constraint from
 *  019 makes this an upsert, so it's the same call whether the wizard is
 *  calibrating for the first time or the Finishes tab is correcting a rate. */
export async function saveFinishBreakdown(
  itemId: string,
  product: FinishProductCategory,
  perLf: FinishPerLf,
): Promise<void> {
  const { error } = await supabase.from('rate_book_finish_breakdown').upsert(
    {
      rate_book_item_id: itemId,
      product_category: product,
      ...perLf,
      calibrated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'rate_book_item_id,product_category' },
  )
  if (error) throw error
}
