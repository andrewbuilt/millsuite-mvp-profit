// lib/bom/material-calc.ts
// Aggregate project_scope_items into a sheet-goods BOM.
//
// Ported from millsuite-takeoff's lib/material-calc.ts. The math is unchanged
// — we accumulate sq ft per material spec first and round up ONCE at the end
// so we don't compound per-item rounding errors across many items.
//
// Reads ProjectScopeItem (MVP) rather than TakeoffItem. The field shapes are
// identical where it matters (category, linear_feet, quantity, material_specs).

import type { ProjectScopeItem, ScopeItemCategory } from '../types'

export interface MaterialLine {
  group: 'Sheet Goods' | 'Solid Stock' | 'Specialty'
  name: string
  species: string
  thickness: string
  quantity: number
  unit: 'sheets' | 'LF' | 'ea'
  sourceItems: string[]
}

const SQ_FT_PER_SHEET = 32 // 4x8 = 32 sq ft

// sq ft of material PER LINEAR FOOT of cabinet run, by cabinet category.
// Industry-calibrated numbers for a typical frameless build.
//
// Rule-of-thumb sanity check:
// - 10 LF of base     → ~3 sheets exterior + 2 interior + 1 back  ≈ 6 sheets
// - 10 LF of uppers   → ~2 sheets exterior + 1.5 interior + 1 back ≈ 4.5 sheets
// - 10 LF of full ht  → ~4 sheets exterior + 3 interior + 1.5 back ≈ 8.5 sheets
const MATERIAL_USAGE: Record<string, { exterior: number; interior: number; back: number }> = {
  base_cabinet:  { exterior: 0.95, interior: 0.70, back: 0.35 },
  upper_cabinet: { exterior: 0.65, interior: 0.50, back: 0.35 },
  full_height:   { exterior: 1.30, interior: 1.00, back: 0.55 },
  vanity:        { exterior: 0.85, interior: 0.55, back: 0.30 },
}

function isCabinetItem(item: ProjectScopeItem): boolean {
  return item.category !== null && item.category in MATERIAL_USAGE
}

function specKey(species: string, thickness: string): string {
  return `${species}::${thickness}`
}

// Running accumulator of sq ft per material spec (not yet rounded to sheets)
interface Accumulator {
  name: string
  species: string
  thickness: string
  sqft: number
  sourceItems: Set<string>
}

function addSqFt(
  map: Map<string, Accumulator>,
  key: string,
  name: string,
  species: string,
  thickness: string,
  sqft: number,
  sourceItem: string,
) {
  const existing = map.get(key)
  if (existing) {
    existing.sqft += sqft
    existing.sourceItems.add(sourceItem)
  } else {
    map.set(key, {
      name,
      species,
      thickness,
      sqft,
      sourceItems: new Set([sourceItem]),
    })
  }
}

export function calculateMaterials(items: ProjectScopeItem[]): MaterialLine[] {
  const sheetGoodsRaw = new Map<string, Accumulator>()
  const solidStock = new Map<string, MaterialLine>()
  const specialty = new Map<string, MaterialLine>()

  // ── Sheet goods ──
  for (const item of items) {
    if (!isCabinetItem(item)) continue
    const lf = (item.linear_feet || 0) * (item.quantity || 1)
    if (lf <= 0) continue

    const usage = MATERIAL_USAGE[item.category as ScopeItemCategory]

    const exteriorSpecies = item.material_specs?.exterior_species || 'unspecified'
    const exteriorThickness = normalizeThickness(item.material_specs?.exterior_thickness, '3/4"')
    const interiorMaterial = item.material_specs?.interior_material || 'prefinished_maple'
    const interiorThickness = normalizeThickness(item.material_specs?.interior_thickness, '1/2"')
    const backMaterial = item.material_specs?.back_material || 'white_melamine'
    const backThickness = normalizeThickness(item.material_specs?.back_thickness, '1/4"')

    // Exterior
    addSqFt(
      sheetGoodsRaw,
      specKey(exteriorSpecies, exteriorThickness),
      `${humanize(exteriorSpecies)} (exterior)`,
      humanize(exteriorSpecies),
      exteriorThickness,
      lf * usage.exterior * SQ_FT_PER_SHEET,
      item.name,
    )

    // Interior
    addSqFt(
      sheetGoodsRaw,
      specKey(interiorMaterial, interiorThickness),
      `${humanize(interiorMaterial)} (interior)`,
      humanize(interiorMaterial),
      interiorThickness,
      lf * usage.interior * SQ_FT_PER_SHEET,
      item.name,
    )

    // Back
    addSqFt(
      sheetGoodsRaw,
      specKey(backMaterial, backThickness),
      `${humanize(backMaterial)} (back)`,
      humanize(backMaterial),
      backThickness,
      lf * usage.back * SQ_FT_PER_SHEET,
      item.name,
    )
  }

  // Convert accumulated sq ft → rounded sheet count ONCE
  const sheetGoodsLines: MaterialLine[] = Array.from(sheetGoodsRaw.values()).map((acc) => ({
    group: 'Sheet Goods',
    name: acc.name,
    species: acc.species,
    thickness: acc.thickness,
    quantity: Math.ceil(acc.sqft / SQ_FT_PER_SHEET),
    unit: 'sheets',
    sourceItems: Array.from(acc.sourceItems),
  }))

  // ── Countertops → solid stock ──
  for (const item of items) {
    if (item.category !== 'countertop') continue
    const species = item.material_specs?.exterior_species || 'unspecified'
    const thickness = normalizeThickness(item.material_specs?.exterior_thickness, '1-1/2"')
    const key = specKey(species, thickness)
    const lf = (item.linear_feet || 0) * (item.quantity || 1)
    const existing = solidStock.get(key)
    if (existing) {
      existing.quantity += lf
      if (!existing.sourceItems.includes(item.name)) existing.sourceItems.push(item.name)
    } else {
      solidStock.set(key, {
        group: 'Solid Stock',
        name: `${humanize(species)} countertop blank`,
        species: humanize(species),
        thickness,
        quantity: lf,
        unit: 'LF',
        sourceItems: [item.name],
      })
    }
  }

  // ── Panels → specialty ──
  for (const item of items) {
    if (item.category !== 'panel') continue
    const species = item.material_specs?.exterior_species || 'unspecified'
    const thickness = normalizeThickness(item.material_specs?.exterior_thickness, '3/4"')
    const key = specKey(species, thickness)
    const qty = item.quantity || 1
    const existing = specialty.get(key)
    if (existing) {
      existing.quantity += qty
      if (!existing.sourceItems.includes(item.name)) existing.sourceItems.push(item.name)
    } else {
      specialty.set(key, {
        group: 'Specialty',
        name: `${humanize(species)} panel`,
        species: humanize(species),
        thickness,
        quantity: qty,
        unit: 'ea',
        sourceItems: [item.name],
      })
    }
  }

  return [
    ...sheetGoodsLines,
    ...Array.from(solidStock.values()),
    ...Array.from(specialty.values()),
  ]
}

// Ensure thickness is displayed consistently (add quote if bare number).
function normalizeThickness(t: string | undefined | null, fallback: string): string {
  if (!t) return fallback
  const trimmed = t.trim()
  if (trimmed.endsWith('"') || trimmed.toLowerCase().includes('mm')) return trimmed
  return `${trimmed}"`
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
