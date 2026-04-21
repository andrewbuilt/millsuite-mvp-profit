// lib/bom/finish-calc.ts
// Group project_scope_items by finish treatment with a rough sq ft estimate.
//
// Ported from millsuite-takeoff's lib/finish-calc.ts.

import type { ProjectScopeItem } from '../types'

export interface FinishLine {
  group: 'Stain' | 'Paint' | 'Lacquer' | 'Specialty'
  finishType: string
  stainColor: string
  sheen: string
  sidesToFinish: string
  surfaceAreaSqFt: number
  itemNames: string[]
}

// Rough sq ft of finished surface per LF of cabinet (doors + face frame + sides).
const SQFT_PER_LF_FINISH = 3.5

function categorizeFinish(finishType: string): FinishLine['group'] {
  const t = finishType.toLowerCase()
  if (t.includes('stain')) return 'Stain'
  if (t.includes('paint')) return 'Paint'
  if (t.includes('lacquer')) return 'Lacquer'
  return 'Specialty'
}

export function calculateFinishes(items: ProjectScopeItem[]): FinishLine[] {
  const bucket = new Map<string, FinishLine>()

  for (const item of items) {
    const fs = item.finish_specs || {}
    const finishType = fs.finish_type || 'unspecified'
    const stainColor = fs.stain_color || ''
    const sheen = fs.sheen || ''
    const sides = fs.sides_to_finish || 'exterior_only'
    const key = `${finishType}::${stainColor}::${sheen}::${sides}`

    const lf = (item.linear_feet || 0) * (item.quantity || 1)
    const sqft = lf * SQFT_PER_LF_FINISH
    // Double the sq ft when finishing both inside and outside.
    const effectiveSqft = sides === 'all_sides' ? sqft * 2 : sqft

    const existing = bucket.get(key)
    if (existing) {
      existing.surfaceAreaSqFt += effectiveSqft
      if (!existing.itemNames.includes(item.name)) existing.itemNames.push(item.name)
    } else {
      bucket.set(key, {
        group: categorizeFinish(finishType),
        finishType: humanize(finishType),
        stainColor: humanize(stainColor),
        sheen: humanize(sheen),
        sidesToFinish: humanize(sides),
        surfaceAreaSqFt: effectiveSqft,
        itemNames: [item.name],
      })
    }
  }

  return Array.from(bucket.values()).map((l) => ({
    ...l,
    surfaceAreaSqFt: Math.round(l.surfaceAreaSqFt),
  }))
}

function humanize(s: string): string {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
