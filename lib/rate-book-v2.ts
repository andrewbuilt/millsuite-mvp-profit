// ============================================================================
// lib/rate-book-v2.ts
// ============================================================================
// CRUD + query layer for the Phase 1 rate book (BUILD-ORDER Phase 1).
//
// Shape that the UI consumes:
//   - RateBookCategoryRow     (rate_book_categories)
//   - RateBookItemRow         (rate_book_items, extended in migration 006)
//   - RateBookOptionRow       (rate_book_options)
//   - RateBookItemHistoryRow  (rate_book_item_history)
//
// The old lib/rate-book.ts covers the legacy labor_rates + material_pricing
// tables — kept for estimate_lines backward-compat through Phase 2. Everything
// the new /rate-book page touches goes through THIS file.
// ============================================================================

import { supabase } from './supabase'
import type { LaborDept } from './rate-book-seed'
import { LABOR_DEPTS } from './rate-book-seed'

// ── Row types (mirror the DB shape) ──

export type Unit = 'lf' | 'each' | 'sf' | 'day' | 'hr' | 'job'
export type MaterialMode = 'sheets' | 'linear' | 'lump' | 'none'
export type Confidence = 'untested' | 'few_jobs' | 'well_tested' | 'looking_weird'

export interface RateBookCategoryRow {
  id: string
  org_id: string | null
  parent_id: string | null
  name: string
  item_type: string
  display_order: number
  notes: string | null
  confidence_job_count: number
  confidence_last_used_at: string | null
  active: boolean
  created_at: string
}

export interface RateBookItemRow {
  id: string
  org_id: string | null
  category_id: string | null
  name: string
  description: string | null
  unit: Unit
  material_mode: MaterialMode
  // Per-dept base hours (stored flat, not jsonb).
  base_labor_hours_eng: number
  base_labor_hours_cnc: number
  base_labor_hours_assembly: number
  base_labor_hours_finish: number
  base_labor_hours_install: number
  // Physical inputs.
  sheets_per_unit: number
  sheet_cost: number
  linear_cost: number
  lump_cost: number
  hardware_cost: number
  material_description: string | null
  hardware_note: string | null
  // Metadata.
  confidence: Confidence
  confidence_job_count: number
  confidence_last_used_at: string | null
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export type OptionScope = 'shop_wide' | `category:${string}` | `item:${string}`
export type OptionEffectType =
  | 'hours_multiplier'
  | 'rate_multiplier'
  | 'material_multiplier'
  | 'flat_add'
  | 'per_unit_add'
  | 'flag'

export interface RateBookOptionRow {
  id: string
  org_id: string
  key: string
  name: string
  scope: OptionScope
  effect_type: OptionEffectType
  effect_value: number
  effect_target: string | null
  notes: string | null
  active: boolean
  created_at: string
}

export interface RateBookItemOptionRow {
  rate_book_item_id: string
  rate_book_option_id: string
  is_default: boolean
}

export interface RateBookItemHistoryRow {
  id: string
  rate_book_item_id: string
  changed_at: string
  changed_by: string | null
  field_changes: Record<string, { from: any; to: any }>
  reason: string | null
  apply_scope: 'this' | 'category' | 'shop_wide'
}

// ── Categories ──

export async function listCategories(orgId: string): Promise<RateBookCategoryRow[]> {
  const { data, error } = await supabase
    .from('rate_book_categories')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []) as RateBookCategoryRow[]
}

export async function createCategoryRow(orgId: string, name: string, item_type = 'custom') {
  const { data, error } = await supabase
    .from('rate_book_categories')
    .insert({ org_id: orgId, name, item_type, active: true })
    .select()
    .single()
  if (error) throw error
  return data as RateBookCategoryRow
}

// ── Items ──

export async function listItems(orgId: string): Promise<RateBookItemRow[]> {
  const { data, error } = await supabase
    .from('rate_book_items')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []) as RateBookItemRow[]
}

export async function countItems(orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from('rate_book_items')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (error) throw error
  return count ?? 0
}

export async function getItem(itemId: string) {
  const { data, error } = await supabase
    .from('rate_book_items')
    .select('*')
    .eq('id', itemId)
    .single()
  if (error) throw error
  return data as RateBookItemRow
}

export async function createItem(orgId: string, row: Partial<RateBookItemRow>) {
  const { data, error } = await supabase
    .from('rate_book_items')
    .insert({
      org_id: orgId,
      name: row.name,
      description: row.description ?? null,
      category_id: row.category_id ?? null,
      unit: row.unit ?? 'lf',
      material_mode: row.material_mode ?? 'sheets',
      base_labor_hours_eng: row.base_labor_hours_eng ?? 0,
      base_labor_hours_cnc: row.base_labor_hours_cnc ?? 0,
      base_labor_hours_assembly: row.base_labor_hours_assembly ?? 0,
      base_labor_hours_finish: row.base_labor_hours_finish ?? 0,
      base_labor_hours_install: row.base_labor_hours_install ?? 0,
      sheets_per_unit: row.sheets_per_unit ?? 0,
      sheet_cost: row.sheet_cost ?? 0,
      linear_cost: row.linear_cost ?? 0,
      lump_cost: row.lump_cost ?? 0,
      hardware_cost: row.hardware_cost ?? 0,
      material_description: row.material_description ?? null,
      hardware_note: row.hardware_note ?? null,
      confidence: row.confidence ?? 'untested',
      active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as RateBookItemRow
}

// updateItem writes both the update AND a history row. scope controls
// propagation: `this` → just this row. `category` → every item in the same
// category gets the same field deltas applied. `shop_wide` → every item in the
// org gets them. A history row is written for each touched item with the same
// reason + apply_scope so the audit is consistent.
export async function updateItem(
  itemId: string,
  updates: Partial<RateBookItemRow>,
  opts: {
    reason?: string
    scope?: 'this' | 'category' | 'shop_wide'
    changedBy?: string | null
  } = {}
) {
  const scope = opts.scope ?? 'this'
  const changedBy = opts.changedBy ?? null

  // Pull the current row so we can diff.
  const { data: before, error: beforeErr } = await supabase
    .from('rate_book_items')
    .select('*')
    .eq('id', itemId)
    .single()
  if (beforeErr) throw beforeErr

  // Figure out which ids we're touching.
  let ids: string[] = [itemId]
  if (scope === 'category' && before.category_id) {
    const { data: sameCat } = await supabase
      .from('rate_book_items')
      .select('id')
      .eq('org_id', before.org_id)
      .eq('category_id', before.category_id)
      .eq('active', true)
    ids = (sameCat || []).map((r: any) => r.id)
  } else if (scope === 'shop_wide') {
    const { data: all } = await supabase
      .from('rate_book_items')
      .select('id')
      .eq('org_id', before.org_id)
      .eq('active', true)
    ids = (all || []).map((r: any) => r.id)
  }

  // Build the update payload (strip fields we don't want to blanket-apply).
  const payload: Record<string, any> = { updated_at: new Date().toISOString() }
  for (const [k, v] of Object.entries(updates)) {
    if (['id', 'org_id', 'created_at', 'updated_at'].includes(k)) continue
    payload[k] = v
  }

  // Apply the update.
  const { error: updErr } = await supabase
    .from('rate_book_items')
    .update(payload)
    .in('id', ids)
  if (updErr) throw updErr

  // Compute field changes (only fields that actually differ from `before`).
  const field_changes: Record<string, { from: any; to: any }> = {}
  for (const [k, v] of Object.entries(updates)) {
    if (['id', 'org_id', 'created_at', 'updated_at'].includes(k)) continue
    if ((before as any)[k] !== v) {
      field_changes[k] = { from: (before as any)[k], to: v }
    }
  }

  if (Object.keys(field_changes).length > 0) {
    const historyRows = ids.map((rid) => ({
      rate_book_item_id: rid,
      changed_by: changedBy,
      field_changes,
      reason: opts.reason ?? null,
      apply_scope: scope,
    }))
    await supabase.from('rate_book_item_history').insert(historyRows)
  }

  // Return the freshly-updated primary row.
  return getItem(itemId)
}

export async function archiveItem(itemId: string) {
  await supabase.from('rate_book_items').update({ active: false }).eq('id', itemId)
}

// Shop labor rates table dropped in migration 023 — labor $ now uses a
// single orgs.shop_rate (Phase 12 item 12). Per-dept hours remain on
// estimate_lines for scheduling / time tracking.

// ── Options ──

export async function listOptions(orgId: string): Promise<RateBookOptionRow[]> {
  const { data, error } = await supabase
    .from('rate_book_options')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw error
  return (data || []) as RateBookOptionRow[]
}

export async function createOption(orgId: string, row: Partial<RateBookOptionRow>) {
  const { data, error } = await supabase
    .from('rate_book_options')
    .insert({
      org_id: orgId,
      key: row.key,
      name: row.name,
      scope: row.scope ?? 'shop_wide',
      effect_type: row.effect_type ?? 'flag',
      effect_value: row.effect_value ?? 0,
      effect_target: row.effect_target ?? null,
      notes: row.notes ?? null,
      active: true,
    })
    .select()
    .single()
  if (error) throw error
  return data as RateBookOptionRow
}

export async function listItemOptions(itemId: string): Promise<RateBookItemOptionRow[]> {
  const { data, error } = await supabase
    .from('rate_book_item_options')
    .select('*')
    .eq('rate_book_item_id', itemId)
  if (error) throw error
  return (data || []) as RateBookItemOptionRow[]
}

export async function attachOption(itemId: string, optionId: string, isDefault = false) {
  const { error } = await supabase
    .from('rate_book_item_options')
    .upsert(
      { rate_book_item_id: itemId, rate_book_option_id: optionId, is_default: isDefault },
      { onConflict: 'rate_book_item_id,rate_book_option_id' }
    )
  if (error) throw error
}

export async function detachOption(itemId: string, optionId: string) {
  const { error } = await supabase
    .from('rate_book_item_options')
    .delete()
    .eq('rate_book_item_id', itemId)
    .eq('rate_book_option_id', optionId)
  if (error) throw error
}

// ── History ──

export async function listItemHistory(itemId: string): Promise<RateBookItemHistoryRow[]> {
  const { data, error } = await supabase
    .from('rate_book_item_history')
    .select('*')
    .eq('rate_book_item_id', itemId)
    .order('changed_at', { ascending: false })
  if (error) throw error
  return (data || []) as RateBookItemHistoryRow[]
}

// ── Derived math (mirror of the mockup's buildup) ──

export interface ItemPriceBreakdown {
  laborHours: number
  laborCost: number
  materialCost: number
  consumables: number   // 10% of material
  hardware: number
  total: number
  perDept: Array<{ dept: LaborDept; hours: number; rate: number; cost: number }>
}

export function computeBuildup(
  item: RateBookItemRow,
  shopRate: number,
  consumablePct = 0.1
): ItemPriceBreakdown {
  const rate = Number(shopRate) || 0
  const perDept: ItemPriceBreakdown['perDept'] = LABOR_DEPTS.map((d) => {
    const hours =
      d === 'eng' ? item.base_labor_hours_eng :
      d === 'cnc' ? item.base_labor_hours_cnc :
      d === 'assembly' ? item.base_labor_hours_assembly :
      d === 'finish' ? item.base_labor_hours_finish :
      item.base_labor_hours_install
    return { dept: d, hours: Number(hours) || 0, rate, cost: (Number(hours) || 0) * rate }
  })
  const laborHours = perDept.reduce((s, x) => s + x.hours, 0)
  const laborCost = perDept.reduce((s, x) => s + x.cost, 0)

  let materialCost = 0
  if (item.material_mode === 'sheets') {
    materialCost = Number(item.sheets_per_unit || 0) * Number(item.sheet_cost || 0)
  } else if (item.material_mode === 'linear') {
    materialCost = Number(item.linear_cost || 0)
  } else if (item.material_mode === 'lump') {
    materialCost = Number(item.lump_cost || 0)
  }

  const consumables = materialCost * consumablePct
  const hardware = Number(item.hardware_cost || 0)
  const total = laborCost + materialCost + consumables + hardware

  return { laborHours, laborCost, materialCost, consumables, hardware, total, perDept }
}

// ── Confidence badge helpers ──

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  untested: 'new / untested',
  few_jobs: 'few jobs',
  well_tested: 'well-tested',
  looking_weird: 'looking weird',
}

export const CONFIDENCE_COLOR: Record<Confidence, { bg: string; fg: string; border: string }> = {
  untested:      { bg: '#F3F4F6', fg: '#6B7280', border: '#E5E7EB' },
  few_jobs:      { bg: '#FEF9C3', fg: '#A16207', border: '#FDE68A' },
  well_tested:   { bg: '#DCFCE7', fg: '#15803D', border: '#BBF7D0' },
  looking_weird: { bg: '#FEE2E2', fg: '#B91C1C', border: '#FECACA' },
}
