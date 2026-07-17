// ============================================================================
// lib/worker-time.ts — worker clock-in/out + scheduled jobs (chunk D)
// ============================================================================
// The running timer is a time_entries row with ended_at IS NULL (no separate
// active_timers table). Clock-out stamps ended_at + duration_minutes. One
// active row per worker; clocking in elsewhere closes the current one.
//
// A worker's "scheduled jobs" are the department_allocations for the depts
// they're assigned to (team_members.dept_assignments) in a given week —
// MillSuite schedules at the dept level, not per person.
// ============================================================================

import { supabase } from './supabase'
import { loadShopRateSetup, type TeamMember } from './shop-rate-setup'

export interface TimeEntry {
  id: string
  org_id: string
  user_id: string
  project_id: string
  subproject_id: string | null
  department_id: string | null
  started_at: string | null
  ended_at: string | null
  duration_minutes: number
  notes: string | null
  created_at: string
}

export interface ScheduledJob {
  allocationId: string
  subprojectId: string
  subprojectName: string
  projectId: string
  projectName: string
  departmentId: string
  scheduledDate: string
  estimatedHours: number
  completed: boolean
}

/** The team_members entry linked to this login (user_id bridge), or null. */
export async function loadMyMember(orgId: string, userId: string): Promise<TeamMember | null> {
  const setup = await loadShopRateSetup(orgId)
  return setup.team.find((m) => m.user_id === userId) || null
}

/** The currently-running entry for a worker (ended_at IS NULL), or null. */
export async function loadActiveEntry(userId: string): Promise<TimeEntry | null> {
  const { data } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
    .limit(1)
  return ((data || [])[0] as TimeEntry) || null
}

/** A worker's completed entries between two dates (inclusive), newest first. */
export async function loadEntriesInRange(
  userId: string,
  startISO: string,
  endISO: string,
): Promise<TimeEntry[]> {
  const { data } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .not('ended_at', 'is', null)
    .gte('started_at', `${startISO}T00:00:00`)
    .lte('started_at', `${endISO}T23:59:59`)
    .order('started_at', { ascending: false })
  return (data || []) as TimeEntry[]
}

/** A worker's most recent completed entries (for the History screen). */
export async function loadRecentEntries(userId: string, limit = 30): Promise<TimeEntry[]> {
  const { data } = await supabase
    .from('time_entries')
    .select('*')
    .eq('user_id', userId)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(limit)
  return (data || []) as TimeEntry[]
}

/** Dept-level scheduled jobs for the given depts in [weekStart, weekEnd]. */
export async function loadScheduledJobs(
  deptIds: string[],
  weekStartISO: string,
  weekEndISO: string,
): Promise<ScheduledJob[]> {
  if (deptIds.length === 0) return []
  const { data: allocs } = await supabase
    .from('department_allocations')
    .select('id, subproject_id, department_id, estimated_hours, scheduled_date, completed')
    .in('department_id', deptIds)
    .not('scheduled_date', 'is', null)
    .gte('scheduled_date', weekStartISO)
    .lte('scheduled_date', weekEndISO)
  const rows = (allocs || []) as Array<{
    id: string
    subproject_id: string
    department_id: string
    estimated_hours: number | null
    scheduled_date: string
    completed: boolean | null
  }>
  if (rows.length === 0) return []

  const subIds = Array.from(new Set(rows.map((r) => r.subproject_id).filter(Boolean)))
  const { data: subs } = await supabase
    .from('subprojects')
    .select('id, name, project_id')
    .in('id', subIds)
  const subById = new Map(
    ((subs || []) as Array<{ id: string; name: string; project_id: string }>).map((s) => [s.id, s]),
  )
  const projIds = Array.from(
    new Set(Array.from(subById.values()).map((s) => s.project_id).filter(Boolean)),
  )
  const { data: projs } = await supabase.from('projects').select('id, name').in('id', projIds)
  const projById = new Map(
    ((projs || []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
  )

  return rows.map((r) => {
    const sub = subById.get(r.subproject_id)
    return {
      allocationId: r.id,
      subprojectId: r.subproject_id,
      subprojectName: sub?.name || 'Subproject',
      projectId: sub?.project_id || '',
      projectName: sub ? projById.get(sub.project_id) || 'Project' : 'Project',
      departmentId: r.department_id,
      scheduledDate: r.scheduled_date,
      estimatedHours: Number(r.estimated_hours) || 0,
      completed: !!r.completed,
    }
  })
}

/** Clock in on a job. Closes any currently-running entry first (switch),
 *  then inserts a new running row (ended_at NULL). Returns the new entry. */
export async function clockIn(args: {
  orgId: string
  userId: string
  projectId: string
  subprojectId?: string | null
  departmentId?: string | null
  notes?: string | null
}): Promise<TimeEntry> {
  const active = await loadActiveEntry(args.userId)
  if (active) await clockOut(active)

  const { data, error } = await supabase
    .from('time_entries')
    .insert({
      org_id: args.orgId,
      user_id: args.userId,
      project_id: args.projectId,
      subproject_id: args.subprojectId ?? null,
      department_id: args.departmentId ?? null,
      started_at: new Date().toISOString(),
      ended_at: null,
      duration_minutes: 0,
      notes: args.notes ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as TimeEntry
}

/** Stamp ended_at + duration_minutes on a running entry. */
export async function clockOut(entry: TimeEntry, notes?: string | null): Promise<void> {
  const started = entry.started_at ? new Date(entry.started_at).getTime() : Date.now()
  const minutes = Math.max(0, Math.round((Date.now() - started) / 60000))
  const patch: Record<string, unknown> = {
    ended_at: new Date().toISOString(),
    duration_minutes: minutes,
  }
  if (notes !== undefined) patch.notes = notes
  const { error } = await supabase.from('time_entries').update(patch).eq('id', entry.id)
  if (error) throw error
}

export async function updateEntryMinutes(id: string, minutes: number): Promise<void> {
  const { error } = await supabase
    .from('time_entries')
    .update({ duration_minutes: Math.max(0, Math.round(minutes)) })
    .eq('id', id)
  if (error) throw error
}

export async function deleteEntry(id: string): Promise<void> {
  const { error } = await supabase.from('time_entries').delete().eq('id', id)
  if (error) throw error
}

// ── Week helpers (Mon–Fri) ──

export function mondayOf(d: Date): Date {
  const x = new Date(d)
  const dow = x.getDay() // 0 Sun … 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + diff)
  x.setHours(0, 0, 0, 0)
  return x
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
