// ============================================================================
// actual-hours.ts — read actuals from time_entries (Phase 8)
// ============================================================================
// Two consumers read this file:
//
//   1. /projects/[id]/rollup — to show actual vs. estimated hours on each
//      sub card + on the project financial panel.
//   2. /projects/[id]/subprojects/[subId] — to show actual vs. estimated
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
  entryCount: number
}

export type SubActualsMap = Record<string, SubActuals>

/**
 * Load per-subproject actual hours for a batch of subproject ids. Missing
 * subs (no rows in time_entries) are still present in the returned map with
 * zeros so callers can rely on every id having a bucket.
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
 * THE formatter for TRACKED time. Input is minutes, output is "2h 34m".
 *
 * Tracked time is a measurement, so it now reads as one: `2h 34m`, not `2.6h`.
 * The arithmetic was always minute-level (`duration_minutes`; `clockOut`
 * rounds to the minute) — only the DISPLAY rounded, which is what made a
 * recorded shift look approximate. Wave-3 item 2.
 *
 * ⛔ TRACKED time only. ESTIMATED hours stay decimal (`hoursFmt` / `fmtHours`)
 * and must not be routed through here: an estimate of 2.5h is a judgement, and
 * "2h 30m" claims a precision nobody has. The two reading as visibly different
 * formats is useful — you can tell measured from guessed at a glance.
 *
 * Minutes are rounded before splitting: rollups divide and re-accumulate, so a
 * fractional total is reachable and "2h 34.6m" would be nonsense.
 *
 * This is now the ONLY tracked-time formatter. `/me` (hoursLabel) and `/time`
 * (formatHours) each had their own, which is how they drifted to three
 * different renderings of the same minutes.
 */
export function fmtActualHours(minutes: number): string {
  const total = Math.round(Number(minutes) || 0)
  // Zero means "nothing tracked" — "0h" says that better than "0m".
  if (total <= 0) return '0h'
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
