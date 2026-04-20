// ============================================================================
// actual-hours.ts — read actuals from time_entries (Phase 8)
// ============================================================================
// Three consumers read this file:
//
//   1. /schedule  — to decide whether a subproject is "unstarted" (no time
//      entries yet) and should be labeled as a best-case slot.
//   2. /projects/[id]/rollup — to show actual vs. estimated hours on each
//      sub card + on the project financial panel.
//   3. /projects/[id]/subprojects/[subId] — to show actual vs. estimated
//      hours on the Labor-by-department strip.
//
// All functions batch-fetch by subproject_id so the callers don't N+1.
// department_id is the raw departments.id (org-scoped); the consumer is
// expected to resolve it back to a department row / color / label.
// ============================================================================

import { supabase } from './supabase'

export interface SubActuals {
  subprojectId: string
  totalMinutes: number
  byDeptMinutes: Record<string, number> // departmentId → minutes
  started: boolean // totalMinutes > 0 OR at least one time_entries row exists
  entryCount: number
}

export type SubActualsMap = Record<string, SubActuals>

/**
 * Load per-subproject actual hours for a batch of subproject ids. Missing
 * subs (no rows in time_entries) are still present in the returned map with
 * zeros + started=false — that's the signal used by /schedule to label slots
 * as "best case".
 *
 * Supabase's `in(...)` has a practical limit around 1000 values; we chunk in
 * 500s to be safe. The query is read-only and safe from the browser.
 */
export async function loadSubprojectActualHours(
  subprojectIds: string[]
): Promise<SubActualsMap> {
  const result: SubActualsMap = {}
  // Seed zeros for every requested sub so callers can rely on every id
  // having a row.
  for (const id of subprojectIds) {
    result[id] = {
      subprojectId: id,
      totalMinutes: 0,
      byDeptMinutes: {},
      started: false,
      entryCount: 0,
    }
  }
  if (subprojectIds.length === 0) return result

  const CHUNK = 500
  for (let i = 0; i < subprojectIds.length; i += CHUNK) {
    const batch = subprojectIds.slice(i, i + CHUNK)
    const { data, error } = await supabase
      .from('time_entries')
      .select('subproject_id, department_id, duration_minutes')
      .in('subproject_id', batch)

    if (error || !data) continue

    for (const row of data as Array<{
      subproject_id: string | null
      department_id: string | null
      duration_minutes: number | null
    }>) {
      if (!row.subproject_id) continue
      const bucket = result[row.subproject_id]
      if (!bucket) continue
      const mins = Number(row.duration_minutes) || 0
      bucket.totalMinutes += mins
      bucket.entryCount += 1
      bucket.started = true
      if (row.department_id) {
        bucket.byDeptMinutes[row.department_id] =
          (bucket.byDeptMinutes[row.department_id] || 0) + mins
      }
    }
  }

  return result
}

/**
 * Single-subproject convenience wrapper. Returns the zero-filled record if
 * the sub has no entries.
 */
export async function loadSubprojectActuals(
  subprojectId: string
): Promise<SubActuals> {
  const map = await loadSubprojectActualHours([subprojectId])
  return map[subprojectId]
}

/**
 * Project-level rollup of actuals. Shape mirrors SubActuals but the key is
 * projectId and byDeptMinutes is summed across all subs. Used on the rollup
 * page financial panel.
 */
export interface ProjectActuals {
  projectId: string
  totalMinutes: number
  byDeptMinutes: Record<string, number>
  entryCount: number
}

export async function loadProjectActuals(
  projectId: string
): Promise<ProjectActuals> {
  const acc: ProjectActuals = {
    projectId,
    totalMinutes: 0,
    byDeptMinutes: {},
    entryCount: 0,
  }
  const { data, error } = await supabase
    .from('time_entries')
    .select('department_id, duration_minutes')
    .eq('project_id', projectId)

  if (error || !data) return acc

  for (const row of data as Array<{
    department_id: string | null
    duration_minutes: number | null
  }>) {
    const mins = Number(row.duration_minutes) || 0
    acc.totalMinutes += mins
    acc.entryCount += 1
    if (row.department_id) {
      acc.byDeptMinutes[row.department_id] =
        (acc.byDeptMinutes[row.department_id] || 0) + mins
    }
  }
  return acc
}

/**
 * Format helper shared by UI consumers. Input is minutes, output is hours
 * with one decimal place (e.g. "42.5h") or "0h" when empty.
 */
export function fmtActualHours(minutes: number): string {
  if (!minutes) return '0h'
  return `${(minutes / 60).toFixed(1)}h`
}
