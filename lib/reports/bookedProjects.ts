// ============================================================================
// lib/reports/bookedProjects.ts
// ============================================================================
// Reads production / installed projects and rolls them up into the shape
// the Reports → Outlook section already expects: { name, estimatedHours,
// startMonth, endMonth }. Hours come from department_allocations
// (estimated_hours per row); start/end months come from
// min(scheduled_date) / max(scheduled_date + scheduled_days) across the
// project's allocations.
//
// Projects with zero scheduled allocations or zero estimated hours are
// dropped — they can't contribute to a utilization projection.
// ============================================================================

import { supabase } from '../supabase'
import type { BookedProject } from './outlookCalculations'

interface ProjectRow {
  id: string
  name: string
}

interface SubprojectRow {
  id: string
  project_id: string
}

interface AllocationRow {
  subproject_id: string
  scheduled_date: string | null
  scheduled_days: number | null
  estimated_hours: number | string
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
    .select('id, name')
    .eq('org_id', orgId)
    .in('stage', ['production', 'installed'])
  const projects = (projData || []) as ProjectRow[]
  if (projects.length === 0) return []

  const projIds = projects.map((p) => p.id)
  const { data: subData } = await supabase
    .from('subprojects')
    .select('id, project_id')
    .in('project_id', projIds)
  const subs = (subData || []) as SubprojectRow[]
  if (subs.length === 0) return []
  const subIds = subs.map((s) => s.id)
  const subToProject = new Map(subs.map((s) => [s.id, s.project_id]))

  const { data: allocData } = await supabase
    .from('department_allocations')
    .select('subproject_id, scheduled_date, scheduled_days, estimated_hours')
    .in('subproject_id', subIds)
  const allocs = (allocData || []) as AllocationRow[]
  if (allocs.length === 0) return []

  // Reduce by project — sum hours, take min start and max end across the
  // project's allocations.
  const acc = new Map<
    string,
    { hours: number; startMs: number | null; endMs: number | null }
  >()
  for (const a of allocs) {
    const projId = subToProject.get(a.subproject_id)
    if (!projId) continue
    const hrs = Number(a.estimated_hours) || 0
    const days = Math.max(1, Number(a.scheduled_days) || 1)
    let startMs: number | null = null
    let endMs: number | null = null
    if (a.scheduled_date) {
      const start = new Date(a.scheduled_date + 'T12:00:00Z')
      if (!isNaN(start.getTime())) {
        startMs = start.getTime()
        const end = new Date(startMs)
        end.setUTCDate(end.getUTCDate() + days)
        endMs = end.getTime()
      }
    }
    const cur = acc.get(projId) ?? { hours: 0, startMs: null, endMs: null }
    cur.hours += hrs
    if (startMs != null) {
      cur.startMs = cur.startMs == null ? startMs : Math.min(cur.startMs, startMs)
    }
    if (endMs != null) {
      cur.endMs = cur.endMs == null ? endMs : Math.max(cur.endMs, endMs)
    }
    acc.set(projId, cur)
  }

  const out: BookedProject[] = []
  for (const proj of projects) {
    const r = acc.get(proj.id)
    if (!r) continue
    if (r.hours <= 0) continue
    if (r.startMs == null || r.endMs == null) continue
    out.push({
      name: proj.name,
      estimatedHours: Math.round(r.hours),
      startMonth: ymKey(new Date(r.startMs)),
      endMonth: ymKey(new Date(r.endMs)),
    })
  }
  // Sort by start month for a stable list rendering.
  out.sort((a, b) => a.startMonth.localeCompare(b.startMonth))
  return out
}
