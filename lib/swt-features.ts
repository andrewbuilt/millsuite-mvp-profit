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

export type SwtPricingMode = 'each' | 'sqft' | 'length_steps'

export interface SwtHours {
  eng: number
  cnc: number
  assembly: number
  finish: number
}

export interface SwtStep {
  /** This step covers lengths up to and including this many feet. */
  up_to_ft: number
  hours: SwtHours
  material: number
}

export interface SwtFeature {
  id: string
  org_id: string
  name: string
  pricing_mode: SwtPricingMode
  /** Per unit (per piece for 'each', per sq ft for 'sqft'). */
  hours: SwtHours
  material_per_unit: number
  /** 'length_steps' only — ascending by up_to_ft after normalize(). */
  steps: SwtStep[]
  extra_ft_hours: SwtHours
  extra_ft_material: number
  active: boolean
}

/** One feature on a composer line — stored in product_slots.swtFeatures. */
export interface SwtFeatureUse {
  featureId: string
  /** 'each' */
  qty?: number | null
  /** 'sqft' — null/undefined = the default (top's one face). */
  sqft?: number | null
  /** 'length_steps' */
  lengthFt?: number | null
}

export const ZERO_HOURS: SwtHours = { eng: 0, cnc: 0, assembly: 0, finish: 0 }

const COLUMNS =
  'id, org_id, name, pricing_mode, hours_eng, hours_cnc, hours_assembly, hours_finish, material_per_unit, steps, extra_ft_hours, extra_ft_material, active'

function hrs(h: any): SwtHours {
  return {
    eng: Number(h?.eng) || 0,
    cnc: Number(h?.cnc) || 0,
    assembly: Number(h?.assembly) || 0,
    finish: Number(h?.finish) || 0,
  }
}

export function normalizeSwtFeature(r: any): SwtFeature {
  const steps: SwtStep[] = (Array.isArray(r.steps) ? r.steps : [])
    .map((s: any) => ({ up_to_ft: Number(s?.up_to_ft) || 0, hours: hrs(s?.hours), material: Number(s?.material) || 0 }))
    .filter((s: SwtStep) => s.up_to_ft > 0)
    .sort((a: SwtStep, b: SwtStep) => a.up_to_ft - b.up_to_ft)
  return {
    id: r.id,
    org_id: r.org_id,
    name: r.name || 'Feature',
    pricing_mode: (['each', 'sqft', 'length_steps'].includes(r.pricing_mode) ? r.pricing_mode : 'each') as SwtPricingMode,
    hours: { eng: Number(r.hours_eng) || 0, cnc: Number(r.hours_cnc) || 0, assembly: Number(r.hours_assembly) || 0, finish: Number(r.hours_finish) || 0 },
    material_per_unit: Number(r.material_per_unit) || 0,
    steps,
    extra_ft_hours: hrs(r.extra_ft_hours),
    extra_ft_material: Number(r.extra_ft_material) || 0,
    active: r.active === undefined ? true : !!r.active,
  }
}

// ── Pure pricing ──

const scaleHours = (h: SwtHours, k: number): SwtHours => ({
  eng: h.eng * k,
  cnc: h.cnc * k,
  assembly: h.assembly * k,
  finish: h.finish * k,
})
const addHours = (a: SwtHours, b: SwtHours): SwtHours => ({
  eng: a.eng + b.eng,
  cnc: a.cnc + b.cnc,
  assembly: a.assembly + b.assembly,
  finish: a.finish + b.finish,
})
export const sumHours = (h: SwtHours) => h.eng + h.cnc + h.assembly + h.finish

/** Default sq ft for a 'sqft' feature: one face of the top. */
export function defaultSqft(lengthIn: number, widthIn: number): number {
  const v = ((Number(lengthIn) || 0) * (Number(widthIn) || 0)) / 144
  return Math.round(v * 100) / 100
}

/**
 * Price ONE feature use on ONE piece. `defaultSqftValue` fills a 'sqft' use
 * whose sqft wasn't typed. Never throws: a bad input prices at 0 hours.
 */
export function priceSwtFeature(
  f: SwtFeature,
  use: SwtFeatureUse,
  defaultSqftValue: number,
): { hours: SwtHours; material: number; units: number; bracket: string | null } {
  if (f.pricing_mode === 'each') {
    const n = Math.max(0, Number(use.qty) || 0)
    return { hours: scaleHours(f.hours, n), material: f.material_per_unit * n, units: n, bracket: null }
  }
  if (f.pricing_mode === 'sqft') {
    const sq = use.sqft != null && Number(use.sqft) >= 0 ? Number(use.sqft) : defaultSqftValue
    return { hours: scaleHours(f.hours, sq), material: f.material_per_unit * sq, units: sq, bracket: null }
  }
  // length_steps
  const len = Math.max(0, Number(use.lengthFt) || 0)
  if (len <= 0 || f.steps.length === 0) return { hours: { ...ZERO_HOURS }, material: 0, units: len, bracket: null }
  const want = Math.ceil(len - 1e-9)
  const hit = f.steps.find((s) => s.up_to_ft >= want)
  if (hit) return { hours: { ...hit.hours }, material: hit.material, units: len, bracket: `≤ ${hit.up_to_ft} ft` }
  const last = f.steps[f.steps.length - 1]
  const extra = want - last.up_to_ft
  return {
    hours: addHours(last.hours, scaleHours(f.extra_ft_hours, extra)),
    material: last.material + f.extra_ft_material * extra,
    units: len,
    bracket: `${last.up_to_ft} ft + ${extra} ft`,
  }
}

export interface SwtFeatureRollupRow {
  featureId: string
  name: string
  mode: SwtPricingMode
  units: number
  bracket: string | null
  hours: SwtHours
  material: number
}

/** Every feature use on a line, PER PIECE. Unknown ids are skipped (the
 *  staleness check reports them separately via unresolvedSlotIds). */
export function computeSwtFeatureRollup(
  uses: SwtFeatureUse[] | null | undefined,
  features: SwtFeature[],
  defaultSqftValue: number,
): { hours: SwtHours; material: number; rows: SwtFeatureRollupRow[] } {
  let hours: SwtHours = { ...ZERO_HOURS }
  let material = 0
  const rows: SwtFeatureRollupRow[] = []
  for (const u of uses || []) {
    const f = features.find((x) => x.id === u.featureId)
    if (!f) continue
    const p = priceSwtFeature(f, u, defaultSqftValue)
    hours = addHours(hours, p.hours)
    material += p.material
    rows.push({ featureId: f.id, name: f.name, mode: f.pricing_mode, units: p.units, bracket: p.bracket, hours: p.hours, material: p.material })
  }
  return { hours, material, rows }
}

/**
 * Plain client-facing wording — "2 bowties · hand-rubbed finish · mitered
 * corner 4 ft". No slot syntax, no prices, no hours (the CO-descriptions
 * lesson: internal detail on a client document reads as noise).
 */
export function describeSwtFeatures(rows: Array<Pick<SwtFeatureRollupRow, 'name' | 'mode' | 'units'>>): string {
  const fmtFt = (n: number) => `${Math.round(n * 10) / 10} ft`
  return rows
    .map((r) => {
      const name = r.name.trim()
      if (r.mode === 'each') return r.units === 1 ? name : `${r.units} × ${name}`
      if (r.mode === 'length_steps') return `${name} ${fmtFt(r.units)}`
      return name // sqft: the area is internal; "hand-rubbed finish" says it
    })
    .filter(Boolean)
    .join(' · ')
}

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
