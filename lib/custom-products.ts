// ============================================================================
// lib/custom-products.ts — user-defined calibrated products (chunk E).
// ============================================================================
// A custom product is the simple "labor + materials + qty" shape: labor
// hours/unit by dept, N material slots (each picks a catalog material at line
// time, consumed per unit), optional LED + hardware. Built-in cabinet products
// (base/upper/full) stay hardcoded in lib/products.ts. See migration 075.
//
// material_slots is the shared slot-definition source: the composer renders a
// dropdown per slot and the CO spec-change modal derives its changeable slots
// from the same array.
// ============================================================================

import { supabase } from './supabase'
import type { Confidence } from './rate-book-v2'

export type CustomProductUnit = 'lf' | 'each' | 'sqft'
export type MaterialSlotShowIn = 'carcass' | 'door' | 'back_panel' | 'shelf' | 'any'

export interface CustomMaterialSlot {
  /** Stable slot id — product_slots stores `custom_<key>` → catalog material id. */
  key: string
  label: string
  /** Which catalog flag seeds this slot's quick-grab list. 'any' = whole catalog. */
  show_in: MaterialSlotShowIn
  /** Material cost-units consumed per product unit (e.g. 0.1 sheet per LF).
   *  cost = qty × consumption_per_unit × material.cost_value. */
  consumption_per_unit: number
}

export interface CustomProduct {
  id: string
  org_id: string
  name: string
  unit: CustomProductUnit
  labor_hours_eng_per_unit: number
  labor_hours_cnc_per_unit: number
  labor_hours_assembly_per_unit: number
  labor_hours_finish_per_unit: number
  hardware_cost_per_unit: number
  led_enabled: boolean
  material_slots: CustomMaterialSlot[]
  calibrated: boolean
  confidence: Confidence
  active: boolean
}

const COLUMNS =
  'id, org_id, name, unit, labor_hours_eng_per_unit, labor_hours_cnc_per_unit, labor_hours_assembly_per_unit, labor_hours_finish_per_unit, hardware_cost_per_unit, led_enabled, material_slots, calibrated, confidence, active'

function normalizeSlot(s: any, i: number): CustomMaterialSlot {
  return {
    key: String(s?.key ?? `slot${i}`),
    label: String(s?.label ?? `Material ${i + 1}`),
    show_in: (s?.show_in as MaterialSlotShowIn) || 'any',
    consumption_per_unit: Number(s?.consumption_per_unit) || 0,
  }
}

function normalize(r: any): CustomProduct {
  return {
    id: r.id,
    org_id: r.org_id,
    name: r.name,
    unit: (r.unit as CustomProductUnit) || 'lf',
    labor_hours_eng_per_unit: Number(r.labor_hours_eng_per_unit) || 0,
    labor_hours_cnc_per_unit: Number(r.labor_hours_cnc_per_unit) || 0,
    labor_hours_assembly_per_unit: Number(r.labor_hours_assembly_per_unit) || 0,
    labor_hours_finish_per_unit: Number(r.labor_hours_finish_per_unit) || 0,
    hardware_cost_per_unit: Number(r.hardware_cost_per_unit) || 0,
    led_enabled: !!r.led_enabled,
    material_slots: Array.isArray(r.material_slots)
      ? r.material_slots.map(normalizeSlot)
      : [],
    calibrated: !!r.calibrated,
    confidence: (r.confidence as Confidence) || 'untested',
    active: r.active === undefined ? true : !!r.active,
  }
}

/** Sum of per-unit dept labor — drives the `calibrated` flag. */
export function customLaborPerUnit(t: {
  labor_hours_eng_per_unit: number
  labor_hours_cnc_per_unit: number
  labor_hours_assembly_per_unit: number
  labor_hours_finish_per_unit: number
}): number {
  return (
    t.labor_hours_eng_per_unit +
    t.labor_hours_cnc_per_unit +
    t.labor_hours_assembly_per_unit +
    t.labor_hours_finish_per_unit
  )
}

// ── Reads ──

export async function listCustomProducts(orgId: string): Promise<CustomProduct[]> {
  const { data, error } = await supabase
    .from('custom_products')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('listCustomProducts', error)
    return []
  }
  return (data || []).map(normalize)
}

// ── Writes ──

export interface CustomProductInput {
  name: string
  unit: CustomProductUnit
  labor_hours_eng_per_unit: number
  labor_hours_cnc_per_unit: number
  labor_hours_assembly_per_unit: number
  labor_hours_finish_per_unit: number
  hardware_cost_per_unit: number
  led_enabled: boolean
  material_slots: CustomMaterialSlot[]
}

export async function createCustomProduct(
  input: CustomProductInput & { org_id: string },
): Promise<CustomProduct> {
  const { data, error } = await supabase
    .from('custom_products')
    .insert({
      org_id: input.org_id,
      name: input.name,
      unit: input.unit,
      labor_hours_eng_per_unit: input.labor_hours_eng_per_unit,
      labor_hours_cnc_per_unit: input.labor_hours_cnc_per_unit,
      labor_hours_assembly_per_unit: input.labor_hours_assembly_per_unit,
      labor_hours_finish_per_unit: input.labor_hours_finish_per_unit,
      hardware_cost_per_unit: input.hardware_cost_per_unit,
      led_enabled: input.led_enabled,
      material_slots: input.material_slots,
      calibrated: customLaborPerUnit(input) > 0,
    })
    .select(COLUMNS)
    .single()
  if (error || !data) {
    console.error('createCustomProduct', error)
    throw new Error(error?.message || 'Failed to create product')
  }
  return normalize(data)
}

export async function updateCustomProduct(
  id: string,
  input: CustomProductInput,
): Promise<void> {
  const { error } = await supabase
    .from('custom_products')
    .update({
      name: input.name,
      unit: input.unit,
      labor_hours_eng_per_unit: input.labor_hours_eng_per_unit,
      labor_hours_cnc_per_unit: input.labor_hours_cnc_per_unit,
      labor_hours_assembly_per_unit: input.labor_hours_assembly_per_unit,
      labor_hours_finish_per_unit: input.labor_hours_finish_per_unit,
      hardware_cost_per_unit: input.hardware_cost_per_unit,
      led_enabled: input.led_enabled,
      material_slots: input.material_slots,
      calibrated: customLaborPerUnit(input) > 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) {
    console.error('updateCustomProduct', error)
    throw new Error(error.message || 'Failed to update product')
  }
}

export async function archiveCustomProduct(id: string): Promise<void> {
  const { error } = await supabase
    .from('custom_products')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('archiveCustomProduct', error)
    throw new Error(error.message || 'Failed to remove product')
  }
}
