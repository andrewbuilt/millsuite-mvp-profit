// ============================================================================
// lib/solid-wood.ts — CRUD + cost helpers for solid-wood components
// ============================================================================
// Solid-wood stock is priced per BDFT with a waste-% multiplier. The cost
// helper is exported so a future PR can compute door-material cost when an
// operator picks a solid-wood component as the door face stock:
//
//   doorMaterial = bdftRequiredPerDoor × cost_per_bdft × (1 + waste_pct/100)
//
// PR scope: the table + walkthrough + rate-book entry. Wiring into the
// composer's door material slot lands in chunk-e-solid-wood-2.
// ============================================================================

import { supabase } from './supabase'

export interface SolidWoodComponent {
  id: string
  org_id: string
  name: string
  species: string
  thickness_quarters: number
  cost_per_bdft: number
  waste_pct: number
  notes: string | null
  active: boolean
}

const COLUMNS =
  'id, org_id, name, species, thickness_quarters, cost_per_bdft, waste_pct, notes, active'

function normalize(row: any): SolidWoodComponent {
  return {
    id: row.id,
    org_id: row.org_id,
    name: row.name,
    species: row.species,
    thickness_quarters: Number(row.thickness_quarters) || 0,
    cost_per_bdft: Number(row.cost_per_bdft) || 0,
    waste_pct: Number(row.waste_pct) || 0,
    notes: row.notes ?? null,
    active: !!row.active,
  }
}

export async function loadSolidWoodComponents(
  orgId: string,
): Promise<SolidWoodComponent[]> {
  const { data, error } = await supabase
    .from('solid_wood_components')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('loadSolidWoodComponents', error)
    return []
  }
  return (data || []).map(normalize)
}

export async function getSolidWoodComponent(
  id: string,
): Promise<SolidWoodComponent | null> {
  const { data, error } = await supabase
    .from('solid_wood_components')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error('getSolidWoodComponent', error)
    return null
  }
  return data ? normalize(data) : null
}

export async function createSolidWoodComponent(args: {
  orgId: string
  name: string
  species: string
  thickness_quarters: number
  cost_per_bdft: number
  waste_pct: number
  notes?: string | null
}): Promise<SolidWoodComponent> {
  const { data, error } = await supabase
    .from('solid_wood_components')
    .insert({
      org_id: args.orgId,
      name: args.name,
      species: args.species,
      thickness_quarters: args.thickness_quarters,
      cost_per_bdft: args.cost_per_bdft,
      waste_pct: args.waste_pct,
      notes: args.notes ?? null,
      active: true,
    })
    .select(COLUMNS)
    .single()
  if (error || !data) {
    console.error('createSolidWoodComponent', error)
    throw new Error(error?.message || 'Failed to save solid wood component')
  }
  return normalize(data)
}

export async function updateSolidWoodComponent(
  id: string,
  patch: Partial<
    Pick<
      SolidWoodComponent,
      'name' | 'species' | 'thickness_quarters' | 'cost_per_bdft' | 'waste_pct' | 'notes'
    >
  >,
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) update.name = patch.name
  if (patch.species !== undefined) update.species = patch.species
  if (patch.thickness_quarters !== undefined)
    update.thickness_quarters = patch.thickness_quarters
  if (patch.cost_per_bdft !== undefined) update.cost_per_bdft = patch.cost_per_bdft
  if (patch.waste_pct !== undefined) update.waste_pct = patch.waste_pct
  if (patch.notes !== undefined) update.notes = patch.notes
  const { error } = await supabase
    .from('solid_wood_components')
    .update(update)
    .eq('id', id)
  if (error) {
    console.error('updateSolidWoodComponent', error)
    throw new Error(error.message || 'Failed to update solid wood component')
  }
}

export async function deleteSolidWoodComponent(id: string): Promise<void> {
  const { error } = await supabase
    .from('solid_wood_components')
    .delete()
    .eq('id', id)
  if (error) {
    console.error('deleteSolidWoodComponent', error)
    throw new Error(error.message || 'Failed to delete solid wood component')
  }
}

// ── Pure helpers ──

/** Per-door / per-line cost for a solid-wood component.
 *  cost = bdft × $/bdft × (1 + waste_pct/100). */
export function computeSolidWoodCost(
  component: Pick<SolidWoodComponent, 'cost_per_bdft' | 'waste_pct'>,
  bdftRequired: number,
): number {
  const bdft = Number(bdftRequired) || 0
  if (bdft <= 0) return 0
  const waste = component.waste_pct || 0
  return bdft * (component.cost_per_bdft || 0) * (1 + waste / 100)
}

/** "8/4", "4/4" — quarters as a sawmill fraction. */
export function formatThickness(quarters: number): string {
  const q = Math.max(1, Math.round(quarters))
  return `${q}/4`
}

/** Approximate inches for a tooltip / detail row. 4/4 → 1.0 in, 8/4 → 2.0 in. */
export function quartersToInches(quarters: number): number {
  return (Math.max(0, quarters) / 4)
}
