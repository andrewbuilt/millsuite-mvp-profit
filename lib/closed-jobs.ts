// ============================================================================
// closed-jobs.ts — Phase 10 closed-job detection + per-item actual rollup
// ============================================================================
// A project counts as "closed" when three independent signals all align:
//
//   1. project.stage IN ('installed', 'complete')
//        i.e. the shop has finished building and installing. Sold and
//        production aren't closed yet — the estimate is locked but the job
//        is still in flight.
//
//   2. Every cash_flow_receivables row tied to the project is status='received'.
//        If the project has zero milestone rows we treat it as NOT closed —
//        a $0 project is usually an error state, not a finished job.
//
//   3. No open clock-ins: zero time_entries rows with ended_at IS NULL for
//      the project's subprojects.
//
// For each closed job, we produce a per-item roll up:
//
//     { rate_book_item_id, jobs: [{
//         project_id, subproject_id, estimate_line_id,
//         quantity, estimated_minutes_by_dept, actual_minutes_by_dept
//       }, ...]
//     }
//
// Estimated minutes per dept come from rate_book_items.base_labor_hours_*
// scaled by estimate_lines.quantity. Actual minutes per dept come from
// time_entries on the estimate_line's subproject, proportionally split when
// a sub has multiple lines (MVP: even split — the Phase 8 per-item clock-in
// wasn't shipped). Suggestions.ts consumes the per-item bundles and decides
// which suggestion type (if any) applies.
// ============================================================================

import { supabase } from './supabase'
import type { LaborDept } from './rate-book-seed'

export interface ClosedJobItemRollupJob {
  projectId: string
  projectName: string | null
  subprojectId: string
  estimateLineId: string
  quantity: number
  estimatedMinutesByDept: Record<LaborDept, number>
  actualMinutesByDept: Record<LaborDept, number>
  // Total estimate and actual so the caller can render a compact delta.
  estimatedMinutesTotal: number
  actualMinutesTotal: number
  closedAt: string | null
}

export interface ClosedJobItemRollup {
  rateBookItemId: string
  itemName: string
  unit: string
  // Rate book baseline at scan time (the suggestion compares actuals to this).
  baselineMinutesByDept: Record<LaborDept, number>
  // Per-job evidence rows. Source-job toggles on the suggestion UI flip
  // entries in this list on and off.
  jobs: ClosedJobItemRollupJob[]
}

const DEPTS: LaborDept[] = ['eng', 'cnc', 'assembly', 'finish', 'install']

function zeroDeptMap(): Record<LaborDept, number> {
  return { eng: 0, cnc: 0, assembly: 0, finish: 0, install: 0 }
}

/**
 * Map a department name (from the departments table) to a canonical LaborDept
 * key. Mirrors the same heuristics used in the rollup + subproject-editor
 * pages so the suggestion evidence agrees with what operators already see.
 */
function deptNameToKey(name: string): LaborDept | null {
  const n = name.toLowerCase()
  if (n.includes('eng')) return 'eng'
  if (n.includes('cnc')) return 'cnc'
  if (n.includes('assembly') || n.includes('bench')) return 'assembly'
  if (n.includes('finish') || n.includes('paint') || n.includes('sand')) return 'finish'
  if (n.includes('install')) return 'install'
  return null
}

interface ReceivableRow {
  project_id: string | null
  status: string | null
}

interface ProjectRow {
  id: string
  name: string | null
  stage: string | null
  org_id: string | null
  updated_at?: string | null
}

interface EstimateLineRow {
  id: string
  subproject_id: string | null
  rate_book_item_id: string | null
  quantity: number | null
}

interface SubprojectRow {
  id: string
  project_id: string | null
}

interface TimeEntryRow {
  subproject_id: string | null
  department_id: string | null
  duration_minutes: number | null
  ended_at: string | null
}

interface DepartmentRow {
  id: string
  name: string
}

interface RateBookItemRow {
  id: string
  name: string
  unit: string | null
  base_labor_hours_eng: number | null
  base_labor_hours_cnc: number | null
  base_labor_hours_assembly: number | null
  base_labor_hours_finish: number | null
  base_labor_hours_install: number | null
}

/**
 * Identify closed projects for an org. Returns ids + light metadata, nothing
 * heavy — follow up with loadClosedJobItemRollups() to fan out into evidence.
 */
export async function listClosedProjects(orgId: string): Promise<ProjectRow[]> {
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, name, stage, org_id, updated_at')
    .eq('org_id', orgId)
    .in('stage', ['installed', 'complete'])

  if (error || !projects) return []
  const rows = projects as ProjectRow[]
  if (rows.length === 0) return rows

  const ids = rows.map((r) => r.id)

  // Pull all milestones + all open time entries in two round trips, then
  // filter locally — cheaper than N per-project checks.
  const [{ data: miles }, { data: openTe }] = await Promise.all([
    supabase
      .from('cash_flow_receivables')
      .select('project_id, status')
      .in('project_id', ids),
    supabase
      .from('time_entries')
      .select('project_id, ended_at')
      .in('project_id', ids)
      .is('ended_at', null),
  ])

  const milesByProject: Record<string, ReceivableRow[]> = {}
  for (const row of (miles || []) as ReceivableRow[]) {
    if (!row.project_id) continue
    ;(milesByProject[row.project_id] = milesByProject[row.project_id] || []).push(row)
  }
  const openByProject: Record<string, number> = {}
  for (const row of (openTe || []) as { project_id: string | null }[]) {
    if (!row.project_id) continue
    openByProject[row.project_id] = (openByProject[row.project_id] || 0) + 1
  }

  return rows.filter((p) => {
    const m = milesByProject[p.id] || []
    if (m.length === 0) return false
    if (m.some((r) => r.status !== 'received')) return false
    if ((openByProject[p.id] || 0) > 0) return false
    return true
  })
}

/**
 * Build per-item rollups for every closed job in the org. Groups estimate
 * lines by rate_book_item_id and attaches the per-dept actual/estimate
 * breakdown for each. Unattributed lines (no rate_book_item_id) are skipped
 * — we don't produce suggestions for ad-hoc descriptions.
 */
export async function loadClosedJobItemRollups(
  orgId: string
): Promise<ClosedJobItemRollup[]> {
  const closed = await listClosedProjects(orgId)
  if (closed.length === 0) return []
  const projectIds = closed.map((p) => p.id)
  const projectNameById: Record<string, string | null> = {}
  const projectClosedAt: Record<string, string | null> = {}
  for (const p of closed) {
    projectNameById[p.id] = p.name
    projectClosedAt[p.id] = p.updated_at || null
  }

  // Subprojects for the closed set, so we can later filter time_entries by
  // subproject_id and attribute per-line actuals.
  const { data: subs } = await supabase
    .from('subprojects')
    .select('id, project_id')
    .in('project_id', projectIds)
  const subRows = (subs || []) as SubprojectRow[]
  const subToProject: Record<string, string> = {}
  for (const s of subRows) if (s.project_id) subToProject[s.id] = s.project_id
  const subIds = subRows.map((s) => s.id)
  if (subIds.length === 0) return []

  // All estimate lines with a rate-book link for those subs.
  const { data: lines } = await supabase
    .from('estimate_lines')
    .select('id, subproject_id, rate_book_item_id, quantity')
    .in('subproject_id', subIds)
  const lineRows = ((lines || []) as EstimateLineRow[]).filter(
    (l) => !!l.rate_book_item_id && !!l.subproject_id
  )
  if (lineRows.length === 0) return []

  // Lookup: distinct item ids for the catalog pull.
  const itemIds = Array.from(new Set(lineRows.map((l) => l.rate_book_item_id!)))

  // Time entries on the closed subs — one fetch. We'll split across lines
  // within a sub in a second pass.
  const [{ data: tes }, { data: depts }, { data: items }] = await Promise.all([
    supabase
      .from('time_entries')
      .select('subproject_id, department_id, duration_minutes, ended_at')
      .in('subproject_id', subIds),
    supabase.from('departments').select('id, name').eq('org_id', orgId),
    supabase
      .from('rate_book_items')
      .select(
        'id, name, unit, base_labor_hours_eng, base_labor_hours_cnc, base_labor_hours_assembly, base_labor_hours_finish, base_labor_hours_install'
      )
      .in('id', itemIds),
  ])

  const teRows = (tes || []) as TimeEntryRow[]
  const deptKeyById: Record<string, LaborDept> = {}
  for (const d of (depts || []) as DepartmentRow[]) {
    const k = deptNameToKey(d.name)
    if (k) deptKeyById[d.id] = k
  }

  // Sum actuals per (sub, dept-key).
  const subDeptActuals: Record<string, Record<LaborDept, number>> = {}
  for (const sid of subIds) subDeptActuals[sid] = zeroDeptMap()
  for (const te of teRows) {
    if (!te.subproject_id || !te.department_id) continue
    const bucket = subDeptActuals[te.subproject_id]
    if (!bucket) continue
    const key = deptKeyById[te.department_id]
    if (!key) continue
    bucket[key] = (bucket[key] || 0) + (Number(te.duration_minutes) || 0)
  }

  // Count estimate-line weights per (sub, dept) so we can apportion a sub's
  // actuals across its lines. Weight = line.quantity × item.base_hours_dept.
  // A line with zero weight in a dept gets zero of that dept's actual.
  const itemById: Record<string, RateBookItemRow> = {}
  for (const it of (items || []) as RateBookItemRow[]) itemById[it.id] = it

  const lineWeightTotals: Record<string, Record<LaborDept, number>> = {}
  for (const sid of subIds) lineWeightTotals[sid] = zeroDeptMap()
  const lineWeights: Record<string, Record<LaborDept, number>> = {}
  for (const l of lineRows) {
    const item = itemById[l.rate_book_item_id!]
    if (!item) continue
    const q = Number(l.quantity) || 0
    const w: Record<LaborDept, number> = zeroDeptMap()
    for (const d of DEPTS) {
      const baseKey = (`base_labor_hours_${d}` as const) as keyof RateBookItemRow
      const hrs = Number(item[baseKey]) || 0
      w[d] = hrs * 60 * q // minutes
      lineWeightTotals[l.subproject_id!][d] += w[d]
    }
    lineWeights[l.id] = w
  }

  // Build rollups.
  const rollupByItem: Record<string, ClosedJobItemRollup> = {}
  for (const l of lineRows) {
    const item = itemById[l.rate_book_item_id!]
    if (!item) continue
    const projectId = subToProject[l.subproject_id!]
    if (!projectId) continue
    const w = lineWeights[l.id] || zeroDeptMap()
    const totals = lineWeightTotals[l.subproject_id!]
    const actualsByDept: Record<LaborDept, number> = zeroDeptMap()
    for (const d of DEPTS) {
      const subActual = subDeptActuals[l.subproject_id!]?.[d] || 0
      const total = totals[d] || 0
      actualsByDept[d] = total > 0 ? (w[d] / total) * subActual : 0
    }
    const estimatedByDept: Record<LaborDept, number> = zeroDeptMap()
    for (const d of DEPTS) estimatedByDept[d] = w[d]
    const jobRow: ClosedJobItemRollupJob = {
      projectId,
      projectName: projectNameById[projectId] || null,
      subprojectId: l.subproject_id!,
      estimateLineId: l.id,
      quantity: Number(l.quantity) || 0,
      estimatedMinutesByDept: estimatedByDept,
      actualMinutesByDept: actualsByDept,
      estimatedMinutesTotal: DEPTS.reduce((s, d) => s + estimatedByDept[d], 0),
      actualMinutesTotal: DEPTS.reduce((s, d) => s + actualsByDept[d], 0),
      closedAt: projectClosedAt[projectId] || null,
    }
    if (!rollupByItem[item.id]) {
      const baselineByDept: Record<LaborDept, number> = zeroDeptMap()
      for (const d of DEPTS) {
        const baseKey = (`base_labor_hours_${d}` as const) as keyof RateBookItemRow
        baselineByDept[d] = (Number(item[baseKey]) || 0) * 60
      }
      rollupByItem[item.id] = {
        rateBookItemId: item.id,
        itemName: item.name,
        unit: item.unit || 'ea',
        baselineMinutesByDept: baselineByDept,
        jobs: [],
      }
    }
    rollupByItem[item.id].jobs.push(jobRow)
  }
  return Object.values(rollupByItem)
}
