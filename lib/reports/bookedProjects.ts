// ============================================================================
// lib/reports/bookedProjects.ts
// ============================================================================
// Reads sold + production + installed projects and rolls them up into the
// shape Reports → Outlook expects: { name, estimatedHours, startMonth,
// endMonth }. Hours come from estimate_lines via loadProjectDeptHours
// (the canonical source — see lib/project-hours.ts). Start/end months
// come from min(scheduled_date) / max(scheduled_date + scheduled_days)
// across the project's department_allocations.
//
// Stage gate is ['sold','production','installed'] — anything won counts
// as booked. Projects with zero hours OR no scheduling data are dropped:
//   - zero hours: no estimate_lines yet, can't contribute meaningful
//     load to a utilization projection.
//   - no scheduling data: no department_allocations rows, so we have
//     no timeline. (Sold projects pre-production-seed land here; they
//     show up once seedAllocationsForProduction runs.)
// ============================================================================

import { supabase } from '../supabase'
import { loadProjectDeptHours } from '../project-hours'
import type { BookedProject } from './outlookCalculations'

interface ProjectRow {
  id: string
  name: string
  org_id: string | null
}

interface SubprojectRow {
  id: string
  project_id: string
}

interface AllocationRow {
  subproject_id: string
  scheduled_date: string | null
  scheduled_days: number | null
}

function ymKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** Load + shape booked projects for the Reports outlook chart.
 *  Pure read; no mutations. */
export async function loadBookedProjects(orgId: string): Promise<BookedProject[]> {
  const { data: projData } = await supabase
    .from('projects')
    .select('id, name, org_id')
    .eq('org_id', orgId)
    .in('stage', ['sold', 'production', 'installed'])
  const projects = (projData || []) as ProjectRow[]
  if (projects.length === 0) return []

  const projIds = projects.map((p) => p.id)
  const { data: subData } = await supabase
    .from('subprojects')
    .select('id, project_id')
    .in('project_id', projIds)
  const subs = (subData || []) as SubprojectRow[]
  const subIds = subs.map((s) => s.id)
  const subToProject = new Map(subs.map((s) => [s.id, s.project_id]))

  // Timeline data — still sourced from department_allocations because
  // that's the only table with scheduled_date / scheduled_days.
  const allocs: AllocationRow[] = []
  if (subIds.length > 0) {
    const { data: allocData } = await supabase
      .from('department_allocations')
      .select('subproject_id, scheduled_date, scheduled_days')
      .in('subproject_id', subIds)
    allocs.push(...((allocData || []) as AllocationRow[]))
  }

  const timeline = new Map<string, { startMs: number; endMs: number }>()
  for (const a of allocs) {
    const projId = subToProject.get(a.subproject_id)
    if (!projId || !a.scheduled_date) continue
    const start = new Date(a.scheduled_date + 'T12:00:00Z')
    if (isNaN(start.getTime())) continue
    const days = Math.max(1, Number(a.scheduled_days) || 1)
    const startMs = start.getTime()
    const end = new Date(startMs)
    end.setUTCDate(end.getUTCDate() + days)
    const endMs = end.getTime()
    const cur = timeline.get(projId)
    if (!cur) {
      timeline.set(projId, { startMs, endMs })
    } else {
      cur.startMs = Math.min(cur.startMs, startMs)
      cur.endMs = Math.max(cur.endMs, endMs)
    }
  }

  // Hours per project — pulled from estimate_lines via the canonical
  // helper. Loads in parallel since each call hits a few tables; for
  // typical org sizes (<100 booked projects) this is comfortably fast.
  const hourPairs = await Promise.all(
    projects.map(async (p) => {
      if (!p.org_id) return [p.id, 0] as const
      const r = await loadProjectDeptHours(p.org_id, p.id)
      return [p.id, r.totalHours] as const
    }),
  )
  const hoursByProject = new Map(hourPairs)

  const out: BookedProject[] = []
  for (const proj of projects) {
    const hrs = hoursByProject.get(proj.id) ?? 0
    const t = timeline.get(proj.id)
    if (hrs <= 0) continue
    if (!t) continue
    out.push({
      name: proj.name,
      estimatedHours: Math.round(hrs),
      startMonth: ymKey(new Date(t.startMs)),
      endMonth: ymKey(new Date(t.endMs)),
    })
  }
  // Sort by start month for a stable list rendering.
  out.sort((a, b) => a.startMonth.localeCompare(b.startMonth))
  return out
}
