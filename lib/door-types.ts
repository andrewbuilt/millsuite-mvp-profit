// ============================================================================
// lib/door-types.ts — CRUD + types for the door-pricing-v2 model.
// ============================================================================
// Three tables (migration 038):
//   door_types                       (1)  ─┐
//                                          │  1:N
//   door_type_materials              (N)  ─┤
//                                          │  1:N
//   door_type_material_finishes      (N)  ─┘
//
// The composer reads all three on rate-book load and keys them into Maps
// for cascading dropdowns. Walkthrough writes door_types; "+ Add material"
// and "+ Add finish" inline affordances write the lower two.
// ============================================================================

import { supabase } from './supabase'

export type DoorMaterialCostUnit = 'sheet' | 'lf' | 'bf' | 'ea' | 'lump'

export interface DoorType {
  id: string
  org_id: string
  name: string
  labor_hours_eng: number
  labor_hours_cnc: number
  labor_hours_assembly: number
  labor_hours_finish: number
  hardware_cost: number
  calibrated: boolean
  active: boolean
}

export interface DoorTypeMaterial {
  id: string
  org_id: string
  door_type_id: string
  material_name: string
  cost_value: number
  cost_unit: DoorMaterialCostUnit
  notes: string | null
  active: boolean
}

export interface DoorTypeMaterialFinish {
  id: string
  org_id: string
  door_type_material_id: string
  finish_name: string
  labor_hours_per_door: number
  material_per_door: number
  active: boolean
}

// ── Reads ──

export async function listDoorTypes(orgId: string): Promise<DoorType[]> {
  const { data, error } = await supabase
    .from('door_types')
    .select('id, org_id, name, labor_hours_eng, labor_hours_cnc, labor_hours_assembly, labor_hours_finish, hardware_cost, calibrated, active')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('listDoorTypes', error)
    return []
  }
  return ((data || []) as DoorType[]).map((r) => ({
    ...r,
    labor_hours_eng: Number(r.labor_hours_eng) || 0,
    labor_hours_cnc: Number(r.labor_hours_cnc) || 0,
    labor_hours_assembly: Number(r.labor_hours_assembly) || 0,
    labor_hours_finish: Number(r.labor_hours_finish) || 0,
    hardware_cost: Number(r.hardware_cost) || 0,
  }))
}

export async function listDoorTypeMaterials(orgId: string): Promise<DoorTypeMaterial[]> {
  const { data, error } = await supabase
    .from('door_type_materials')
    .select('id, org_id, door_type_id, material_name, cost_value, cost_unit, notes, active')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('material_name')
  if (error) {
    console.error('listDoorTypeMaterials', error)
    return []
  }
  return ((data || []) as DoorTypeMaterial[]).map((r) => ({
    ...r,
    cost_value: Number(r.cost_value) || 0,
  }))
}

export async function listDoorTypeMaterialFinishes(
  orgId: string,
): Promise<DoorTypeMaterialFinish[]> {
  const { data, error } = await supabase
    .from('door_type_material_finishes')
    .select('id, org_id, door_type_material_id, finish_name, labor_hours_per_door, material_per_door, active')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('finish_name')
  if (error) {
    console.error('listDoorTypeMaterialFinishes', error)
    return []
  }
  return ((data || []) as DoorTypeMaterialFinish[]).map((r) => ({
    ...r,
    labor_hours_per_door: Number(r.labor_hours_per_door) || 0,
    material_per_door: Number(r.material_per_door) || 0,
  }))
}

// ── Writes ──

export async function createDoorTypeMaterial(input: {
  org_id: string
  door_type_id: string
  material_name: string
  cost_value: number
  cost_unit: DoorMaterialCostUnit
  notes?: string | null
}): Promise<DoorTypeMaterial | null> {
  const { data, error } = await supabase
    .from('door_type_materials')
    .insert({
      org_id: input.org_id,
      door_type_id: input.door_type_id,
      material_name: input.material_name,
      cost_value: input.cost_value,
      cost_unit: input.cost_unit,
      notes: input.notes ?? null,
      active: true,
    })
    .select('id, org_id, door_type_id, material_name, cost_value, cost_unit, notes, active')
    .single()
  if (error) {
    console.error('createDoorTypeMaterial', error)
    throw new Error(error.message || 'Failed to save door material')
  }
  return data
    ? { ...(data as DoorTypeMaterial), cost_value: Number(data.cost_value) || 0 }
    : null
}

export async function createDoorTypeMaterialFinish(input: {
  org_id: string
  door_type_material_id: string
  finish_name: string
  labor_hours_per_door: number
  material_per_door: number
}): Promise<DoorTypeMaterialFinish | null> {
  const { data, error } = await supabase
    .from('door_type_material_finishes')
    .insert({
      org_id: input.org_id,
      door_type_material_id: input.door_type_material_id,
      finish_name: input.finish_name,
      labor_hours_per_door: input.labor_hours_per_door,
      material_per_door: input.material_per_door,
      active: true,
    })
    .select('id, org_id, door_type_material_id, finish_name, labor_hours_per_door, material_per_door, active')
    .single()
  if (error) {
    console.error('createDoorTypeMaterialFinish', error)
    throw new Error(error.message || 'Failed to save door finish')
  }
  return data
    ? {
        ...(data as DoorTypeMaterialFinish),
        labor_hours_per_door: Number(data.labor_hours_per_door) || 0,
        material_per_door: Number(data.material_per_door) || 0,
      }
    : null
}

export async function saveDoorTypeCalibration(input: {
  orgId: string
  existingId: string | null
  name: string
  perDoor: { eng: number; cnc: number; assembly: number; finish: number }
  hardwareCost: number
}): Promise<string> {
  const { orgId, existingId, name, perDoor, hardwareCost } = input
  const calibrated =
    perDoor.eng + perDoor.cnc + perDoor.assembly + perDoor.finish > 0

  if (existingId) {
    const { error } = await supabase
      .from('door_types')
      .update({
        name,
        labor_hours_eng: perDoor.eng,
        labor_hours_cnc: perDoor.cnc,
        labor_hours_assembly: perDoor.assembly,
        labor_hours_finish: perDoor.finish,
        hardware_cost: hardwareCost,
        calibrated,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingId)
    if (error) throw error
    return existingId
  }

  const { data, error } = await supabase
    .from('door_types')
    .insert({
      org_id: orgId,
      name,
      labor_hours_eng: perDoor.eng,
      labor_hours_cnc: perDoor.cnc,
      labor_hours_assembly: perDoor.assembly,
      labor_hours_finish: perDoor.finish,
      hardware_cost: hardwareCost,
      calibrated,
      active: true,
    })
    .select('id')
    .single()
  if (error || !data) throw error || new Error('Failed to create door type')
  return data.id
}

// ── Helpers — keying for the composer ──

export function indexDoorTypeMaterials(
  rows: DoorTypeMaterial[],
): Map<string, DoorTypeMaterial[]> {
  const map = new Map<string, DoorTypeMaterial[]>()
  for (const r of rows) {
    const list = map.get(r.door_type_id) ?? []
    list.push(r)
    map.set(r.door_type_id, list)
  }
  return map
}

export function indexDoorTypeMaterialFinishes(
  rows: DoorTypeMaterialFinish[],
): Map<string, DoorTypeMaterialFinish[]> {
  const map = new Map<string, DoorTypeMaterialFinish[]>()
  for (const r of rows) {
    const list = map.get(r.door_type_material_id) ?? []
    list.push(r)
    map.set(r.door_type_material_id, list)
  }
  return map
}
