// lib/bom/hardware-calc.ts
// Consolidate hardware across all project_scope_items.
//
// Ported from millsuite-takeoff's lib/hardware-calc.ts.

import type { ProjectScopeItem } from '../types'

export interface HardwareLine {
  group: 'Hinges' | 'Slides' | 'Drawer Systems' | 'Pulls/Knobs' | 'Specialty'
  description: string
  specification: string
  quantity: number
  sourceItems: string[]
}

export function calculateHardware(items: ProjectScopeItem[]): HardwareLine[] {
  const hinges = new Map<string, HardwareLine>()
  const slides = new Map<string, HardwareLine>()
  const drawers = new Map<string, HardwareLine>()
  const pulls = new Map<string, HardwareLine>()
  const specialty: HardwareLine[] = []

  for (const item of items) {
    const qtyMult = item.quantity || 1
    const hw = item.hardware_specs || {}

    // Hinges
    if (hw.hinges?.count && hw.hinges.count > 0) {
      const type = hw.hinges.type || 'concealed_110'
      const key = type
      const total = hw.hinges.count * qtyMult
      const existing = hinges.get(key)
      if (existing) {
        existing.quantity += total
        if (!existing.sourceItems.includes(item.name)) existing.sourceItems.push(item.name)
      } else {
        hinges.set(key, {
          group: 'Hinges',
          description: `${humanize(type)} hinge`,
          specification: humanize(type),
          quantity: total,
          sourceItems: [item.name],
        })
      }
    }

    // Drawer slides
    if (hw.slides?.count && hw.slides.count > 0) {
      const type = hw.slides.type || 'undermount'
      const length = hw.slides.length || ''
      const key = `${type}::${length}`
      const total = hw.slides.count * qtyMult
      const existing = slides.get(key)
      if (existing) {
        existing.quantity += total
        if (!existing.sourceItems.includes(item.name)) existing.sourceItems.push(item.name)
      } else {
        slides.set(key, {
          group: 'Slides',
          description: `${humanize(type)} slide${length ? ' ' + length : ''}`,
          specification: `${humanize(type)}${length ? ' · ' + length : ''}`,
          quantity: total,
          sourceItems: [item.name],
        })
      }
    }

    // Drawer systems (from features.drawer_count when no explicit slides).
    // Covers the common case where the parser found drawers but didn't fill
    // in an explicit hardware_specs.slides entry.
    const drawerCount = item.features?.drawer_count || 0
    if (drawerCount > 0 && !hw.slides?.count) {
      const slideType = item.features?.slide_type || 'undermount_soft_close'
      const existing = drawers.get(slideType)
      const total = drawerCount * qtyMult
      if (existing) {
        existing.quantity += total
        if (!existing.sourceItems.includes(item.name)) existing.sourceItems.push(item.name)
      } else {
        drawers.set(slideType, {
          group: 'Drawer Systems',
          description: `${humanize(slideType)} drawer box`,
          specification: humanize(slideType),
          quantity: total,
          sourceItems: [item.name],
        })
      }
    }

    // Pulls / knobs
    if (hw.pulls?.count && hw.pulls.count > 0) {
      const type = hw.pulls.type || 'bar'
      const size = hw.pulls.size || ''
      const key = `${type}::${size}`
      const total = hw.pulls.count * qtyMult
      const existing = pulls.get(key)
      if (existing) {
        existing.quantity += total
        if (!existing.sourceItems.includes(item.name)) existing.sourceItems.push(item.name)
      } else {
        pulls.set(key, {
          group: 'Pulls/Knobs',
          description: `${humanize(type)} pull${size ? ' ' + size : ''}`,
          specification: `${humanize(type)}${size ? ' · ' + size : ''}`,
          quantity: total,
          sourceItems: [item.name],
        })
      }
    }

    // Specialty hardware (lazy susans, trash pullouts, LED strips, etc.)
    if (Array.isArray(hw.specialty)) {
      for (const s of hw.specialty) {
        if (!s || !s.type) continue
        specialty.push({
          group: 'Specialty',
          description: humanize(s.type),
          specification: humanize(s.type),
          quantity: (s.count || 1) * qtyMult,
          sourceItems: [item.name],
        })
      }
    }
  }

  return [
    ...Array.from(hinges.values()),
    ...Array.from(slides.values()),
    ...Array.from(drawers.values()),
    ...Array.from(pulls.values()),
    ...specialty,
  ]
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
