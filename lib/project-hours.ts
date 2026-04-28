// ============================================================================
// lib/project-hours.ts — canonical project-level hours rollup.
// ============================================================================
// Reads estimate_lines for every subproject of a project and rolls them
// up into { totalHours, deptHours }. deptHours is keyed by departments.id
// (uuid) so callers that previously read department_allocations can swap
// in this helper without changing their downstream shape.
//
// Why a shared helper: department_allocations is only seeded by
// lib/schedule-seed.ts when a project auto-advances to 'production'.
// Anything earlier in the lifecycle (sold, ninety_percent, fifty_fifty)
// has zero rows there. Surfaces that need hours for sold work — the
// /capacity drop-from-unscheduled handler, the Reports outlook chart —
// were silently writing 0h. estimate_lines is the canonical source the
// project page, subproject page, and composer staleness already use.
//
// Stage-agnostic by design: works for sold, production, installed alike.
// ============================================================================

import { supabase } from './supabase'
import {
  computeSubprojectRollup,
  loadEstimateLines,
  loadRateBook,
  type PricingContext,
} from './estimate-lines'
import { LABOR_DEPTS, type LaborDept } from './rate-book-seed'

export interface ProjectDeptHoursResult {
  totalHours: number
  // Keyed by departments.id (uuid). LaborDept keys ('eng', 'cnc', …) are
  // mapped to dept ids via department.name match (same heuristic the
  // project page uses for its est-vs-actual rollup).
  deptHours: Record<string, number>
}

const EMPTY: ProjectDeptHoursResult = { totalHours: 0, deptHours: {} }

interface SubRow {
  id: string
  consumable_markup_pct: number | null
}

interface DeptRow {
  id: string
  name: string
}

/** Map a department name to its canonical LaborDept key. Matches the
 *  heuristic used in app/(app)/projects/[id]/page.tsx for actuals.
 *  Returns null when the dept is custom and doesn't map to one of the
 *  five canonical labor depts. */
function deptNameToLaborKey(name: string): LaborDept | null {
  const n = (name || '').toLowerCase()
  if (n.includes('eng')) return 'eng'
  if (n.includes('cnc')) return 'cnc'
  if (n.includes('assembly') || n.includes('bench')) return 'assembly'
  if (n.includes('finish') || n.includes('paint') || n.includes('sand')) return 'finish'
  if (n.includes('install')) return 'install'
  return null
}

/**
 * Roll up a project's hours from estimate_lines via computeSubprojectRollup.
 * Independent of stage and of department_allocations. Best-effort — any
 * load failure logs and returns the empty shape so callers never wedge.
 */
export async function loadProjectDeptHours(
  orgId: string,
  projectId: string,
): Promise<ProjectDeptHoursResult> {
  if (!orgId || !projectId) return EMPTY

  try {
    const [
      { data: orgData },
      { data: subsData },
      { data: deptsData },
    ] = await Promise.all([
      supabase
        .from('orgs')
        .select('consumable_markup_pct, shop_rate')
        .eq('id', orgId)
        .single(),
      supabase
        .from('subprojects')
        .select('id, consumable_markup_pct')
        .eq('project_id', projectId),
      supabase
        .from('departments')
        .select('id, name')
        .eq('org_id', orgId),
    ])

    const subs = (subsData || []) as SubRow[]
    if (subs.length === 0) return EMPTY

    const orgConsumables = Number(
      (orgData as { consumable_markup_pct: number | null } | null)
        ?.consumable_markup_pct ?? 10,
    )
    const shopRate = Number(
      (orgData as { shop_rate: number | null } | null)?.shop_rate ?? 0,
    )

    // LaborDept key → departments.id. Departments without a canonical
    // mapping (custom shop-floor steps) won't show up in deptHours; their
    // estimated hours fold only into totalHours.
    const keyToDeptId: Partial<Record<LaborDept, string>> = {}
    for (const d of (deptsData || []) as DeptRow[]) {
      const key = deptNameToLaborKey(d.name)
      if (key && !keyToDeptId[key]) keyToDeptId[key] = d.id
    }

    const rateBook = await loadRateBook(orgId)

    let totalHours = 0
    const deptHours: Record<string, number> = {}

    for (const sub of subs) {
      const lines = await loadEstimateLines(sub.id)
      const ctx: PricingContext = {
        shopRate,
        consumableMarkupPct: sub.consumable_markup_pct ?? orgConsumables,
        // Hours don't depend on margin; matches lib/project-totals.ts.
        profitMarginPct: 0,
      }
      const rollup = computeSubprojectRollup(
        lines,
        rateBook.itemsById,
        new Map(),
        ctx,
      )
      totalHours += rollup.totalHours
      for (const key of LABOR_DEPTS) {
        const hrs = rollup.hoursByDept[key]
        if (!hrs || hrs <= 0) continue
        const deptId = keyToDeptId[key]
        if (!deptId) continue
        deptHours[deptId] = (deptHours[deptId] || 0) + hrs
      }
    }

    return { totalHours, deptHours }
  } catch (err) {
    console.error('loadProjectDeptHours', err)
    return EMPTY
  }
}
