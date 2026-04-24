// lib/rate-book.ts
// Rate book CRUD and lookups. Categories are first-class containers;
// labor_rates and material_pricing rows optionally belong to a category.
// Pro tier only (feature-flagged at the route level).

import { supabase } from '@/lib/supabase'
import type {
  RateBookCategory,
  RateBookItemType,
  LaborRate,
  MaterialPricing,
} from '@/lib/types'

// ===========================
// Categories
// ===========================

export async function getCategories(orgId: string, itemType?: RateBookItemType) {
  let q = supabase
    .from('rate_book_categories')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (itemType) q = q.eq('item_type', itemType)

  const { data, error } = await q
  if (error) throw error
  return (data || []) as RateBookCategory[]
}

export async function createCategory(cat: Partial<RateBookCategory>) {
  const { data, error } = await supabase
    .from('rate_book_categories')
    .insert(cat)
    .select()
    .single()
  if (error) throw error
  return data as RateBookCategory
}

export async function updateCategory(id: string, updates: Partial<RateBookCategory>) {
  const { data, error } = await supabase
    .from('rate_book_categories')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as RateBookCategory
}

export async function archiveCategory(id: string) {
  return updateCategory(id, { active: false })
}

// ===========================
// Labor rates
// ===========================

export async function getLaborRates(orgId: string, categoryId?: string | null) {
  let q = supabase
    .from('labor_rates')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name', { ascending: true })

  if (categoryId !== undefined) {
    q = categoryId === null ? q.is('category_id', null) : q.eq('category_id', categoryId)
  }

  const { data, error } = await q
  if (error) throw error
  return (data || []) as LaborRate[]
}

export async function createLaborRate(rate: Partial<LaborRate>) {
  const { data, error } = await supabase
    .from('labor_rates')
    .insert(rate)
    .select()
    .single()
  if (error) throw error
  return data as LaborRate
}

export async function updateLaborRate(id: string, updates: Partial<LaborRate>) {
  const { data, error } = await supabase
    .from('labor_rates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as LaborRate
}

export async function archiveLaborRate(id: string) {
  return updateLaborRate(id, { active: false })
}

// ===========================
// Material pricing
// ===========================

export async function getMaterialPricing(orgId: string, categoryId?: string | null) {
  let q = supabase
    .from('material_pricing')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name', { ascending: true })

  if (categoryId !== undefined) {
    q = categoryId === null ? q.is('category_id', null) : q.eq('category_id', categoryId)
  }

  const { data, error } = await q
  if (error) throw error
  return (data || []) as MaterialPricing[]
}

export async function createMaterialPricing(row: Partial<MaterialPricing>) {
  const { data, error } = await supabase
    .from('material_pricing')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data as MaterialPricing
}

export async function updateMaterialPricing(id: string, updates: Partial<MaterialPricing>) {
  const { data, error } = await supabase
    .from('material_pricing')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as MaterialPricing
}

export async function archiveMaterialPricing(id: string) {
  return updateMaterialPricing(id, { active: false })
}

// ===========================
// Confidence tracking
// ===========================
// Bump confidence_job_count + confidence_last_used_at whenever a rate or
// category is used on a real job. Called from the subproject editor when a
// spec line references a rate book entry.

export async function bumpRateConfidence(rateId: string) {
  // Postgres-native increment would be nicer, but a read-modify-write is fine here.
  const { data } = await supabase
    .from('labor_rates')
    .select('confidence_job_count')
    .eq('id', rateId)
    .single()

  await supabase
    .from('labor_rates')
    .update({
      confidence_job_count: (data?.confidence_job_count || 0) + 1,
      confidence_last_used_at: new Date().toISOString(),
    })
    .eq('id', rateId)
}

export async function bumpCategoryConfidence(categoryId: string) {
  const { data } = await supabase
    .from('rate_book_categories')
    .select('confidence_job_count')
    .eq('id', categoryId)
    .single()

  await supabase
    .from('rate_book_categories')
    .update({
      confidence_job_count: (data?.confidence_job_count || 0) + 1,
      confidence_last_used_at: new Date().toISOString(),
    })
    .eq('id', categoryId)
}

// ===========================
// Confidence label helper
// ===========================
// Surfaces a human label ("New" / "Emerging" / "Reliable" / "Stale") based on
// job count and recency. Used by the rate book UI for the confidence badge.

export function confidenceLabel(
  jobCount: number,
  lastUsedAt: string | null
): 'new' | 'emerging' | 'reliable' | 'stale' {
  if (jobCount === 0) return 'new'

  const last = lastUsedAt ? new Date(lastUsedAt).getTime() : 0
  const daysSince = last ? (Date.now() - last) / (1000 * 60 * 60 * 24) : Infinity

  if (daysSince > 180) return 'stale'
  if (jobCount >= 5) return 'reliable'
  return 'emerging'
}

// ===========================
// Calibration-target find-or-create helpers
// ===========================
// Both BaseCabinetWalkthrough and DoorStyleWalkthrough write into a
// rate_book_items row scoped under a rate_book_categories row of the
// right item_type. These helpers converge the find-or-create logic so
// the two walkthroughs don't drift.

/**
 * Preferred-name matching: first try the category with the given name;
 * fall back to the first active category of the right item_type;
 * otherwise create one with the preferred name. Returns the category id.
 */
export async function ensureRateBookCategoryId(
  orgId: string,
  preferredName: string,
  itemType: string,
): Promise<string> {
  const { data: cats } = await supabase
    .from('rate_book_categories')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('item_type', itemType)
    .eq('active', true)
  const rows = (cats || []) as Array<{ id: string; name: string }>
  const named = rows.find(
    (c) => c.name?.toLowerCase() === preferredName.toLowerCase()
  )
  if (named) return named.id
  if (rows.length > 0) return rows[0].id
  const { data: created, error } = await supabase
    .from('rate_book_categories')
    .insert({
      org_id: orgId,
      name: preferredName,
      item_type: itemType,
      active: true,
      display_order: 0,
    })
    .select('id')
    .single()
  if (error) throw error
  return (created as { id: string }).id
}

/**
 * Find-or-update a rate_book_items row by case-insensitive name match
 * inside a category. Existing row → apply `patch`. Missing row → insert
 * with `insertDefaults` merged with `patch`. Returns the item id.
 */
export async function upsertRateBookItem(args: {
  orgId: string
  categoryId: string
  name: string
  patch: Record<string, unknown>
  insertDefaults: Record<string, unknown>
}): Promise<string> {
  const { orgId, categoryId, name, patch, insertDefaults } = args
  const { data: existing } = await supabase
    .from('rate_book_items')
    .select('id')
    .eq('org_id', orgId)
    .eq('category_id', categoryId)
    .ilike('name', name)
    .limit(1)
  const row = (existing || [])[0] as { id: string } | undefined
  if (row) {
    const { error } = await supabase
      .from('rate_book_items')
      .update(patch)
      .eq('id', row.id)
    if (error) throw error
    return row.id
  }
  const { data: created, error } = await supabase
    .from('rate_book_items')
    .insert({
      org_id: orgId,
      category_id: categoryId,
      name,
      ...insertDefaults,
      ...patch,
    })
    .select('id')
    .single()
  if (error) throw error
  return (created as { id: string }).id
}
