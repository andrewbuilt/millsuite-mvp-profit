// ============================================================================
// lib/tasks.ts — the shared action list (Task system v1, migration 093)
// ============================================================================
// Replaces the "BUILT Master Action List" sheet. Read the migration header for
// why the shape is what it is; the short version:
//
//   · Buckets are a CURATED list, not a calendar. Nothing in here ages a task
//     automatically — a stale Today item stays in Today until someone moves
//     it. That daily pass is the process, and quietly rolling items would take
//     it away from them.
//   · One shared list. Any manager/owner edits anything, same as the sheet.
//   · Tasks may have no project (the sheet's plain TASK rows).
//
// Browser writes are legitimate here — `tasks` has a FOR ALL org policy (093),
// unlike `orgs`/`users`. But every write still asks for the row back and
// treats zero rows as failure: PostgREST answers `{ error: null }` for an
// update that matched nothing, so without the guard an RLS-blocked write looks
// exactly like success. Same pattern as `updateProjectName`.
// ============================================================================

import { supabase } from './supabase'

export const TASK_BUCKETS = ['today', 'this_week', 'next_week', 'someday'] as const
export type TaskBucket = (typeof TASK_BUCKETS)[number]

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  today: 'Today',
  this_week: 'This week',
  next_week: 'Next week',
  someday: 'Someday',
}

/** How long a completed task stays visible in the collapsed Done section.
 *  Long enough to undo a mistake, short enough that Done never becomes a
 *  graveyard nobody reads. */
export const DONE_VISIBLE_DAYS = 7

export interface Task {
  id: string
  org_id: string
  project_id: string | null
  title: string
  bucket: TaskBucket
  assignee_ids: string[]
  done_at: string | null
  created_by: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TaskComment {
  id: string
  task_id: string
  author_user_id: string | null
  body: string
  created_at: string
}

/** Someone on the team who can be given a task.
 *
 *  ⛔ This is the ROSTER (`orgs.team_members`), not the login table. The sheet
 *  assigned work to PEOPLE — most of the shop floor has no MillSuite login,
 *  and the first version of this read `users` and additionally dropped
 *  workers, so Andrew opened the panel and found he couldn't give Hunter a
 *  task at all. `assignee_ids` therefore holds team_member ids.
 *
 *  `userId` is carried so "Mine" can resolve the signed-in user to their
 *  roster entry; it's null for anyone without a login, which is fine — they
 *  can be assigned, they just can't open the app to see it yet. */
export interface TaskAssignee {
  id: string
  name: string
  /** users.id when this person has a login, else null. */
  userId: string | null
  /** Whether to OFFER this person in a picker ("Gets tasks" on /team).
   *  The list still includes people who are off, because a task assigned
   *  before they were switched off must still render their NAME rather than
   *  "Unknown" — filter on this for pickers, not for name lookup. */
  tasksEnabled: boolean
}

const TASK_COLUMNS =
  'id, org_id, project_id, title, bucket, assignee_ids, done_at, created_by, sort_order, created_at, updated_at'

function normalizeTask(r: any): Task {
  return {
    id: r.id,
    org_id: r.org_id,
    project_id: r.project_id ?? null,
    title: r.title ?? '',
    bucket: (TASK_BUCKETS as readonly string[]).includes(r.bucket)
      ? (r.bucket as TaskBucket)
      : 'today',
    // jsonb comes back as a real array, but a hand-edited row could be
    // anything — coerce rather than trusting it.
    assignee_ids: Array.isArray(r.assignee_ids) ? r.assignee_ids.filter((x: unknown) => typeof x === 'string') : [],
    done_at: r.done_at ?? null,
    created_by: r.created_by ?? null,
    sort_order: Number(r.sort_order) || 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

/** True when a completed task is still recent enough to show in Done. */
export function isRecentlyDone(t: Task, now = Date.now()): boolean {
  if (!t.done_at) return false
  const age = now - new Date(t.done_at).getTime()
  return age <= DONE_VISIBLE_DAYS * 24 * 60 * 60 * 1000
}

// ── Reads ──

/**
 * Every task for the org — open ones plus anything completed recently enough
 * to still show under Done. Deliberately one query with no server-side
 * filtering by bucket or assignee: a shop's list is a few dozen rows, the
 * panel filters in the client, and this way switching Mine/All costs nothing.
 */
export async function listTasks(orgId: string): Promise<Task[]> {
  const cutoff = new Date(Date.now() - DONE_VISIBLE_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLUMNS)
    .eq('org_id', orgId)
    .or(`done_at.is.null,done_at.gte.${cutoff}`)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    console.error('listTasks', error)
    return []
  }
  return (data || []).map(normalizeTask)
}

/** Open-task count per project id — drives the project page's "Tasks · N"
 *  affordance. Only counts unfinished work. */
export async function listOpenCountByProject(orgId: string): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('tasks')
    .select('project_id')
    .eq('org_id', orgId)
    .is('done_at', null)
    .not('project_id', 'is', null)
  if (error) {
    console.error('listOpenCountByProject', error)
    return {}
  }
  const out: Record<string, number> = {}
  for (const r of (data || []) as Array<{ project_id: string | null }>) {
    if (!r.project_id) continue
    out[r.project_id] = (out[r.project_id] || 0) + 1
  }
  return out
}

/** Everyone active on the team roster, whether or not they have a login and
 *  whether or not they're task-enabled — see `tasksEnabled`. Reads
 *  `orgs.team_members` directly rather than via loadShopRateSetup — that
 *  helper also pulls salaries out of the owner-only compensation table, which
 *  a task picker has no business touching. */
export async function listAssignees(orgId: string): Promise<TaskAssignee[]> {
  const { data, error } = await supabase
    .from('orgs')
    .select('team_members')
    .eq('id', orgId)
    .maybeSingle()
  if (error) {
    console.error('listAssignees', error)
    return []
  }
  const raw = (data as { team_members?: unknown } | null)?.team_members
  const rows = Array.isArray(raw) ? raw : []
  return rows
    .map((m: any) => ({
      id: String(m?.id ?? ''),
      name: String(m?.name ?? '').trim(),
      userId: m?.user_id ? String(m.user_id) : null,
      active: m?.active !== false,
      // Opt-out, matching normalizeTeamMembers: rows that predate the flag
      // are enabled, so the picker is never mysteriously empty. Trimmed per
      // person on /team ("Gets tasks").
      tasksEnabled: m?.tasks_enabled !== false,
    }))
    // No id → can't be referenced. Inactive → they've left the shop.
    .filter((m) => m.id && m.name && m.active)
    .map(({ id, name, userId, tasksEnabled }) => ({ id, name, userId, tasksEnabled }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listComments(taskId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from('task_comments')
    .select('id, task_id, author_user_id, body, created_at')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  if (error) {
    console.error('listComments', error)
    return []
  }
  return (data || []) as TaskComment[]
}

// ── Writes ──
//
// Each one selects the row back and throws on zero rows. See the header: a
// blocked write is otherwise indistinguishable from a successful one.

export async function createTask(input: {
  orgId: string
  title: string
  bucket?: TaskBucket
  projectId?: string | null
  assigneeIds?: string[]
  createdBy?: string | null
}): Promise<Task> {
  const title = input.title.trim()
  if (!title) throw new Error('A task needs a title.')
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      org_id: input.orgId,
      title,
      bucket: input.bucket ?? 'today',
      project_id: input.projectId ?? null,
      assignee_ids: input.assigneeIds ?? [],
      created_by: input.createdBy ?? null,
      // New rows sort to the top of their bucket — a task you just typed is
      // the one you're thinking about.
      sort_order: -Date.now(),
    })
    .select(TASK_COLUMNS)
    .single()
  if (error || !data) {
    console.error('createTask', error)
    throw new Error(error?.message || 'Could not create the task.')
  }
  return normalizeTask(data)
}

export async function updateTask(
  taskId: string,
  patch: Partial<Pick<Task, 'title' | 'bucket' | 'project_id' | 'assignee_ids' | 'sort_order' | 'done_at'>>,
  orgId?: string,
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['title', 'bucket', 'project_id', 'assignee_ids', 'sort_order', 'done_at'] as const) {
    if (patch[k] !== undefined) update[k] = patch[k]
  }
  if (typeof update.title === 'string') {
    const t = (update.title as string).trim()
    if (!t) throw new Error('A task needs a title.')
    update.title = t
  }
  let q = supabase.from('tasks').update(update).eq('id', taskId)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q.select('id')
  if (error) {
    console.error('updateTask', error)
    throw new Error(error.message || 'Could not save the task.')
  }
  if (!data || data.length === 0) throw new Error('Could not save the task.')
}

/** Flip completion. Passing `done: false` clears the stamp, which is what
 *  restores a row out of Done. */
export async function setTaskDone(taskId: string, done: boolean, orgId?: string): Promise<void> {
  await updateTask(taskId, { done_at: done ? new Date().toISOString() : null }, orgId)
}

export async function deleteTask(taskId: string, orgId?: string): Promise<void> {
  let q = supabase.from('tasks').delete().eq('id', taskId)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q.select('id')
  if (error) {
    console.error('deleteTask', error)
    throw new Error(error.message || 'Could not delete the task.')
  }
  if (!data || data.length === 0) throw new Error('Could not delete the task.')
}

export async function addComment(input: {
  orgId: string
  taskId: string
  body: string
  authorUserId?: string | null
}): Promise<TaskComment> {
  const body = input.body.trim()
  if (!body) throw new Error('Write something first.')
  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      org_id: input.orgId,
      task_id: input.taskId,
      body,
      author_user_id: input.authorUserId ?? null,
    })
    .select('id, task_id, author_user_id, body, created_at')
    .single()
  if (error || !data) {
    console.error('addComment', error)
    throw new Error(error?.message || 'Could not add the comment.')
  }
  return data as TaskComment
}
