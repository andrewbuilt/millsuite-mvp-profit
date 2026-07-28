// ============================================================================
// lib/features.ts — cabinet features (rate-book chunk F; generalizes LED).
// ============================================================================
// A cabinet feature is a calibrated add-on for base/upper/full lines, priced
// per linear foot. Two modes:
//   'runs'   — multiple rows on a line (type + LF each). LED.
//   'toggle' — a per-line on/off applied at the line's LF. Face frame.
// Material = a blended flat $/LF (LED) and/or catalog stock consumed per LF
// (face frame). See migration 078.
// ============================================================================

import { supabase } from './supabase'
import type { Confidence } from './rate-book-v2'

export type FeatureMode = 'runs' | 'toggle'

export interface CabinetFeature {
  id: string
  org_id: string
  name: string
  mode: FeatureMode
  labor_hours_eng_per_lf: number
  labor_hours_cnc_per_lf: number
  labor_hours_assembly_per_lf: number
  labor_hours_finish_per_lf: number
  /** Blended flat material $/LF (LED strip/channel/driver). */
  material_cost_per_lf: number
  /** Catalog stock consumed per LF (face frame). null = none. */
  material_id: string | null
  material_consumption_per_lf: number
  calibrated: boolean
  confidence: Confidence
  active: boolean
}

const COLUMNS =
  'id, org_id, name, mode, labor_hours_eng_per_lf, labor_hours_cnc_per_lf, labor_hours_assembly_per_lf, labor_hours_finish_per_lf, material_cost_per_lf, material_id, material_consumption_per_lf, calibrated, confidence, active'

function normalize(r: any): CabinetFeature {
  return {
    id: r.id,
    org_id: r.org_id,
    name: r.name,
    mode: (r.mode as FeatureMode) || 'runs',
    labor_hours_eng_per_lf: Number(r.labor_hours_eng_per_lf) || 0,
    labor_hours_cnc_per_lf: Number(r.labor_hours_cnc_per_lf) || 0,
    labor_hours_assembly_per_lf: Number(r.labor_hours_assembly_per_lf) || 0,
    labor_hours_finish_per_lf: Number(r.labor_hours_finish_per_lf) || 0,
    material_cost_per_lf: Number(r.material_cost_per_lf) || 0,
    material_id: r.material_id ?? null,
    material_consumption_per_lf: Number(r.material_consumption_per_lf) || 0,
    calibrated: !!r.calibrated,
    confidence: (r.confidence as Confidence) || 'untested',
    active: r.active === undefined ? true : !!r.active,
  }
}

/** Sum of per-LF dept labor — drives the `calibrated` flag. */
export function featureLaborPerLf(t: {
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

export async function listCabinetFeatures(orgId: string): Promise<CabinetFeature[]> {
  const { data, error } = await supabase
    .from('cabinet_features')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  if (error) {
    console.error('listCabinetFeatures', error)
    return []
  }
  return (data || []).map(normalize)
}

// ── Writes ──

export interface FeatureInput {
  name: string
  mode: FeatureMode
  labor_hours_eng_per_lf: number
  labor_hours_cnc_per_lf: number
  labor_hours_assembly_per_lf: number
  labor_hours_finish_per_lf: number
  material_cost_per_lf: number
  material_id: string | null
  material_consumption_per_lf: number
}

export async function createCabinetFeature(
  input: FeatureInput & { org_id: string },
): Promise<CabinetFeature> {
  const { data, error } = await supabase
    .from('cabinet_features')
    .insert({ ...input, calibrated: featureLaborPerLf(input) > 0 })
    .select(COLUMNS)
    .single()
  if (error || !data) {
    console.error('createCabinetFeature', error)
    throw new Error(error?.message || 'Failed to create feature')
  }
  return normalize(data)
}

export async function updateCabinetFeature(id: string, input: FeatureInput): Promise<void> {
  const { error } = await supabase
    .from('cabinet_features')
    .update({
      ...input,
      calibrated: featureLaborPerLf(input) > 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) {
    console.error('updateCabinetFeature', error)
    throw new Error(error.message || 'Failed to update feature')
  }
}

export async function archiveCabinetFeature(id: string): Promise<void> {
  const { error } = await supabase
    .from('cabinet_features')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) {
    console.error('archiveCabinetFeature', error)
    throw new Error(error.message || 'Failed to remove feature')
  }
}
