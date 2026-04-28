// ============================================================================
// lib/capacity-seed.ts — auto-seed project_month_allocations from schedule
// ============================================================================
// The schedule timeline places every production project's
// department_allocations row on a specific scheduled_date. This helper
// aggregates those into monthly buckets and writes them as
// source='auto' rows on project_month_allocations so the /capacity
// calendar reflects production work without a manual drag.
//
// Operator placements (source='manual') always win. The auto pass:
//   - inserts an auto row for any month with schedule hours and no
//     existing row for this project
//   - updates an existing auto row's hours_allocated + department_hours
//     when totals shift
//   - skips months that have a manual row (preserves operator pinning)
//   - deletes auto rows that no longer have a matching schedule month
//     (so re-scheduling out of a month doesn't leave a phantom auto
//     placement)
//
// Hours-by-month math: each department_allocations row carries
// scheduled_date + scheduled_days. When a row spans into the next
// month, hours are split proportionally by working-day count.
// ============================================================================

import { supabase } from './supabase'

interface DeptAllocationRow {
  subproject_id: string
  department_id: string
  scheduled_date: string | null
  scheduled_days: number | null
  estimated_hours: number | string | null
}

interface PmaRow {
  id: string
  month_date: string
  source: 'auto' | 'manual'
}

/** Count Mon–Fri days in [startISO, startISO + days). */
function workingDaysSpanning(startISO: string, days: number): Array<{ date: Date; ym: string }> {
  const out: Array<{ date: Date; ym: string }> = []
  const start = new Date(startISO + 'T12:00:00Z')
  if (isNaN(start.getTime())) return out
  for (let i = 0; i < days; i++) {
    const d = new Date(start)
    d.setUTCDate(d.getUTCDate() + i)
    const dow = d.getUTCDay()
    if (dow === 0 || dow === 6) continue
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    out.push({ date: d, ym })
  }
  return out
}

/**
 * Aggregate a project's scheduled department_allocations by calendar
 * month and reconcile project_month_allocations. Manual rows are
 * preserved; auto rows are created / updated / pruned to match. Returns
 * the total number of auto rows touched (insert + update + delete).
 *
 * Best-effort: errors on individual writes log and continue. Caller
 * should treat the return as a hint, not a hard count.
 */
export async function autoSeedProjectMonthAllocations(
  orgId: string,
  projectId: string,
): Promise<number> {
  if (!orgId || !projectId) return 0

  // Subprojects for this project — auto-seed is project-scoped.
  const { data: subRows } = await supabase
    .from('subprojects')
    .select('id')
    .eq('project_id', projectId)
  const subIds = ((subRows || []) as Array<{ id: string }>).map((s) => s.id)
  if (subIds.length === 0) {
    // Nothing to seed; also clean up any stale auto rows so we don't
    // leave phantom placements when a project's subprojects get pruned.
    await deleteAutoRows(projectId, [])
    return 0
  }

  // Schedule rows. Only placed (scheduled_date NOT NULL) and not
  // completed contribute — completed work doesn't compete for capacity.
  const { data: allocRows } = await supabase
    .from('department_allocations')
    .select('subproject_id, department_id, scheduled_date, scheduled_days, estimated_hours')
    .in('subproject_id', subIds)
    .not('scheduled_date', 'is', null)
    .eq('completed', false)
  const allocs = (allocRows || []) as DeptAllocationRow[]

  // Aggregate hours per month, plus per-(month, dept) for the
  // department_hours jsonb the /capacity calendar reads.
  const monthHours: Record<string, number> = {}
  const monthDeptHours: Record<string, Record<string, number>> = {}
  for (const a of allocs) {
    if (!a.scheduled_date) continue
    const hours = Number(a.estimated_hours) || 0
    if (hours <= 0) continue
    const days = Math.max(1, Number(a.scheduled_days) || 1)
    const span = workingDaysSpanning(a.scheduled_date, days)
    if (span.length === 0) continue
    // Distribute hours proportionally across the working days the
    // block spans. A block that crosses a month boundary fairly
    // shares hours between months — common case is a 5-day block
    // landing on Mon-Fri inside a single month, where everything
    // collapses back to one bucket.
    const hoursPerWorkingDay = hours / span.length
    for (const day of span) {
      monthHours[day.ym] = (monthHours[day.ym] || 0) + hoursPerWorkingDay
      const byDept = monthDeptHours[day.ym] || {}
      byDept[a.department_id] = (byDept[a.department_id] || 0) + hoursPerWorkingDay
      monthDeptHours[day.ym] = byDept
    }
  }

  // Reconcile against existing project_month_allocations.
  const { data: existingRows } = await supabase
    .from('project_month_allocations')
    .select('id, month_date, source')
    .eq('project_id', projectId)
  const existing = (existingRows || []) as PmaRow[]
  const manualMonths = new Set(
    existing.filter((r) => r.source === 'manual').map((r) => r.month_date.slice(0, 7)),
  )
  const autoByMonth = new Map<string, PmaRow>()
  for (const r of existing) {
    if (r.source === 'auto') autoByMonth.set(r.month_date.slice(0, 7), r)
  }

  let touched = 0

  // Upsert / insert for every month with schedule hours that isn't
  // pinned manually.
  for (const ym of Object.keys(monthHours)) {
    if (manualMonths.has(ym)) continue
    const monthDate = `${ym}-01`
    const totalHours = Math.round(monthHours[ym])
    if (totalHours <= 0) continue
    const deptHours = roundDeptHours(monthDeptHours[ym] || {})
    const existingAuto = autoByMonth.get(ym)
    if (existingAuto) {
      const { error } = await supabase
        .from('project_month_allocations')
        .update({
          hours_allocated: totalHours,
          department_hours: Object.keys(deptHours).length > 0 ? deptHours : null,
        })
        .eq('id', existingAuto.id)
      if (error) {
        console.warn('autoSeedProjectMonthAllocations update', error)
      } else {
        touched++
      }
    } else {
      const { error } = await supabase.from('project_month_allocations').insert({
        org_id: orgId,
        project_id: projectId,
        month_date: monthDate,
        hours_allocated: totalHours,
        department_hours: Object.keys(deptHours).length > 0 ? deptHours : null,
        source: 'auto',
      })
      if (error) {
        console.warn('autoSeedProjectMonthAllocations insert', error)
      } else {
        touched++
      }
    }
    autoByMonth.delete(ym)
  }

  // Delete auto rows for months no longer in the schedule.
  const stale = Array.from(autoByMonth.values()).map((r) => r.id)
  if (stale.length > 0) {
    const { error } = await supabase
      .from('project_month_allocations')
      .delete()
      .in('id', stale)
    if (!error) touched += stale.length
  }

  return touched
}

/** Round each per-dept hour to the nearest integer; drop zeros. */
function roundDeptHours(map: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(map)) {
    const r = Math.round(v)
    if (r > 0) out[k] = r
  }
  return out
}

/** Delete all auto rows for a project not in keepMonths (YYYY-MM). */
async function deleteAutoRows(projectId: string, keepMonths: string[]): Promise<void> {
  const { data: rows } = await supabase
    .from('project_month_allocations')
    .select('id, month_date')
    .eq('project_id', projectId)
    .eq('source', 'auto')
  const list = (rows || []) as Array<{ id: string; month_date: string }>
  const keep = new Set(keepMonths)
  const drop = list.filter((r) => !keep.has(r.month_date.slice(0, 7))).map((r) => r.id)
  if (drop.length === 0) return
  await supabase.from('project_month_allocations').delete().in('id', drop)
}
