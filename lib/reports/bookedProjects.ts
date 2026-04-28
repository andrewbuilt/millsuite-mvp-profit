// ============================================================================
// lib/reports/bookedProjects.ts
// ============================================================================
// Reads sold + production + installed projects and rolls them up into the
// shape Reports → Outlook expects: { name, estimatedHours, startMonth,
// endMonth }. Hours come from estimate_lines via loadProjectDeptHours
// (the canonical source — see lib/project-hours.ts). Start/end months
// come from project_month_allocations — the persistence behind the
// /capacity calendar, which is the canonical surface for "where is this
// booked work landing in time."
//
// Stage gate is ['sold','production','installed'] — anything won counts
// as booked. Projects with zero hours OR no slot on the capacity calendar
// are dropped:
//   - zero hours: no estimate_lines yet, can't contribute meaningful
//     load to a utilization projection.
//   - no calendar slot: nothing in project_month_allocations, so we
//     don't know when the project lands. The operator hasn't placed it
//     on the calendar yet.
// ============================================================================

import { supabase } from '../supabase'
import { loadProjectDeptHours } from '../project-hours'
import type { BookedProject } from './outlookCalculations'

interface ProjectRow {
  id: string
  name: string
  org_id: string | null
}

interface MonthAllocationRow {
  project_id: string
  month_date: string
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

  // Timeline — sourced from project_month_allocations (the /capacity
  // calendar's persistence). Each row places one project into one
  // calendar month; a project with rows in Apr + May spans Apr→Jun
  // (max month + 1 month, exclusive end), matching how the chart's
  // month-bucket math already counts boundaries.
  const { data: monthData } = await supabase
    .from('project_month_allocations')
    .select('project_id, month_date')
    .in('project_id', projIds)
  const monthRows = (monthData || []) as MonthAllocationRow[]

  const timeline = new Map<string, { startMs: number; endMs: number }>()
  for (const row of monthRows) {
    if (!row.month_date) continue
    const start = new Date(row.month_date + 'T12:00:00Z')
    if (isNaN(start.getTime())) continue
    const startMs = start.getTime()
    const end = new Date(start)
    end.setUTCMonth(end.getUTCMonth() + 1)
    const endMs = end.getTime()
    const cur = timeline.get(row.project_id)
    if (!cur) {
      timeline.set(row.project_id, { startMs, endMs })
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
