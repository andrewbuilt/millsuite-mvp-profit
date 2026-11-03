// ============================================================================
// lib/employee-reviews.ts — reviews + notes/offenses per team member (125)
// ============================================================================
// November item 4. Managers (owner/admin) schedule reviews, write them up
// (doing well / needs improvement / action items) and log dated notes and
// offenses on /team. The employee sees their own on /me.
//
// ⛔ NO BLINDSIDES (Andrew). The RLS in 125 lets a worker read their own rows —
// reviews, action items and the offense log — and nothing else. Nothing here
// hides a row from the person it's about; /me shows offenses as plainly as
// notes. The one presentation call: a review's WRITE-UP shows on /me once it's
// held (before that the employee sees "Review coming up {date}") so they
// aren't reading a half-finished draft.
//
// member_id = the ROSTER id (orgs.team_members[].id), like PTO and capacity.
// author_id = a LOGIN id (users.id). Names come from the roster.
//
// THE REVIEW TASK reuses the auto-task plumbing (createTask, a Today task) —
// there's no scheduler in this app, so it fires LAZILY: whenever a manager
// loads /pm or /team, any review within REVIEW_TASK_LEAD_DAYS of its date
// (or past it, not held) gets its task, once. The once is a conditional stamp
// (`task_fired_at IS NULL` → now) so two managers loading at the same moment
// can't both create it.
// ============================================================================

import { supabase } from './supabase'
import { createTask } from './tasks'
import { formatDateRange } from './auto-tasks'

export const REVIEW_TASK_LEAD_DAYS = 7

export interface EmployeeReview {
  id: string
  org_id: string
  member_id: string
  scheduled_at: string | null
  held_at: string | null
  strengths: string | null
  improvements: string | null
  action_items: string | null
  author_id: string | null
  task_fired_at: string | null
  created_at: string
  updated_at: string
}

export type NoteKind = 'note' | 'offense'

export interface EmployeeNote {
  id: string
  org_id: string
  member_id: string
  kind: NoteKind
  note_date: string
  body: string
  author_id: string | null
  created_at: string
}

const REVIEW_COLS =
  'id, org_id, member_id, scheduled_at, held_at, strengths, improvements, action_items, author_id, task_fired_at, created_at, updated_at'
const NOTE_COLS = 'id, org_id, member_id, kind, note_date, body, author_id, created_at'

const notReady = (msg: string) => /employee_(reviews|notes)|does not exist|schema cache/i.test(msg)

/** Local YYYY-MM-DD (the shop's day, not UTC's). */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return todayISO(new Date(y, m - 1, d + n))
}

/** Is this review's "coming up" task due to fire today? Pure. */
export function reviewTaskDue(r: Pick<EmployeeReview, 'scheduled_at' | 'held_at' | 'task_fired_at'>, today: string): boolean {
  if (!r.scheduled_at || r.held_at || r.task_fired_at) return false
  return addDays(r.scheduled_at, -REVIEW_TASK_LEAD_DAYS) <= today
}

/** The next upcoming (not held) review date for a member, or null. Pure. */
export function nextReviewDate(reviews: EmployeeReview[], today: string): string | null {
  const up = reviews
    .filter((r) => r.scheduled_at && !r.held_at && r.scheduled_at >= today)
    .map((r) => r.scheduled_at as string)
    .sort()
  return up[0] ?? null
}

export async function listReviews(orgId: string, memberId?: string): Promise<EmployeeReview[]> {
  let q = supabase.from('employee_reviews').select(REVIEW_COLS).eq('org_id', orgId)
  if (memberId) q = q.eq('member_id', memberId)
  const { data, error } = await q.order('scheduled_at', { ascending: false, nullsFirst: true })
  if (error) {
    if (notReady(error.message)) return []
    throw new Error(error.message)
  }
  return (data || []) as EmployeeReview[]
}

export async function listNotes(orgId: string, memberId?: string): Promise<EmployeeNote[]> {
  let q = supabase.from('employee_notes').select(NOTE_COLS).eq('org_id', orgId)
  if (memberId) q = q.eq('member_id', memberId)
  const { data, error } = await q.order('note_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) {
    if (notReady(error.message)) return []
    throw new Error(error.message)
  }
  return (data || []) as EmployeeNote[]
}

const writeErr = (msg: string) => (notReady(msg) ? 'Run migration 125 first.' : msg)

export async function scheduleReview(args: { orgId: string; memberId: string; date: string; authorId: string }): Promise<EmployeeReview> {
  const { data, error } = await supabase
    .from('employee_reviews')
    .insert({ org_id: args.orgId, member_id: args.memberId, scheduled_at: args.date, author_id: args.authorId })
    .select(REVIEW_COLS)
    .single()
  if (error) throw new Error(writeErr(error.message))
  return data as EmployeeReview
}

export async function updateReview(
  id: string,
  patch: Partial<Pick<EmployeeReview, 'scheduled_at' | 'held_at' | 'strengths' | 'improvements' | 'action_items'>>,
): Promise<void> {
  const { data, error } = await supabase
    .from('employee_reviews')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) throw new Error(writeErr(error.message))
  if (!data || data.length === 0) throw new Error('Only a manager can change a review.')
}

export async function deleteReview(id: string): Promise<void> {
  const { data, error } = await supabase.from('employee_reviews').delete().eq('id', id).select('id')
  if (error) throw new Error(writeErr(error.message))
  if (!data || data.length === 0) throw new Error('Only a manager can delete a review.')
}

export async function addNote(args: {
  orgId: string
  memberId: string
  kind: NoteKind
  date: string
  body: string
  authorId: string
}): Promise<void> {
  const body = args.body.trim()
  if (!body) throw new Error('Write the note first.')
  const { error } = await supabase.from('employee_notes').insert({
    org_id: args.orgId,
    member_id: args.memberId,
    kind: args.kind,
    note_date: args.date,
    body,
    author_id: args.authorId,
  })
  if (error) throw new Error(writeErr(error.message))
}

export async function deleteNote(id: string): Promise<void> {
  const { data, error } = await supabase.from('employee_notes').delete().eq('id', id).select('id')
  if (error) throw new Error(writeErr(error.message))
  if (!data || data.length === 0) throw new Error('Only a manager can delete a note.')
}

/**
 * Fire every due "review coming up" task, once each. Never throws — the page
 * that calls it is about something else. Returns how many fired.
 */
export async function fireDueReviewTasks(orgId: string): Promise<number> {
  try {
    const today = todayISO()
    const { data, error } = await supabase
      .from('employee_reviews')
      .select('id, member_id, scheduled_at, held_at, task_fired_at, author_id')
      .eq('org_id', orgId)
      .is('task_fired_at', null)
      .is('held_at', null)
      .not('scheduled_at', 'is', null)
    if (error || !data?.length) return 0
    const due = (data as EmployeeReview[]).filter((r) => reviewTaskDue(r, today))
    if (due.length === 0) return 0

    const { data: org } = await supabase.from('orgs').select('team_members').eq('id', orgId).maybeSingle()
    const roster = ((org as { team_members?: unknown } | null)?.team_members as Record<string, unknown>[] | undefined) || []
    const byId = new Map(roster.map((m) => [String(m.id), m]))
    const byLogin = new Map(roster.filter((m) => m.user_id).map((m) => [String(m.user_id), m]))

    let fired = 0
    for (const r of due) {
      // Claim it first: only the caller whose stamp lands creates the task.
      const { data: claimed } = await supabase
        .from('employee_reviews')
        .update({ task_fired_at: new Date().toISOString() })
        .eq('id', r.id)
        .is('task_fired_at', null)
        .select('id')
      if (!claimed?.length) continue
      const author = r.author_id ? byLogin.get(r.author_id) : undefined
      // An author with no roster row can't hold a task; the claim still
      // stands so this doesn't retry on every page load.
      if (!author?.id) continue
      const who = String(byId.get(r.member_id)?.name || 'team member')
      await createTask({
        orgId,
        title: `Review · ${who} · ${formatDateRange(r.scheduled_at as string)}`,
        bucket: 'today',
        assigneeIds: [String(author.id)],
        createdBy: null,
      })
      fired++
    }
    return fired
  } catch (e) {
    console.error('fireDueReviewTasks', e)
    return 0
  }
}
