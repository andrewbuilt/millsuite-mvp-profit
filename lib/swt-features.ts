// ============================================================================
// lib/swt-features.ts — Solid Wood Top features (migration 120)
// ============================================================================
// The craft on a top that the BdFt-scaled calibration can't see: bowties,
// hand-rubbed finish, mitered / finger-jointed corners, cutouts. Three pricing
// shapes (see the migration header):
//   'each'          per piece          → qty
//   'sqft'          per square foot    → sqft (composer defaults it to the
//                                         top's L×W÷144, one face)
//   'length_steps'  absolute price per → lengthFt; bracket = first step with
//                   length bracket       up_to_ft ≥ ceil(length), past the last
//                                        step: last + extra_ft_* per extra ft
//
// ⛔ SEPARATE from lib/features (cabinet features, priced per LF of cabinet).
// Don't merge the mechanisms — different shapes, and the edge-profile
// multiplier is a third, independent thing (shaping an edge ≠ joining a
// corner).
//
// The pricing here is PURE so the composer, the staleness check and the
// scripts all get the same answer.
// ============================================================================

import { supabase } from './supabase'
import { normalizeSwtFeature, type SwtFeature, type SwtHours, type SwtPricingMode, type SwtStep } from './swt-features-math'

export * from './swt-features-math'

const COLUMNS =
  'id, org_id, name, pricing_mode, hours_eng, hours_cnc, hours_assembly, hours_finish, material_per_unit, steps, extra_ft_hours, extra_ft_material, active'

// ── Reads / writes ──

export async function listSwtFeatures(orgId: string): Promise<SwtFeature[]> {
  const { data, error } = await supabase
    .from('swt_features')
    .select(COLUMNS)
    .eq('org_id', orgId)
    .eq('active', true)
    .order('name')
  // Pre-120 → no table → no features; the composer simply shows none.
  if (error || !data) return []
  return data.map(normalizeSwtFeature)
}

export interface SwtFeatureInput {
  name: string
  pricing_mode: SwtPricingMode
  hours: SwtHours
  material_per_unit: number
  steps: SwtStep[]
  extra_ft_hours: SwtHours
  extra_ft_material: number
}

function toRow(i: SwtFeatureInput) {
  return {
    name: i.name.trim(),
    pricing_mode: i.pricing_mode,
    hours_eng: i.hours.eng,
    hours_cnc: i.hours.cnc,
    hours_assembly: i.hours.assembly,
    hours_finish: i.hours.finish,
    material_per_unit: i.material_per_unit,
    steps: [...i.steps].sort((a, b) => a.up_to_ft - b.up_to_ft),
    extra_ft_hours: i.extra_ft_hours,
    extra_ft_material: i.extra_ft_material,
    updated_at: new Date().toISOString(),
  }
}

export async function createSwtFeature(orgId: string, i: SwtFeatureInput): Promise<SwtFeature> {
  if (!i.name.trim()) throw new Error('Give the feature a name.')
  const { data, error } = await supabase
    .from('swt_features')
    .insert({ org_id: orgId, ...toRow(i) })
    .select(COLUMNS)
    .single()
  if (error) throw new Error(/swt_features/.test(error.message) ? 'Run migration 120 first.' : error.message)
  return normalizeSwtFeature(data)
}

export async function updateSwtFeature(id: string, i: SwtFeatureInput): Promise<void> {
  if (!i.name.trim()) throw new Error('Give the feature a name.')
  const { data, error } = await supabase.from('swt_features').update(toRow(i)).eq('id', id).select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('The feature could not be updated.')
}

/** Archive, never delete — saved lines reference the id. */
export async function archiveSwtFeature(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('swt_features')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) throw new Error('The feature could not be archived.')
}
