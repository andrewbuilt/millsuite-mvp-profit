// ============================================================================
// lib/rate-book-seed.ts
// ============================================================================
// Idempotent starter-library seed for a new org's rate book.
//
// Called by the rate book page on first load: if the org has zero items,
// seedStarterRateBook(orgId) runs. Everything it inserts has confidence
// 'untested' so the badges are gray — the shop sees "yes, something's here,
// but trust it only after it's been used on real jobs."
//
// Dept labor rates default to BUILD-ORDER Phase 1:
//   Engineering $95 · CNC $85 · Assembly $85 · Finish $90 · Install $80
//
// Starter categories + items are a minimal viable kit covering the 9 buckets
// the rate-book mockup uses. Andrew can delete anything he doesn't want; the
// shop will replace most of these with their own numbers over time.
// ============================================================================

import { supabase } from './supabase'

// ── Defaults exported for settings UI ──

export const DEFAULT_LABOR_RATES: Record<LaborDept, number> = {
  eng: 95,
  cnc: 85,
  assembly: 85,
  finish: 90,
  install: 80,
}

export type LaborDept = 'eng' | 'cnc' | 'assembly' | 'finish' | 'install'
export const LABOR_DEPTS: LaborDept[] = ['eng', 'cnc', 'assembly', 'finish', 'install']
export const LABOR_DEPT_LABEL: Record<LaborDept, string> = {
  eng: 'Engineering',
  cnc: 'CNC',
  assembly: 'Assembly',
  finish: 'Finish',
  install: 'Install',
}

// ── Starter shape types ──

interface StarterItem {
  key: string
  name: string
  unit: 'lf' | 'each' | 'sf' | 'day' | 'hr' | 'job'
  material_mode: 'sheets' | 'linear' | 'lump' | 'none'
  hours: Partial<Record<LaborDept, number>>
  sheets_per_unit?: number
  sheet_cost?: number
  linear_cost?: number
  lump_cost?: number
  material_description?: string
  hardware_cost?: number
  hardware_note?: string
}

interface StarterCategory {
  key: string
  name: string
  item_type: 'cabinet_style' | 'door_style' | 'drawer_style' | 'install_style' | 'hardware' | 'finish' | 'custom'
  items: StarterItem[]
}

// ── Starter kit ──
// These numbers are illustrative. Every item is seeded at 'untested'
// confidence so Andrew's shop sees gray badges until real jobs run through.

const STARTER: StarterCategory[] = [
  {
    key: 'cabinets',
    name: 'Cabinets',
    item_type: 'cabinet_style',
    items: [
      {
        key: 'std-base', name: 'Standard base carcass', unit: 'lf', material_mode: 'sheets',
        hours: { eng: 0.08, cnc: 0.25, assembly: 1.40, finish: 0.10 },
        sheets_per_unit: 1.2, sheet_cost: 68, material_description: '¾" maple ply',
        hardware_cost: 6, hardware_note: 'levelers, french cleat',
      },
      {
        key: 'sink-base', name: 'Sink base carcass', unit: 'lf', material_mode: 'sheets',
        hours: { eng: 0.10, cnc: 0.30, assembly: 1.60, finish: 0.10 },
        sheets_per_unit: 1.3, sheet_cost: 68, material_description: '¾" maple ply, marine core',
        hardware_cost: 10, hardware_note: 'levelers, drip strip',
      },
      {
        key: 'std-upper', name: 'Standard upper carcass', unit: 'lf', material_mode: 'sheets',
        hours: { eng: 0.06, cnc: 0.20, assembly: 1.10, finish: 0.08 },
        sheets_per_unit: 0.9, sheet_cost: 68, material_description: '¾" maple ply',
        hardware_cost: 5, hardware_note: 'french cleat',
      },
      {
        key: 'pantry', name: 'Pantry tower', unit: 'lf', material_mode: 'sheets',
        hours: { eng: 0.20, cnc: 0.50, assembly: 3.80, finish: 0.30 },
        sheets_per_unit: 2.2, sheet_cost: 68, material_description: '¾" maple ply',
        hardware_cost: 12, hardware_note: 'levelers + french cleat — pullouts priced separately',
      },
    ],
  },
  {
    key: 'doors',
    name: 'Doors',
    item_type: 'door_style',
    items: [
      {
        key: 'shaker', name: 'Shaker door', unit: 'each', material_mode: 'linear',
        hours: { eng: 0.05, cnc: 0.15, assembly: 0.40, finish: 0.35 },
        linear_cost: 14, material_description: 'paint-grade poplar',
        hardware_note: 'hinges are consumables — in the 10% material markup',
      },
      {
        key: 'slab', name: 'Slab door', unit: 'each', material_mode: 'sheets',
        hours: { eng: 0.04, cnc: 0.12, assembly: 0.20, finish: 0.40 },
        sheets_per_unit: 0.25, sheet_cost: 72, material_description: 'prefinished ply',
        hardware_note: 'hinges are consumables',
      },
      {
        key: 'glass', name: 'Glass insert door', unit: 'each', material_mode: 'linear',
        hours: { eng: 0.10, cnc: 0.20, assembly: 0.60, finish: 0.40 },
        linear_cost: 22, material_description: 'paint-grade poplar + seeded glass',
        hardware_note: 'hinges are consumables',
      },
    ],
  },
  {
    key: 'drawers',
    name: 'Drawers',
    item_type: 'drawer_style',
    items: [
      {
        key: 'std-drawer', name: 'Standard drawer (dovetailed box)', unit: 'each', material_mode: 'sheets',
        hours: { eng: 0.03, cnc: 0.10, assembly: 0.45, finish: 0.20 },
        sheets_per_unit: 0.15, sheet_cost: 85, material_description: 'soft maple dovetail box',
        hardware_cost: 28, hardware_note: 'Blum soft-close undermount slides (included)',
      },
      {
        key: 'deep-drawer', name: 'Deep / pot drawer', unit: 'each', material_mode: 'sheets',
        hours: { eng: 0.03, cnc: 0.12, assembly: 0.55, finish: 0.25 },
        sheets_per_unit: 0.22, sheet_cost: 85, material_description: 'soft maple dovetail box',
        hardware_cost: 38, hardware_note: 'heavy-duty soft-close slides (included)',
      },
    ],
  },
  {
    key: 'panels',
    name: 'Panels & scribes',
    item_type: 'custom',
    items: [
      {
        key: 'end-base', name: 'End panel — base', unit: 'each', material_mode: 'sheets',
        hours: { eng: 0.03, cnc: 0.15, assembly: 0.30, finish: 0.35 },
        sheets_per_unit: 0.7, sheet_cost: 72, material_description: 'prefinished ply + edgebanding',
      },
      {
        key: 'toe-kick', name: 'Toe kick', unit: 'lf', material_mode: 'linear',
        hours: { cnc: 0.04, assembly: 0.08, finish: 0.06 },
        linear_cost: 4, material_description: 'painted MDF',
      },
      {
        key: 'filler', name: 'Filler strip', unit: 'lf', material_mode: 'linear',
        hours: { cnc: 0.03, assembly: 0.05, finish: 0.10 },
        linear_cost: 6, material_description: 'paint-grade poplar',
      },
    ],
  },
  {
    key: 'trim',
    name: 'Trim & moulding',
    item_type: 'custom',
    items: [
      {
        key: 'crown', name: 'Crown moulding', unit: 'lf', material_mode: 'linear',
        hours: { assembly: 0.08, finish: 0.10 },
        linear_cost: 14, material_description: 'paint-grade poplar',
      },
      {
        key: 'base-trim', name: 'Base trim', unit: 'lf', material_mode: 'linear',
        hours: { assembly: 0.05, finish: 0.08 },
        linear_cost: 8, material_description: 'paint-grade poplar',
      },
    ],
  },
  {
    key: 'hardware',
    name: 'Specialty hardware',
    item_type: 'hardware',
    items: [
      {
        key: 'pullout-trash', name: 'Pull-out trash', unit: 'each', material_mode: 'sheets',
        hours: { eng: 0.04, cnc: 0.10, assembly: 0.40, finish: 0.10 },
        sheets_per_unit: 0.3, sheet_cost: 68, material_description: '¾" ply insert',
        hardware_cost: 92, hardware_note: 'Rev-A-Shelf unit + bins',
      },
    ],
  },
  {
    key: 'install',
    name: 'Install',
    item_type: 'install_style',
    items: [
      {
        key: 'install-day', name: 'Install day (2-person crew)', unit: 'day', material_mode: 'none',
        hours: { install: 14 },
        hardware_note: 'per crew day, includes drive',
      },
      {
        key: '2nd-floor', name: '2nd floor premium', unit: 'job', material_mode: 'none',
        hours: { install: 2.0 },
        hardware_note: 'extra handling / stair',
      },
    ],
  },
  {
    key: 'engineering',
    name: 'Engineering',
    item_type: 'custom',
    items: [
      {
        key: 'shop-drawings', name: 'Shop drawings (per project)', unit: 'hr', material_mode: 'none',
        hours: { eng: 1.0 },
        hardware_note: 'billed hourly',
      },
      {
        key: 'cnc-prep', name: 'CNC programming', unit: 'hr', material_mode: 'none',
        hours: { cnc: 1.0 },
      },
    ],
  },
]

// ── Starter options ──

interface StarterOption {
  key: string
  name: string
  scope: string
  effect_type: 'hours_multiplier' | 'rate_multiplier' | 'material_multiplier' | 'flat_add' | 'per_unit_add' | 'flag'
  effect_value: number
  effect_target?: string
  notes?: string
}

const STARTER_OPTIONS: StarterOption[] = [
  { key: 'curved', name: 'Curved', scope: 'shop_wide', effect_type: 'hours_multiplier', effect_value: 1.25, effect_target: 'all', notes: '×1.25 hours' },
  { key: 'rush', name: 'Rush (<3 wk)', scope: 'shop_wide', effect_type: 'rate_multiplier', effect_value: 1.25, notes: '×1.25 rate' },
  { key: 'exotic', name: 'Exotic species', scope: 'shop_wide', effect_type: 'material_multiplier', effect_value: 1.4, notes: '×1.4 material' },
  { key: 'paint-grade', name: 'Paint grade', scope: 'shop_wide', effect_type: 'material_multiplier', effect_value: 0.85, notes: '×0.85 material' },
  { key: 'inset', name: 'Inset construction', scope: 'shop_wide', effect_type: 'hours_multiplier', effect_value: 1.30, effect_target: 'assembly', notes: '×1.30 assembly' },
  { key: '2nd-floor', name: '2nd floor', scope: 'shop_wide', effect_type: 'flat_add', effect_value: 120, notes: '+$120/job' },
  { key: 'no-elev', name: 'No elevator', scope: 'shop_wide', effect_type: 'flat_add', effect_value: 200, notes: '+$200/job' },
]

// ── Seed function ──

export async function seedStarterRateBook(orgId: string): Promise<{
  seeded: boolean
  reason?: string
}> {
  if (!orgId) return { seeded: false, reason: 'no org' }

  // Labor rates — insert missing rows per dept.
  const { data: existingRates } = await supabase
    .from('shop_labor_rates')
    .select('dept')
    .eq('org_id', orgId)
  const existingDepts = new Set((existingRates || []).map((r: any) => r.dept))
  const missingRates = LABOR_DEPTS.filter((d) => !existingDepts.has(d))
  if (missingRates.length > 0) {
    await supabase.from('shop_labor_rates').insert(
      missingRates.map((dept) => ({
        org_id: orgId,
        dept,
        rate_per_hour: DEFAULT_LABOR_RATES[dept],
      }))
    )
  }

  // Skip item seeding if the org already has any items.
  const { count: itemCount } = await supabase
    .from('rate_book_items')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)

  if ((itemCount ?? 0) > 0) {
    return { seeded: false, reason: 'items already exist' }
  }

  // Categories first — collect ids by key.
  const categoryIdByKey: Record<string, string> = {}
  for (let i = 0; i < STARTER.length; i++) {
    const cat = STARTER[i]
    const { data } = await supabase
      .from('rate_book_categories')
      .insert({
        org_id: orgId,
        name: cat.name,
        item_type: cat.item_type,
        display_order: i,
        active: true,
      })
      .select('id')
      .single()
    if (data) categoryIdByKey[cat.key] = data.id
  }

  // Items under each category, all with confidence='untested'.
  for (const cat of STARTER) {
    const catId = categoryIdByKey[cat.key]
    const rows = cat.items.map((it) => ({
      org_id: orgId,
      category_id: catId,
      name: it.name,
      unit: it.unit,
      material_mode: it.material_mode,
      base_labor_hours_eng: it.hours.eng || 0,
      base_labor_hours_cnc: it.hours.cnc || 0,
      base_labor_hours_assembly: it.hours.assembly || 0,
      base_labor_hours_finish: it.hours.finish || 0,
      base_labor_hours_install: it.hours.install || 0,
      sheets_per_unit: it.sheets_per_unit || 0,
      sheet_cost: it.sheet_cost || 0,
      linear_cost: it.linear_cost || 0,
      lump_cost: it.lump_cost || 0,
      material_description: it.material_description || null,
      hardware_cost: it.hardware_cost || 0,
      hardware_note: it.hardware_note || null,
      confidence: 'untested',
      active: true,
    }))
    if (rows.length > 0) {
      await supabase.from('rate_book_items').insert(rows)
    }
  }

  // Options — idempotent per (org_id, key) via the unique constraint. Try
  // upsert; if conflict, ignore.
  await supabase
    .from('rate_book_options')
    .upsert(
      STARTER_OPTIONS.map((o) => ({
        org_id: orgId,
        key: o.key,
        name: o.name,
        scope: o.scope,
        effect_type: o.effect_type,
        effect_value: o.effect_value,
        effect_target: o.effect_target || null,
        notes: o.notes || null,
        active: true,
      })),
      { onConflict: 'org_id,key', ignoreDuplicates: true }
    )

  return { seeded: true }
}
