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
