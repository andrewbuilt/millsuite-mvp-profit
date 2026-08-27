// ============================================================================
// lib/materials.ts — the master materials catalog (rate-book overhaul, chunk B)
// ============================================================================
// ONE org-scoped price list behind the three legacy material pools (carcass,
// back panel, door face). Migration 072 created + backfilled the table and
// stamped a `material_id` pointer on every source row. This module is the
// catalog's read/write surface; the composer sources material PRICE from here
// (via the pointer) so editing one catalog row reprices everything that
// references it.
//
// CONSUMPTION (sheets/LF, sheets/door) is NOT here — it lives on the product
// (lib/products.ts). The catalog only holds price (cost_value + cost_unit).
// ============================================================================

import { supabase } from './supabase'

export type MaterialCostUnit = 'sheet' | 'lf' | 'bf' | 'ea' | 'lump'

export interface Material {
  id: string
  org_id: string
  name: string
  /** One price per material. Interpreted against cost_unit. */
  cost_value: number
  cost_unit: MaterialCostUnit
  notes: string | null
  // Organization only (migration 090) — nothing prices off these. Free text,
  // no fixed vocabulary: the catalog groups rows by `category` and filters by
  // `thickness`, and the editor seeds its datalists from the values already in
  // the org. Null = "Uncategorized" / unfiltered.
  category: string | null
  thickness: string | null
  // Per-use "quick grab" visibility flags for the slot dropdowns. A material
  // can show in several slots; "browse all" ignores these.
  show_in_carcass: boolean
  show_in_door: boolean
  show_in_back_panel: boolean
  show_in_shelf: boolean
  // Solid-wood provenance: price derived from a wood component × board feet.
  solid_wood_component_id: string | null
  bdft_per_unit: number | null
  active: boolean
}

const BASE_COLUMNS =
  'id, org_id, name, cost_value, cost_unit, notes, show_in_carcass, show_in_door, show_in_back_panel, show_in_shelf, solid_wood_component_id, bdft_per_unit, active'
const EXTENDED_COLUMNS = `${BASE_COLUMNS}, category, thickness`

// Migration 090 added category + thickness. On an environment where it hasn't
// run yet, naming them in a select errors out and would blank the entire
// catalog — so the first "column does not exist" flips this off and every
// later read/write drops the pair. Flips back on nothing: a page reload after
// the migration starts a fresh module.
let hasOrganizationFields = true

const MATERIAL_COLUMNS = () => (hasOrganizationFields ? EXTENDED_COLUMNS : BASE_COLUMNS)

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || /column .* does not exist/i.test(error.message || '')
}

function normalizeMaterial(r: any): Material {
  return {
    id: r.id,
    org_id: r.org_id,
    name: r.name,
    cost_value: Number(r.cost_value) || 0,
    cost_unit: (r.cost_unit as MaterialCostUnit) || 'sheet',
    notes: r.notes ?? null,
    category: r.category ?? null,
    thickness: r.thickness ?? null,
    show_in_carcass: !!r.show_in_carcass,
    show_in_door: !!r.show_in_door,
    show_in_back_panel: !!r.show_in_back_panel,
    show_in_shelf: !!r.show_in_shelf,
    solid_wood_component_id: r.solid_wood_component_id ?? null,
    bdft_per_unit:
      r.bdft_per_unit === null || r.bdft_per_unit === undefined
        ? null
        : Number(r.bdft_per_unit),
    active: r.active === undefined ? true : !!r.active,
  }
}

// ── Reads ──

export async function listMaterials(orgId: string): Promise<Material[]> {
  const read = (columns: string) =>
    supabase
      .from('materials')
      .select(columns)
      .eq('org_id', orgId)
      .eq('active', true)
      .order('name')

  let { data, error } = await read(MATERIAL_COLUMNS())
  if (error && isMissingColumn(error)) {
    // 090 hasn't run here. Fall back for good so the catalog still loads.
    hasOrganizationFields = false
    ;({ data, error } = await read(BASE_COLUMNS))
  }
  if (error) {
    console.error('listMaterials', error)
    return []
  }
  return (data || []).map(normalizeMaterial)
}

/** Index a catalog list by id for O(1) price lookup from a source row's
 *  material_id. */
export function indexMaterialsById(materials: Material[]): Map<string, Material> {
  const m = new Map<string, Material>()
  for (const mat of materials) m.set(mat.id, mat)
  return m
}

// ── Writes ──

/** Create one catalog row. Returns the created Material (throws on error). */
export async function createMaterial(input: {
  org_id: string
  name: string
  cost_value: number
  cost_unit?: MaterialCostUnit
  notes?: string | null
  category?: string | null
  thickness?: string | null
  show_in_carcass?: boolean
  show_in_door?: boolean
  show_in_back_panel?: boolean
  show_in_shelf?: boolean
  solid_wood_component_id?: string | null
  bdft_per_unit?: number | null
}): Promise<Material> {
  const write = () => {
    const row: Record<string, unknown> = {
      org_id: input.org_id,
      name: input.name,
      cost_value: input.cost_value,
      cost_unit: input.cost_unit ?? 'sheet',
      notes: input.notes ?? null,
      show_in_carcass: input.show_in_carcass ?? false,
      show_in_door: input.show_in_door ?? false,
      show_in_back_panel: input.show_in_back_panel ?? false,
      show_in_shelf: input.show_in_shelf ?? false,
      solid_wood_component_id: input.solid_wood_component_id ?? null,
      bdft_per_unit: input.bdft_per_unit ?? null,
    }
    if (hasOrganizationFields) {
      row.category = input.category ?? null
      row.thickness = input.thickness ?? null
    }
    return supabase.from('materials').insert(row).select(MATERIAL_COLUMNS()).single()
  }

  let { data, error } = await write()
  if (error && isMissingColumn(error)) {
    hasOrganizationFields = false
    ;({ data, error } = await write())
  }
  if (error || !data) {
    console.error('createMaterial', error)
    throw new Error(error?.message || 'Failed to create material')
  }
  return normalizeMaterial(data)
}

/** Patch a catalog row (price, name, unit, solid-wood link). Used by every
 *  material edit path so the catalog stays the single source of truth. */
export async function updateMaterial(
  materialId: string,
  patch: Partial<
    Pick<
      Material,
      | 'name'
      | 'cost_value'
      | 'cost_unit'
      | 'notes'
      | 'category'
      | 'thickness'
      | 'show_in_carcass'
      | 'show_in_door'
      | 'show_in_back_panel'
      | 'show_in_shelf'
      | 'solid_wood_component_id'
      | 'bdft_per_unit'
    >
  >,
): Promise<void> {
  const build = () => {
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    const keys = [
      'name',
      'cost_value',
      'cost_unit',
      'notes',
      'show_in_carcass',
      'show_in_door',
      'show_in_back_panel',
      'show_in_shelf',
      'solid_wood_component_id',
      'bdft_per_unit',
      ...(hasOrganizationFields ? (['category', 'thickness'] as const) : []),
    ] as const
    for (const k of keys) {
      if (patch[k] !== undefined) update[k] = patch[k]
    }
    return supabase.from('materials').update(update).eq('id', materialId)
  }

  let { error } = await build()
  if (error && isMissingColumn(error)) {
    hasOrganizationFields = false
    ;({ error } = await build())
  }
  if (error) {
    console.error('updateMaterial', error)
    throw new Error(error.message || 'Failed to update material')
  }
}

export async function archiveMaterial(materialId: string): Promise<void> {
  const { error } = await supabase
    .from('materials')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', materialId)
  if (error) {
    console.error('archiveMaterial', error)
    throw new Error(error.message || 'Failed to archive material')
  }
}
