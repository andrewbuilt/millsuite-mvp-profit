// ============================================================================
// lib/eng-board.ts — the engineering board's data layer (/engineering)
// ============================================================================
// ONE data layer, three lenses. This file reads; it adds no hours source:
//   · est eng hours  ← loadProjectsLaborHours(...).eng — the estimate rollup
//                      /capacity books (lib/project-hours)
//   · tracked        ← time_entries in the engineering dept(s) (the clock)
//   · the plan       ← eng_assignments (129): who, order, division, firm date
// /capacity and /schedule are untouched. Packing math is pure, in
// lib/eng-board-math.
// ============================================================================

import { supabase } from './supabase'
import { loadShopRateSetup, memberDailyHours, type TeamMember } from './shop-rate-setup'
import { loadProjectsLaborHours } from './project-hours'
import { loadPracticeProjectIds } from './practice'
import { loadArchivedProjectIds } from './project-archive'
import { loadTempProjectIds } from './temp-projects'
import type { Division } from './eng-board-math'
import { dateKey } from './eng-board-math'

export const ENG_DEPT = 'eng'
/** Stages whose engineering is live work. Archived / lost / complete are out. */
export const BOARD_STAGES = ['sold', 'production']

export interface EngAssignment {
  id: string
  org_id: string
  project_id: string
  member_id: string
  dept: string
  priority: number
  divisions: Division[] | null
  firm_date: string | null
  /** 131 — the strip's budget (total hours incl. tracked). Null = the estimate. */
  board_hours: number | null
  /** 131 — pinned start from a sideways drag. Null = auto-pack. */
  start_date: string | null
  /** 131 — "Engineering done". Set = off the board. */
  done_at: string | null
}

export interface BoardProject {
  id: string
  name: string
  clientName: string | null
  stage: string
  isTemp: boolean
  estHours: number
  /** Minutes of engineering time tracked on this project (any engineer),
   *  running timers included up to now. */
  trackedMinutes: number
}

export interface BoardEngineer {
  member: TeamMember
  dailyHours: number
}

export interface BoardEntry {
  id: string
  user_id: string
  project_id: string
  subproject_id: string | null
  department_id: string | null
  started_at: string | null
  ended_at: string | null
  duration_minutes: number
  created_at: string
  notes: string | null
}

export interface BoardData {
  engDeptIds: string[]
  engineers: BoardEngineer[]
  projects: BoardProject[]
  assignments: EngAssignment[]
  /** Eng entries by the lane engineers in [windowStart, today], plus running. */
  entries: BoardEntry[]
  /** member id → date → hours out (PTO / holidays). */
  outByMember: Record<string, Record<string, number>>
  subsByProject: Record<string, Array<{ id: string; name: string }>>
  /** null = ok; otherwise why the plan can't be read (pre-129). */
  planError: string | null
}

/** Same name heuristic lib/project-hours maps the 'eng' labor key with. */
export function isEngDeptName(name: string): boolean {
  return (name || '').toLowerCase().includes('eng')
}

/** Minutes an entry represents right now (a running one counts to now). */
export function entryMinutes(e: Pick<BoardEntry, 'started_at' | 'ended_at' | 'duration_minutes'>, nowMs = Date.now()): number {
  if (!e.ended_at && e.started_at) return Math.max(0, (nowMs - new Date(e.started_at).getTime()) / 60000)
  return Number(e.duration_minutes) || 0
}

/** Every row of a query, 1000 at a time (PostgREST caps a read at 1000 —
 *  a silently truncated tracked total would make strips look longer). */
async function fetchAllRows(
  page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<{ data: unknown[] }> {
  const out: unknown[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return { data: out }
}

export async function loadEngBoard(orgId: string, windowStart: string, horizonEnd: string): Promise<BoardData> {
  const [{ data: depts }, { data: projs }, setup, practice, archived, temp, planRes] = await Promise.all([
    supabase.from('departments').select('id, name, active').eq('org_id', orgId),
    supabase.from('projects').select('id, name, client_name, stage').eq('org_id', orgId).in('stage', BOARD_STAGES),
    loadShopRateSetup(orgId),
    loadPracticeProjectIds(orgId),
    loadArchivedProjectIds(orgId),
    loadTempProjectIds(orgId),
    supabase.from('eng_assignments').select('*').eq('org_id', orgId).eq('dept', ENG_DEPT),
  ])

  const engDeptIds = ((depts || []) as Array<{ id: string; name: string; active: boolean | null }>)
    .filter((d) => d.active !== false && isEngDeptName(d.name))
    .map((d) => d.id)
  const engSet = new Set(engDeptIds)

  const engineers: BoardEngineer[] = (setup.team || [])
    .filter((m) => m.active !== false && (m.dept_assignments || []).some((d) => engSet.has(d)))
    .map((m) => ({ member: m, dailyHours: memberDailyHours(m) }))
    .sort((a, b) => a.member.name.localeCompare(b.member.name))

  const kept = ((projs || []) as Array<{ id: string; name: string; client_name: string | null; stage: string }>)
    .filter((p) => !practice.has(p.id) && !archived.has(p.id))
  const ids = kept.map((p) => p.id)

  const planError = planRes.error
    ? String((planRes.error as { code?: string }).code) === '42P01' || /eng_assignments/.test(planRes.error.message || '')
      ? 'The engineering board needs migration 129 (eng_assignments) on this database.'
      : planRes.error.message
    : null
  const assignments = ((planRes.data || []) as EngAssignment[]).map((a) => ({
    ...a,
    priority: Number(a.priority) || 0,
    divisions: Array.isArray(a.divisions) ? a.divisions : null,
    // Pre-131 the columns are absent → null → v1 behaviour.
    board_hours: a.board_hours != null && a.board_hours !== ('' as unknown) ? Number(a.board_hours) : null,
    start_date: a.start_date ?? null,
    done_at: a.done_at ?? null,
  }))

  const userIds = engineers.map((e) => e.member.user_id).filter(Boolean) as string[]
  const [hours, trackedRes, windowRes, runningRes, overridesRes, subsRes] = await Promise.all([
    loadProjectsLaborHours(orgId, ids),
    ids.length && engDeptIds.length
      ? fetchAllRows((from, to) => supabase.from('time_entries').select('project_id, started_at, ended_at, duration_minutes')
          .eq('org_id', orgId).in('department_id', engDeptIds).in('project_id', ids).order('id').range(from, to))
      : Promise.resolve({ data: [] }),
    userIds.length && engDeptIds.length
      ? supabase.from('time_entries').select('id, user_id, project_id, subproject_id, department_id, started_at, ended_at, duration_minutes, created_at, notes')
          .eq('org_id', orgId).in('user_id', userIds).in('department_id', engDeptIds)
          .gte('started_at', `${windowStart}T00:00:00`).order('started_at', { ascending: true })
      : Promise.resolve({ data: [] }),
    // Any running timer for a lane engineer, whatever dept — the strip modal
    // must say "Hunter is on X" even when X isn't engineering.
    userIds.length
      ? supabase.from('time_entries').select('id, user_id, project_id, subproject_id, department_id, started_at, ended_at, duration_minutes, created_at, notes')
          .in('user_id', userIds).is('ended_at', null)
      : Promise.resolve({ data: [] }),
    supabase.from('capacity_overrides').select('override_date, team_member_id, department_id, reason, hours_reduction')
      .eq('org_id', orgId).gte('override_date', windowStart).lte('override_date', horizonEnd),
    ids.length
      ? supabase.from('subprojects').select('id, name, project_id, sort_order').in('project_id', ids).order('sort_order')
      : Promise.resolve({ data: [] }),
  ])

  const now = Date.now()
  const trackedByProject: Record<string, number> = {}
  for (const r of (trackedRes.data || []) as Array<{ project_id: string; started_at: string | null; ended_at: string | null; duration_minutes: number }>) {
    trackedByProject[r.project_id] = (trackedByProject[r.project_id] || 0) + entryMinutes(r, now)
  }

  const projects: BoardProject[] = kept.map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    stage: p.stage,
    isTemp: temp.has(p.id),
    estHours: hours[p.id]?.byDept.eng || 0,
    trackedMinutes: trackedByProject[p.id] || 0,
  }))

  // Window entries + running entries, de-duplicated.
  const seen = new Set<string>()
  const entries: BoardEntry[] = []
  for (const e of [...((windowRes.data || []) as BoardEntry[]), ...((runningRes.data || []) as BoardEntry[])]) {
    if (seen.has(e.id)) continue
    seen.add(e.id)
    entries.push(e)
  }

  // Day-off map per engineer. Company holiday (no member, no dept) or an
  // engineering-dept holiday = the whole day; a member's own PTO row = its
  // hours (0 → the whole day). "Reassigned to …" rows move people, skip.
  const outByMember: Record<string, Record<string, number>> = {}
  for (const eng of engineers) outByMember[eng.member.id] = {}
  for (const ov of (overridesRes.data || []) as Array<{ override_date: string; team_member_id: string | null; department_id: string | null; reason: string | null; hours_reduction: number | null }>) {
    if (ov.reason?.startsWith('Reassigned to')) continue
    for (const eng of engineers) {
      const map = outByMember[eng.member.id]
      const day = ov.override_date
      if (ov.team_member_id) {
        if (ov.team_member_id !== eng.member.id) continue
        const raw = Number(ov.hours_reduction) || 0
        map[day] = Math.min(eng.dailyHours, (map[day] || 0) + (raw > 0 ? raw : eng.dailyHours))
      } else if (!ov.department_id || engSet.has(ov.department_id)) {
        map[day] = eng.dailyHours
      }
    }
  }

  const subsByProject: Record<string, Array<{ id: string; name: string }>> = {}
  for (const s of (subsRes.data || []) as Array<{ id: string; name: string; project_id: string }>) {
    ;(subsByProject[s.project_id] ||= []).push({ id: s.id, name: s.name })
  }

  return { engDeptIds, engineers, projects, assignments, entries, outByMember, subsByProject, planError }
}

/** Local-day key of an entry (started_at, else created_at). */
export function entryDay(e: Pick<BoardEntry, 'started_at' | 'created_at'>): string {
  return dateKey(new Date(e.started_at || e.created_at))
}

// ── Writes ──

export async function assignProject(args: { orgId: string; projectId: string; memberId: string; priority: number; boardHours?: number | null }): Promise<void> {
  const { error } = await supabase.from('eng_assignments').upsert(
    {
      org_id: args.orgId,
      project_id: args.projectId,
      member_id: args.memberId,
      dept: ENG_DEPT,
      priority: args.priority,
      // Only sent when a budget was broken out, so a plain drag still works
      // on a pre-131 database.
      ...(args.boardHours != null ? { board_hours: args.boardHours } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'project_id,dept' },
  )
  if (error) throw error
}

export async function updateAssignment(
  id: string,
  patch: AssignmentPatch,
): Promise<void> {
  const { data, error } = await supabase
    .from('eng_assignments')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('That change didn’t save.')
}

export type AssignmentPatch = Partial<
  Pick<EngAssignment, 'member_id' | 'priority' | 'divisions' | 'firm_date' | 'board_hours' | 'start_date' | 'done_at'>
>

/** "Engineering done" (or undo) — the only way a strip leaves the board.
 *  Logs a project_events row so the timeline says who called it and when. */
export async function setEngineeringDone(args: { orgId: string; assignmentId: string; projectId: string; done: boolean; trackedHours: number }): Promise<void> {
  await updateAssignment(args.assignmentId, { done_at: args.done ? new Date().toISOString() : null })
  const { recordProjectEvent } = await import('./project-events')
  await recordProjectEvent({
    orgId: args.orgId,
    projectId: args.projectId,
    eventType: args.done ? 'engineering_done' : 'engineering_reopened',
    label: args.done ? 'Engineering done' : 'Engineering reopened',
    meta: { tracked_hours: Math.round(args.trackedHours * 10) / 10 },
  })
}

export async function unassignProject(id: string): Promise<void> {
  const { error } = await supabase.from('eng_assignments').delete().eq('id', id)
  if (error) throw error
}
