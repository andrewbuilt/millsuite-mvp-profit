// ============================================================================
// lib/worker-clockin.ts — data for the /me clock-in flow's subproject cards
// ============================================================================
// Screen 2 of the clock-in redesign shows, per subproject, HOURS ONLY:
// estimated hours by department (the same rollup hoursByDept the subproject
// page prints) against actual clocked minutes by department. No dollar figure
// is computed or returned from here — this feeds a worker's phone.
//
// Estimates come from computeSubprojectRollup over the sub's estimate lines
// with a ZEROED pricing context: hours don't depend on rate, and passing 0s
// means a money number can't even be produced by accident. Matching the
// subproject page's "Labor by department" strip is the correctness bar —
// a worker comparing their phone to the shop screen must see the same numbers.
//
// Actuals come from lib/actual-hours keyed by departments.id, bridged to the
// canonical LaborDept buckets by name — the same heuristic the subproject
// page and lib/closed-jobs use. Minutes in a department that doesn't map
// (a custom dept named, say, "Yard") are carried in `unmappedActualMinutes`
// so the card's total still reconciles with /time.
// ============================================================================

import { supabase } from './supabase'
import {
  loadRateBook,
  loadEstimateLines,
  computeSubprojectRollup,
  type PricingContext,
} from './estimate-lines'
import { loadSubprojectActualHours } from './actual-hours'
import { LABOR_DEPTS, type LaborDept } from './rate-book-seed'

export interface SubClockCard {
  subprojectId: string
  name: string
  /** Estimated hours per canonical dept, from the sub's rollup. Decimal hours. */
  estHoursByDept: Record<LaborDept, number>
  /** Actual clocked minutes per canonical dept. */
  actualMinutesByDept: Record<LaborDept, number>
  /** Clocked minutes on this sub in departments that map to no canonical bucket. */
  unmappedActualMinutes: number
  totalEstHours: number
  totalActualMinutes: number
}

function zeroDeptMap(): Record<LaborDept, number> {
  return { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 }
}

/** departments.name → canonical LaborDept bucket. Same heuristics as
 *  lib/closed-jobs and the subproject page — keep the three in agreement. */
export function deptNameToKey(name: string): LaborDept | null {
  const n = name.toLowerCase()
  if (n.includes('eng')) return 'eng'
  if (n.includes('cnc')) return 'cnc'
  if (n.includes('assembly') || n.includes('bench')) return 'assembly'
  if (n.includes('finish') || n.includes('paint') || n.includes('sand')) return 'finish'
  if (n.includes('install')) return 'install'
  return null
}

export async function loadSubClockCards(orgId: string, projectId: string): Promise<SubClockCard[]> {
  const [subsRes, rateBook, deptsRes] = await Promise.all([
    supabase
      .from('subprojects')
      .select('id, name, quantity, sort_order')
      .eq('project_id', projectId)
      .order('sort_order'),
    loadRateBook(orgId),
    supabase.from('departments').select('id, name').eq('org_id', orgId),
  ])
  const subs = (subsRes.data || []) as Array<{ id: string; name: string; quantity: number | null }>
  if (subs.length === 0) return []

  const deptKeyById: Record<string, LaborDept> = {}
  for (const d of (deptsRes.data || []) as Array<{ id: string; name: string }>) {
    const k = deptNameToKey(d.name)
    if (k) deptKeyById[d.id] = k
  }

  // Hours only: rate/markup/margin all 0 so no cost can leak into this shape.
  const noMoney: PricingContext = { shopRate: 0, consumableMarkupPct: 0, profitMarginPct: 0 }

  const [linesBySub, actuals] = await Promise.all([
    Promise.all(subs.map(async (sub) => ({ subId: sub.id, lines: await loadEstimateLines(sub.id) }))),
    loadSubprojectActualHours(subs.map((s) => s.id)),
  ])

  return subs.map((sub) => {
    const lines = linesBySub.find((x) => x.subId === sub.id)?.lines || []
    const rollup = computeSubprojectRollup(lines, rateBook.itemsById, new Map(), noMoney, sub.quantity ?? 1)

    const actual = actuals[sub.id]
    const actualByKey = zeroDeptMap()
    let unmapped = 0
    for (const [deptId, mins] of Object.entries(actual?.byDeptMinutes || {})) {
      const key = deptKeyById[deptId]
      if (key) actualByKey[key] += mins
      else unmapped += mins
    }

    const estHoursByDept = zeroDeptMap()
    for (const d of LABOR_DEPTS) estHoursByDept[d] = rollup.hoursByDept[d]

    return {
      subprojectId: sub.id,
      name: sub.name,
      estHoursByDept,
      actualMinutesByDept: actualByKey,
      unmappedActualMinutes: unmapped,
      totalEstHours: rollup.totalHours,
      totalActualMinutes: actual?.totalMinutes || 0,
    }
  })
}
