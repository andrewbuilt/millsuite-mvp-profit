// ============================================================================
// lib/schedule-seed.ts — seed department_allocations on auto-advance
// ============================================================================
// Fans out one allocation row per (subproject × department) for every dept
// with non-zero hours, then runs lib/schedule-engine.autoPlace to land each
// row on the next available slot. Idempotent: if any allocations already
// exist for the project's subprojects, the seed bails before touching
// anything.
//
// Hours sources, summed per dept:
//   - estimate_lines: computeLineBuildup → hoursByDept (qty already applied)
//   - install dept: + computeInstallHours from the subproject install
//                   prefill (subprojects.install_*). Rare on legacy line-
//                   driven installs; near-universal on composer flow.
//
// Placement reads existing scheduled blocks across the entire org so the
// new rows don't double-book completed-but-not-yet-installed work or
// blocks on other production projects. Headcount is read off
// department_members the same way the schedule page builds DeptConfig.
// ============================================================================

import { supabase } from './supabase'
import {
  loadEstimateLines,
  loadRateBook,
  computeLineBuildup,
} from './estimate-lines'
import type { LaborDept } from './rate-book-seed'
import { computeInstallHours } from './install-prefill'
import {
  autoPlace,
  buildDeptConfig,
  deptConfigToCapacity,
  type Allocation as ScheduleAllocation,
  type DeptConfig,
  type DeptKey,
  type PlacedBlock,
  type ScheduleProject,
  type ScheduleSub,
} from './schedule-engine'

// LaborDept keys ('eng' …) come off computeLineBuildup; the schedule engine
// uses long-form DeptKey ('engineering' …). Single source of mapping here.
const LABOR_TO_SCHEDULE_DEPT: Record<LaborDept, DeptKey> = {
  eng: 'engineering',
  cnc: 'cnc',
  assembly: 'assembly',
  finish: 'finish',
  install: 'install',
}

/** Map a DB department name to the engine's canonical key. Mirrors the
 *  matching the schedule page uses (PROD_ORDER), kept in sync by hand —
 *  small enough that abstraction would obscure more than it helps. */
function canonicalDeptKey(name: string): DeptKey | null {
  const n = (name || '').toLowerCase()
  if (n.includes('management')) return null
  if (n.includes('eng')) return 'engineering'
  if (n.includes('cnc')) return 'cnc'
  if (n.includes('assembly') || n.includes('bench')) return 'assembly'
  if (n.includes('finish') || n.includes('paint') || n.includes('sand')) return 'finish'
  if (n.includes('install')) return 'install'
  return null
}

export async function seedAllocationsForProduction(projectId: string): Promise<void> {
  const { data: projectRow } = await supabase
    .from('projects')
    .select('id, org_id, name, due_date')
    .eq('id', projectId)
    .single()
  if (!projectRow) return
  const project = projectRow as {
    id: string
    org_id: string
    name: string
    due_date: string | null
  }
  const orgId = project.org_id

  const { data: subRowsRaw } = await supabase
    .from('subprojects')
    .select(
      'id, name, sort_order, install_guys, install_days, install_complexity_pct',
    )
    .eq('project_id', projectId)
    .order('sort_order')
  const subRows = (subRowsRaw || []) as Array<{
    id: string
    name: string
    sort_order: number | null
    install_guys: number | null
    install_days: number | null
    install_complexity_pct: number | null
  }>
  if (subRows.length === 0) return
  const subIds = subRows.map((s) => s.id)

  // Idempotency: if anything is already allocated against this project's
  // subprojects, treat the seed as already done. The operator may have
  // hand-rolled an allocation, or maybeAdvanceToProduction may have fired
  // twice through different call sites — either way, don't overwrite.
  const { data: existing } = await supabase
    .from('department_allocations')
    .select('id')
    .in('subproject_id', subIds)
    .limit(1)
  if (existing && existing.length > 0) return

  const { data: deptRowsRaw } = await supabase
    .from('departments')
    .select('id, name')
    .eq('org_id', orgId)
    .eq('active', true)
  const deptRows = (deptRowsRaw || []) as Array<{ id: string; name: string }>
  if (deptRows.length === 0) return

  const deptIdToKey = new Map<string, DeptKey>()
  const deptKeyToId = new Map<DeptKey, string>()
  for (const d of deptRows) {
    const k = canonicalDeptKey(d.name)
    if (!k) continue
    deptIdToKey.set(d.id, k)
    // First match wins so seed-time picks the same row the schedule page
    // already prefers when more than one dept matches a canonical key.
    if (!deptKeyToId.has(k)) deptKeyToId.set(k, d.id)
  }
  if (deptKeyToId.size === 0) return

  const { data: members } = await supabase
    .from('department_members')
    .select('user_id, department_id')
    .eq('org_id', orgId)
  const headcountById: Record<string, number> = {}
  for (const m of (members || []) as Array<{ department_id: string }>) {
    headcountById[m.department_id] = (headcountById[m.department_id] || 0) + 1
  }

  const config: DeptConfig = buildDeptConfig(
    Array.from(deptKeyToId.entries()).map(([key, id]) => ({
      key,
      headcount: Math.max(1, headcountById[id] || 1),
    })),
  )

  // Compute hours per (sub, dept). Pricing context doesn't affect the
  // hoursByDept output — the rollup multiplies hours × shopRate to get $,
  // but we're only reading the hours half. Pass zeros to keep the pure
  // function happy.
  const rateBook = await loadRateBook(orgId)
  const ctx = { shopRate: 0, consumableMarkupPct: 0, profitMarginPct: 0 }

  const inserts: Array<{
    subproject_id: string
    department_id: string
    estimated_hours: number
    scheduled_date: null
    crew_size: null
    completed: boolean
  }> = []

  for (const sub of subRows) {
    const lines = await loadEstimateLines(sub.id)
    const hoursByLaborDept: Record<LaborDept, number> = {
      eng: 0,
      cnc: 0,
      assembly: 0,
      finish: 0,
      install: 0,
    }
    for (const line of lines) {
      const item = line.rate_book_item_id
        ? rateBook.itemsById.get(line.rate_book_item_id) ?? null
        : null
      const buildup = computeLineBuildup(line, item, [], ctx)
      hoursByLaborDept.eng += buildup.hoursByDept.eng
      hoursByLaborDept.cnc += buildup.hoursByDept.cnc
      hoursByLaborDept.assembly += buildup.hoursByDept.assembly
      hoursByLaborDept.finish += buildup.hoursByDept.finish
      hoursByLaborDept.install += buildup.hoursByDept.install
    }
    // Subproject-level install prefill (composer flow). Most install
    // labor on millwork projects flows in here, not through estimate
    // lines.
    hoursByLaborDept.install += computeInstallHours({
      guys: sub.install_guys,
      days: sub.install_days,
      complexityPct: sub.install_complexity_pct,
    })

    for (const ld of ['eng', 'cnc', 'assembly', 'finish', 'install'] as LaborDept[]) {
      const hrs = hoursByLaborDept[ld]
      if (hrs <= 0) continue
      const dk = LABOR_TO_SCHEDULE_DEPT[ld]
      const deptId = deptKeyToId.get(dk)
      if (!deptId) continue
      inserts.push({
        subproject_id: sub.id,
        department_id: deptId,
        estimated_hours: hrs,
        scheduled_date: null,
        crew_size: null,
        completed: false,
      })
    }
  }

  if (inserts.length === 0) return

  const { data: insertedRows, error: insErr } = await supabase
    .from('department_allocations')
    .insert(inserts)
    .select(
      'id, subproject_id, department_id, scheduled_date, scheduled_days, estimated_hours, actual_hours, completed, crew_size',
    )
  if (insErr || !insertedRows) {
    console.error('seedAllocationsForProduction insert', insErr)
    return
  }

  const projectAllocs: ScheduleAllocation[] = (insertedRows as Array<{
    id: string
    subproject_id: string
    department_id: string
    scheduled_date: string | null
    scheduled_days: number | null
    estimated_hours: number | string
    actual_hours: number | string | null
    completed: boolean
    crew_size: number | null
  }>)
    .map((r) => {
      const dk = deptIdToKey.get(r.department_id)
      if (!dk) return null
      return {
        id: r.id,
        subproject_id: r.subproject_id,
        department_id: r.department_id,
        dept_key: dk,
        scheduled_date: r.scheduled_date,
        scheduled_days: r.scheduled_days,
        estimated_hours: Number(r.estimated_hours) || 0,
        actual_hours: Number(r.actual_hours) || 0,
        completed: !!r.completed,
        crew_size: r.crew_size,
      } satisfies ScheduleAllocation
    })
    .filter((a): a is ScheduleAllocation => a !== null)

  if (projectAllocs.length === 0) return

  const existingBlocks = await loadOrgPlacedBlocks(orgId, deptIdToKey, config)

  const scheduleProject: ScheduleProject = {
    id: project.id,
    name: project.name,
    client: '',
    color: '#94A3B8',
    priority: 'medium',
    due: project.due_date,
    status: 'production',
  }
  const scheduleSubs: ScheduleSub[] = subRows.map((s) => ({
    id: s.id,
    name: s.name,
    project_id: project.id,
    sub_due_date: null,
    schedule_order: s.sort_order ?? 0,
  }))

  const capacity = deptConfigToCapacity(config)
  const placement = autoPlace(
    scheduleProject,
    scheduleSubs,
    projectAllocs,
    existingBlocks,
    capacity,
    config,
  )

  // Persist scheduled_date / scheduled_days / crew_size for each placed
  // allocation. Sequential — projects have tens of rows at most, and a
  // single batch update isn't expressible in the supabase-js builder for
  // per-row values.
  for (const u of placement.updates) {
    const { error } = await supabase
      .from('department_allocations')
      .update({
        scheduled_date: u.scheduled_date,
        scheduled_days: u.scheduled_days,
        crew_size: u.crew_size,
      })
      .eq('id', u.id)
    if (error) {
      console.error('seedAllocationsForProduction update', u.id, error)
    }
  }
}

/**
 * Load every placed (non-null scheduled_date, not completed) allocation
 * across the org and shape them into PlacedBlock for autoPlace's collision
 * detection. Project / sub names aren't used by buildSlotMap, but we keep
 * them populated so the return value is the same shape the schedule page
 * builds via lib/schedule-engine.buildBlocks.
 */
async function loadOrgPlacedBlocks(
  orgId: string,
  deptIdToKey: Map<string, DeptKey>,
  config: DeptConfig,
): Promise<PlacedBlock[]> {
  const { data: projs } = await supabase
    .from('projects')
    .select('id')
    .eq('org_id', orgId)
  const projIds = ((projs || []) as Array<{ id: string }>).map((p) => p.id)
  if (projIds.length === 0) return []

  const { data: subs } = await supabase
    .from('subprojects')
    .select('id, project_id, name')
    .in('project_id', projIds)
  const subRows = (subs || []) as Array<{ id: string; project_id: string; name: string }>
  if (subRows.length === 0) return []
  const subIds = subRows.map((s) => s.id)
  const subById = new Map(subRows.map((s) => [s.id, s]))

  const { data: allocs } = await supabase
    .from('department_allocations')
    .select(
      'id, subproject_id, department_id, scheduled_date, scheduled_days, estimated_hours, crew_size, completed',
    )
    .in('subproject_id', subIds)
    .not('scheduled_date', 'is', null)
    .eq('completed', false)
  const allocRows = (allocs || []) as Array<{
    id: string
    subproject_id: string
    department_id: string
    scheduled_date: string
    scheduled_days: number | null
    estimated_hours: number | string
    crew_size: number | null
    completed: boolean
  }>

  const blocks: PlacedBlock[] = []
  for (const a of allocRows) {
    const dk = deptIdToKey.get(a.department_id)
    if (!dk) continue
    const sub = subById.get(a.subproject_id)
    if (!sub) continue
    const crew = a.crew_size && a.crew_size > 0
      ? a.crew_size
      : config[dk]?.defaultCrewSize || 2
    const hpp = config[dk]?.hoursPerPerson || 8
    const hours = Number(a.estimated_hours) || 0
    const days =
      a.scheduled_days || Math.max(1, Math.ceil(hours / (crew * hpp)))
    blocks.push({
      allocationId: a.id,
      projectId: sub.project_id,
      subId: a.subproject_id,
      subName: sub.name,
      projectName: '',
      projectColor: '#94A3B8',
      dept: dk,
      startDate: a.scheduled_date,
      days,
      hours,
      crewSize: crew,
      progress: 0,
      completed: false,
      manuallyMoved: false,
    })
  }
  return blocks
}
