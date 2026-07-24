// ============================================================================
// lib/led.ts — LED types (rate-book overhaul, chunk D).
// ============================================================================
// LED is a calibrated FEATURE, not a product. Each led_types row is a kind of
// LED calibrated per linear foot: labor hours/LF by dept + material $/LF. The
// composer adds LED rows (type + LF) to a cabinet line; hours flow into the
// line's dept hours, material into its material cost. See migration 073.
// ============================================================================

import { supabase } from './supabase'
import type { Confidence } from './rate-book-v2'

export interface LedType {
  id: string
  org_id: string
  name: string
  labor_hours_eng_per_lf: number
  labor_hours_cnc_per_lf: number
  labor_hours_assembly_per_lf: number
  labor_hours_finish_per_lf: number
  material_cost_per_lf: number
  calibrated: boolean
  confidence: Confidence
  active: boolean
}

const LED_COLUMNS =
  'id, org_id, name, labor_hours_eng_per_lf, labor_hours_cnc_per_lf, labor_hours_assembly_per_lf, labor_hours_finish_per_lf, material_cost_per_lf, calibrated, confidence, active'

function normalizeLed(r: any): LedType {
  return {
    id: r.id,
    org_id: r.org_id,
    name: r.name,
    labor_hours_eng_per_lf: Number(r.labor_hours_eng_per_lf) || 0,
    labor_hours_cnc_per_lf: Number(r.labor_hours_cnc_per_lf) || 0,
    labor_hours_assembly_per_lf: Number(r.labor_hours_assembly_per_lf) || 0,
    labor_hours_finish_per_lf: Number(r.labor_hours_finish_per_lf) || 0,
    material_cost_per_lf: Number(r.material_cost_per_lf) || 0,
    calibrated: !!r.calibrated,
    confidence: (r.confidence as Confidence) || 'untested',
    active: r.active === undefined ? true : !!r.active,
  }
}

/** Sum of per-LF dept labor — drives the `calibrated` flag. */
export function ledLaborPerLf(t: {
  labor_hours_eng_per_lf: number
  labor_hours_cnc_per_lf: number
  labor_hours_assembly_per_lf: number
  labor_hours_finish_per_lf: number
}): number {
  return (
    t.labor_hours_eng_per_lf +
    t.labor_hours_cnc_per_lf +
    t.labor_hours_assembly_per_lf +
    t.labor_hours_finish_per_lf
  )
}

// ── Reads ──

export async function listLedTypes(orgId: string): Promise<LedType[]> {
  const { data, error } = await supabase
    .from('led_types')
    .select(LED_COLUMNS)
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('listLedTypes', error)
    return []
  }
  return (data || []).map(normalizeLed)
}

// ── Writes ──

interface LedInput {
  name: string
  labor_hours_eng_per_lf: number
  labor_hours_cnc_per_lf: number
  labor_hours_assembly_per_lf: number
  labor_hours_finish_per_lf: number
  material_cost_per_lf: number
}

export async function createLedType(input: LedInput & { org_id: string }): Promise<LedType> {
  const { data, error } = await supabase
    .from('led_types')
    .insert({
      org_id: input.org_id,
      name: input.name,
      labor_hours_eng_per_lf: input.labor_hours_eng_per_lf,
      labor_hours_cnc_per_lf: input.labor_hours_cnc_per_lf,
      labor_hours_assembly_per_lf: input.labor_hours_assembly_per_lf,
      labor_hours_finish_per_lf: input.labor_hours_finish_per_lf,
      material_cost_per_lf: input.material_cost_per_lf,
      calibrated: ledLaborPerLf(input) > 0,
    })
    .select(LED_COLUMNS)
    .single()
  if (error || !data) {
    console.error('createLedType', error)
    throw new Error(error?.message || 'Failed to create LED type')
  }
  return normalizeLed(data)
}

export async function updateLedType(id: string, patch: Partial<LedInput>): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of [
    'name',
    'labor_hours_eng_per_lf',
    'labor_hours_cnc_per_lf',
    'labor_hours_assembly_per_lf',
    'labor_hours_finish_per_lf',
    'material_cost_per_lf',
  ] as const) {
    if (patch[k] !== undefined) update[k] = patch[k]
  }
  // Recompute calibrated when any labor field is part of the patch.
  const laborKeys = [
    'labor_hours_eng_per_lf',
    'labor_hours_cnc_per_lf',
    'labor_hours_assembly_per_lf',
    'labor_hours_finish_per_lf',
  ] as const
  if (laborKeys.some((k) => patch[k] !== undefined)) {
    const { data } = await supabase
      .from('led_types')
      .select(
        'labor_hours_eng_per_lf, labor_hours_cnc_per_lf, labor_hours_assembly_per_lf, labor_hours_finish_per_lf',
      )
      .eq('id', id)
      .single()
    const merged = {
      labor_hours_eng_per_lf: patch.labor_hours_eng_per_lf ?? Number(data?.labor_hours_eng_per_lf) ?? 0,
      labor_hours_cnc_per_lf: patch.labor_hours_cnc_per_lf ?? Number(data?.labor_hours_cnc_per_lf) ?? 0,
      labor_hours_assembly_per_lf:
        patch.labor_hours_assembly_per_lf ?? Number(data?.labor_hours_assembly_per_lf) ?? 0,
      labor_hours_finish_per_lf:
        patch.labor_hours_finish_per_lf ?? Number(data?.labor_hours_finish_per_lf) ?? 0,
    }
    update.calibrated = ledLaborPerLf(merged) > 0
  }
  const { error } = await supabase.from('led_types').update(update).eq('id', id)
  if (error) {
    console.error('updateLedType', error)
    throw new Error(error.message || 'Failed to update LED type')
  }
}

export async function archiveLedType(id: string): Promise<void> {
  const { error } = await supabase
    .from('led_types')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('archiveLedType', error)
    throw new Error(error.message || 'Failed to remove LED type')
  }
}
