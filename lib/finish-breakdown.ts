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

// ── The interior finish set ──
//
// Four finishes, no door-style dimension: the inside of a box is flat whatever
// the doors look like, so the old "on slab" / "on shaker" split described
// something that never changed the rate. What does change it is the finish and
// the cabinet type — the latter being the base/upper/full breakdown rows.
//
// These names are LOAD-BEARING: `ensureFinishItem` matches rows on
// (name, application), so they're centralised here rather than typed inline.

export const INTERIOR_FINISH_NAME = {
  clear: 'Clear',
  stainClear: 'Stain + clear',
  paint: 'Paint',
  glossPaint: 'Gloss paint',
} as const

/** Pre-item-7 names mapped 1:1 onto the flat set. Without this the new names
 *  would mint fresh items and strand the old four in the tab, where there's no
 *  delete UI to clear them. */
export const LEGACY_FINISH_RENAMES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'Paint on shaker', to: INTERIOR_FINISH_NAME.paint },
  { from: 'Paint on slab', to: INTERIOR_FINISH_NAME.glossPaint },
  { from: 'Stain + clear on shaker', to: INTERIOR_FINISH_NAME.stainClear },
  { from: 'Stain + clear on slab', to: INTERIOR_FINISH_NAME.clear },
]

const LEGACY_FINISH_NAMES = new Set(
  LEGACY_FINISH_RENAMES.map(({ from }) => from.toLowerCase()),
)

/** Cheap local test so a caller that already has the item list can skip the
 *  rename round-trip entirely — which is every load after the first. */
export function hasLegacyFinishName(name: string): boolean {
  return LEGACY_FINISH_NAMES.has(name.trim().toLowerCase())
}

/**
 * Rename any legacy door-style-named interior finishes in place, 1:1.
 *
 * Deliberately conservative — it only touches a row when BOTH hold:
 *   1. the row is uncalibrated (no breakdown row carries a non-zero rate), so
 *      real numbers can never be relabelled out from under a shop; and
 *   2. the target name is not already taken in this org, so it can't collide
 *      with a row that already went through (or was renamed by hand).
 * Anything failing either test is left exactly as it is.
 *
 * Idempotent and safe to call on every load — a no-op once done, and it
 * self-heals every org rather than needing a migration or manual pass.
 * Returns the number of rows actually renamed.
 */
export async function renameLegacyFinishCombos(orgId: string): Promise<number> {
  const { data, error } = await supabase
    .from('rate_book_items')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('application', 'interior')
    .eq('active', true)
  if (error) {
    // Not worth surfacing — the tab still works, the names just stay legacy.
    console.error('renameLegacyFinishCombos', error)
    return 0
  }

  const rows = (data || []) as Array<{ id: string; name: string }>
  if (rows.length === 0) return 0

  const byName = new Map(rows.map((r) => [r.name.trim().toLowerCase(), r]))
  const pending = LEGACY_FINISH_RENAMES.filter(({ from, to }) => {
    const row = byName.get(from.toLowerCase())
    return !!row && !byName.has(to.toLowerCase())
  })
  if (pending.length === 0) return 0

  // One lookup for calibration state across every candidate.
  const candidateIds = pending.map(({ from }) => byName.get(from.toLowerCase())!.id)
  const calibrated = await loadCalibratedFinishItemIds(candidateIds)

  let renamed = 0
  for (const { from, to } of pending) {
    const row = byName.get(from.toLowerCase())!
    if (calibrated.has(row.id)) continue
    const { error: updErr } = await supabase
      .from('rate_book_items')
      .update({ name: to, updated_at: new Date().toISOString() })
      .eq('id', row.id)
    if (updErr) {
      console.error('renameLegacyFinishCombos update', from, updErr)
      continue
    }
    // Keep the local index honest so a later pair can't claim this name.
    byName.set(to.toLowerCase(), row)
    byName.delete(from.toLowerCase())
    renamed++
  }
  return renamed
}

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
