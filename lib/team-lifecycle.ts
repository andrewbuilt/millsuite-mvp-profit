// ============================================================================
// lib/team-lifecycle.ts — add / deactivate / delete, ONE model (Nov batch 2 B)
// ============================================================================
// Andrew: "how do we add and remove?" The answer, enforced here and on /team
// (the ONE place it happens):
//
//   · ADD        — /team "+ Add Member".
//   · DEACTIVATE — the only way out for anyone with history. The roster row
//                  flips active:false, so it leaves every picker, capacity,
//                  task assignees and PTO (each surface filters on
//                  isActiveMember). All history stays attributed — the roster
//                  row and its login link are KEPT, the login is just banned
//                  from signing in (admin API `set_login_disabled`).
//                  Reactivate reverses both.
//   · DELETE     — ONLY for a row with zero history and no login (a typo add).
//                  memberHistory() is the check; /team hides Delete otherwise.
//
// ⛔ The old /team delete removed the roster row AND tried to delete the
// `users` row from the browser — with history attached, that orphaned every
// time entry and task the person ever touched.
// ============================================================================

import { supabase } from './supabase'

/** The one definition of "on the team right now". `active` undefined = yes. */
export function isActiveMember(m: { active?: boolean | null } | null | undefined): boolean {
  return !!m && m.active !== false
}

export interface MemberHistory {
  timeEntries: number
  tasks: number
  ptoRequests: number
  ptoDays: number
  reviews: number
  notes: number
  comments: number
}

export function historyTotal(h: MemberHistory): number {
  return Object.values(h).reduce((a, b) => a + b, 0)
}

/** "12 time entries · 3 tasks" — what Delete would orphan. Pure. */
export function describeHistory(h: MemberHistory): string {
  const parts: string[] = []
  const add = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`)
  }
  add(h.timeEntries, 'time entry', 'time entries')
  add(h.tasks, 'task', 'tasks')
  add(h.ptoRequests, 'PTO request', 'PTO requests')
  add(h.ptoDays, 'PTO day', 'PTO days')
  add(h.reviews, 'review', 'reviews')
  add(h.notes, 'note', 'notes')
  add(h.comments, 'project note', 'project notes')
  return parts.join(' · ')
}

/** Delete is offered only when this is true. Pure. */
export function canHardDelete(member: { user_id?: string | null }, h: MemberHistory | null): boolean {
  return !!h && !member.user_id && historyTotal(h) === 0
}

/**
 * Count everything attributed to a roster member. Roster-id tables match on
 * member.id; login-id tables on member.user_id (when linked). A failed count
 * reads as 1 — unknown history must block Delete, never permit it.
 */
export async function memberHistory(
  orgId: string,
  member: { id: string; user_id?: string | null },
): Promise<MemberHistory> {
  const count = async (q: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count: n, error } = await q
    return error ? 1 : n || 0
  }
  const head = { count: 'exact' as const, head: true }
  const uid = member.user_id || null
  const [timeEntries, tasksAssigned, tasksCreated, ptoRequests, ptoDays, reviews, notes, comments] =
    await Promise.all([
      uid ? count(supabase.from('time_entries').select('id', head).eq('org_id', orgId).eq('user_id', uid)) : 0,
      count(supabase.from('tasks').select('id', head).eq('org_id', orgId).contains('assignee_ids', [member.id])),
      uid ? count(supabase.from('tasks').select('id', head).eq('org_id', orgId).eq('created_by', uid)) : 0,
      count(supabase.from('pto_requests').select('id', head).eq('org_id', orgId).eq('team_member_id', member.id)),
      count(supabase.from('capacity_overrides').select('id', head).eq('org_id', orgId).eq('team_member_id', member.id)),
      count(supabase.from('employee_reviews').select('id', head).eq('org_id', orgId).eq('member_id', member.id)),
      count(supabase.from('employee_notes').select('id', head).eq('org_id', orgId).eq('member_id', member.id)),
      uid ? count(supabase.from('project_comments').select('id', head).eq('org_id', orgId).eq('author_id', uid)) : 0,
    ])
  return {
    timeEntries,
    tasks: tasksAssigned + tasksCreated,
    ptoRequests,
    ptoDays,
    reviews,
    notes,
    comments,
  }
}
