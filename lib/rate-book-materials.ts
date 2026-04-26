// ============================================================================
// lib/rate-book-materials.ts — CRUD for the composer's material templates.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 6 + migration 020. Two tables, same
// shape minus sheets_per_lf on ext (face sheets/LF comes from the
// product, not the template).
// ============================================================================

import { supabase } from './supabase'

export interface RateBookCarcassMaterial {
  id: string
  org_id: string
  name: string
  sheet_cost: number
  sheets_per_lf: number
  active: boolean
}

export interface RateBookExtMaterial {
  id: string
  org_id: string
  name: string
  sheet_cost: number
  active: boolean
}

/** Back-panel material — a rate_book_items row whose category has
 *  item_type='back_panel_material'. Same flat shape as ext: just
 *  name + sheet_cost. The category is auto-created on first add. */
export interface RateBookBackPanelMaterial {
  id: string
  org_id: string
  name: string
  sheet_cost: number
  active: boolean
}

// ── Reads ──

export async function listCarcassMaterials(orgId: string): Promise<RateBookCarcassMaterial[]> {
  const { data, error } = await supabase
    .from('rate_book_carcass_materials')
    .select('id, org_id, name, sheet_cost, sheets_per_lf, active')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('listCarcassMaterials', error)
    return []
  }
  return (data || []) as RateBookCarcassMaterial[]
}

export async function listExtMaterials(orgId: string): Promise<RateBookExtMaterial[]> {
  const { data, error } = await supabase
    .from('rate_book_ext_materials')
    .select('id, org_id, name, sheet_cost, active')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('listExtMaterials', error)
    return []
  }
  return (data || []) as RateBookExtMaterial[]
}

// ── Writes ──

export async function createCarcassMaterial(input: {
  org_id: string
  name: string
  sheet_cost: number
  sheets_per_lf: number
}): Promise<RateBookCarcassMaterial | null> {
  const { data, error } = await supabase
    .from('rate_book_carcass_materials')
    .insert({
      org_id: input.org_id,
      name: input.name,
      sheet_cost: input.sheet_cost,
      sheets_per_lf: input.sheets_per_lf,
      active: true,
    })
    .select()
    .single()
  if (error) {
    console.error('createCarcassMaterial', error)
    throw new Error(error.message || 'Failed to save carcass material')
  }
  return data as RateBookCarcassMaterial
}

export async function createExtMaterial(input: {
  org_id: string
  name: string
  sheet_cost: number
}): Promise<RateBookExtMaterial | null> {
  const { data, error } = await supabase
    .from('rate_book_ext_materials')
    .insert({
      org_id: input.org_id,
      name: input.name,
      sheet_cost: input.sheet_cost,
      active: true,
    })
    .select()
    .single()
  if (error) {
    console.error('createExtMaterial', error)
    throw new Error(error.message || 'Failed to save ext material')
  }
  return data as RateBookExtMaterial
}

// ── Back-panel materials (rate_book_items under a back_panel_material category) ──

const BACK_PANEL_CATEGORY_NAME = 'Back panel materials'

/** Find or create the back-panel-material category for an org. Idempotent —
 *  a single row per org is reused for every back-panel item. */
async function ensureBackPanelCategory(orgId: string): Promise<string | null> {
  const { data: existing } = await supabase
    .from('rate_book_categories')
    .select('id')
    .eq('org_id', orgId)
    .eq('item_type', 'back_panel_material')
    .eq('active', true)
    .limit(1)
    .maybeSingle()
  if (existing?.id) return existing.id
  const { data: created, error } = await supabase
    .from('rate_book_categories')
    .insert({
      org_id: orgId,
      name: BACK_PANEL_CATEGORY_NAME,
      item_type: 'back_panel_material',
      active: true,
    })
    .select('id')
    .single()
  if (error) {
    console.error('ensureBackPanelCategory', error)
    return null
  }
  return created?.id ?? null
}

export async function listBackPanelMaterials(
  orgId: string,
): Promise<RateBookBackPanelMaterial[]> {
  // Two-step: find the back-panel category id, then list its items. Avoids
  // a join + keeps the query shape identical to listExtMaterials.
  const { data: cats } = await supabase
    .from('rate_book_categories')
    .select('id')
    .eq('org_id', orgId)
    .eq('item_type', 'back_panel_material')
    .eq('active', true)
  const catIds = ((cats || []) as Array<{ id: string }>).map((c) => c.id)
  if (catIds.length === 0) return []
  const { data, error } = await supabase
    .from('rate_book_items')
    .select('id, org_id, name, sheet_cost, active')
    .in('category_id', catIds)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('listBackPanelMaterials', error)
    return []
  }
  return ((data || []) as Array<{
    id: string
    org_id: string
    name: string
    sheet_cost: number | string
    active: boolean
  }>).map((r) => ({
    id: r.id,
    org_id: r.org_id,
    name: r.name,
    sheet_cost: Number(r.sheet_cost) || 0,
    active: r.active,
  }))
}

export async function createBackPanelMaterial(input: {
  org_id: string
  name: string
  sheet_cost: number
}): Promise<RateBookBackPanelMaterial | null> {
  const categoryId = await ensureBackPanelCategory(input.org_id)
  if (!categoryId) {
    throw new Error('Failed to find or create back-panel-material category')
  }
  const { data, error } = await supabase
    .from('rate_book_items')
    .insert({
      org_id: input.org_id,
      category_id: categoryId,
      name: input.name,
      sheet_cost: input.sheet_cost,
      unit: 'lf',
      active: true,
    })
    .select('id, org_id, name, sheet_cost, active')
    .single()
  if (error) {
    console.error('createBackPanelMaterial', error)
    throw new Error(error.message || 'Failed to save back panel material')
  }
  if (!data) return null
  return {
    id: data.id,
    org_id: data.org_id,
    name: data.name,
    sheet_cost: Number(data.sheet_cost) || 0,
    active: data.active,
  }
}
