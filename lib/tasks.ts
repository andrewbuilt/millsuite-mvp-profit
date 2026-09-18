// ============================================================================
// lib/tasks.ts — the shared action list (Task system v1, migrations 093 + 098)
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
//
// ── TWO NAME SPACES, AND THEY ARE NOT INTERCHANGEABLE ──────────────────────
// ⛔ `assignee_ids` holds ROSTER ids (`orgs.team_members[].id`).
// ⛔ `created_by` and `task_comments.author_user_id` hold LOGIN ids (users.id).
// Resolving either one means going through the roster, because RLS
// (`users_select_self`, migration 084) lets the browser read only its OWN
// users row — there is no client-side way to look up another login's name.
// `TaskAssignee.userId` is the bridge, and `nameByUserId` below is built from
// it. A creator with no roster row simply can't be named, and the UI omits the
// line rather than printing "Unknown".
// ============================================================================

import { supabase } from './supabase'
import { updateOrgChecked } from './org-write'

export const TASK_BUCKETS = ['today', 'this_week', 'next_week', 'someday'] as const
export type TaskBucket = (typeof TASK_BUCKETS)[number]

export const BUCKET_LABEL: Record<TaskBucket, string> = {
  today: 'Today',
  this_week: 'This week',
  next_week: 'Next week',
  someday: 'Someday',
}

/**
 * "Sep 4, 2:14 pm" — when a task was completed.
 *
 * One formatter so the Archive row and the detail panel can't drift. The year
 * appears only when it ISN'T the current one: an archive that keeps work
 * forever will eventually hold two Septembers, and "Sep 4" alone stops being
 * an answer.
 */
export function formatDoneAt(iso: string | null, now = new Date()): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * How many calendar days a not-done TODAY task has sat since it entered the
 * bucket — 0 means "no chip".
 *
 * "Past due" can't mean a missed date, because buckets have no dates (the 093
 * design: a curated list, nothing auto-rolls). It means the daily pass hasn't
 * touched this row: it entered Today on a PREVIOUS day and is still open. The
 * count is CALENDAR days in local time — entered yesterday = 1d even at
 * 12:01am, because "how many mornings has this survived" is the question, not
 * elapsed hours. Math.round, not floor: a DST day is 23 or 25 hours and floor
 * would miscount it.
 *
 * A null stamp (pre-112, or a hand-inserted row) → 0. A guessed chip is worse
 * than none. Completed tasks are 0 by the done_at guard.
 */
export function pastDueDays(
  task: Pick<Task, 'bucket' | 'done_at' | 'bucket_changed_at'>,
  now = new Date(),
): number {
  if (task.bucket !== 'today' || task.done_at || !task.bucket_changed_at) return 0
  const then = new Date(task.bucket_changed_at)
  if (Number.isNaN(then.getTime())) return 0
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayStart(now) - dayStart(then)) / 86400000)
  return days > 0 ? days : 0
}

/** "September 2026" — the Archive's month group headings. */
export function archiveMonthLabel(iso: string | null): string {
  if (!iso) return 'Undated'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Undated'
  return d.toLocaleString(undefined, { month: 'long', year: 'numeric' })
}

/** A reference link on a task — the drawing, the quote, the order
 *  confirmation. These used to get pasted into the sheet's Notes column where
 *  they weren't clickable and the next note overwrote them. */
export interface TaskLink {
  url: string
  label?: string
}

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
  /** Migration 098. Empty on any org that hasn't run it — see `extrasReady`. */
  links: TaskLink[]
  /** Migration 098. Tag NAMES, not ids — see the registry note below. */
  tags: string[]
  /** Migration 112. When the task last changed bucket — drives the "Past due"
   *  chip on stale Today tasks. Null = unknown (pre-112): no chip. */
  bucket_changed_at: string | null
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

// ── Migration 098 tolerance ────────────────────────────────────────────────
// PostgREST fails an ENTIRE select on one unknown column, so naming `links`
// and `tags` in the column list would 42703 the whole task list on a database
// that hasn't run 098 — the panel would come up empty rather than degraded.
// Same hazard the 095 columns have, handled the same way in spirit: ask for
// them, and if the database says they don't exist, stop asking for the rest of
// the session and carry on without them.
//
// Optimistic on purpose: assume present until proven otherwise, so the normal
// case costs one query and a freshly-migrated database heals on the next page
// load. `extrasReady()` tells the UI whether to offer links/tags at all —
// writing to a column that isn't there would just throw at the operator.

const TASK_COLUMNS_BASE =
  'id, org_id, project_id, title, bucket, assignee_ids, done_at, created_by, sort_order, created_at, updated_at'
const TASK_COLUMNS_098 = `${TASK_COLUMNS_BASE}, links, tags`
const TASK_COLUMNS_112 = `${TASK_COLUMNS_098}, bucket_changed_at`

/** null = not probed yet, true = 098 present, false = pre-098. */
let extras: boolean | null = null

/** Same idea for 112 (`bucket_changed_at`). Pre-112 just means no past-due
 *  chips and no stamping on bucket moves — everything else works. */
let stamped: boolean | null = null

/** False only once a query has actually come back 42703. The UI hides the
 *  links and tags affordances when this is false. */
export function extrasReady(): boolean {
  return extras !== false
}

function taskColumns(): string {
  if (extras === false) return TASK_COLUMNS_BASE
  if (stamped === false) return TASK_COLUMNS_098
  return TASK_COLUMNS_112
}

/**
 * An unknown-column failure on `cols` narrows the ladder one rung:
 * 112 → 098 → base. Records the verdict in the flags and returns the next
 * column list to try, or null when there's nothing left to drop.
 *
 * One rung at a time on purpose: the error doesn't say WHICH column is
 * missing in a way this file trusts matching on (see isUnknownColumn's note
 * on loose matches), so a pre-098 database simply demotes twice. Setting
 * `stamped = false` on the first rung is still correct there — migrations run
 * in order, so pre-098 is also pre-112.
 */
function demoteColumns(cols: string): string | null {
  if (cols === TASK_COLUMNS_112) {
    stamped = false
    return taskColumns()
  }
  if (cols === TASK_COLUMNS_098) {
    extras = false
    return TASK_COLUMNS_BASE
  }
  return null
}

/**
 * True when this PostgREST error means "that column isn't there".
 *
 * ⚠️ READS AND WRITES FAIL DIFFERENTLY, which is easy to get half-right:
 *   · SELECT with an unknown column → Postgres 42703, "column tasks.links
 *     does not exist" (verified against prod, 2026-09-11).
 *   · INSERT/UPDATE → PostgREST PGRST204, "Could not find the 'links' column
 *     of 'tasks' in the schema cache" — which contains neither the 42703 code
 *     nor the phrase "does not exist".
 * Matching only the read case would leave every save throwing a raw PostgREST
 * message at the operator instead of a sentence about the migration.
 *
 * Deliberately NOT a loose /does not exist/ match: that also catches a missing
 * TABLE and a bad relationship, and quietly deciding "no 098" because of an
 * unrelated failure would hide the real error.
 */
function isUnknownColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  const code = error.code || ''
  if (code === '42703' || code === 'PGRST204') return true
  const msg = error.message || ''
  return /column .* does not exist/i.test(msg) || /could not find the .* column/i.test(msg)
}

function normalizeLinks(raw: unknown): TaskLink[] {
  if (!Array.isArray(raw)) return []
  const out: TaskLink[] = []
  for (const r of raw) {
    // Tolerate a bare string as well as {url,label} — a hand-edited row or an
    // older shape shouldn't blank the whole list.
    if (typeof r === 'string') {
      if (r.trim()) out.push({ url: r.trim() })
      continue
    }
    const url = typeof (r as any)?.url === 'string' ? (r as any).url.trim() : ''
    if (!url) continue
    const label =
      typeof (r as any)?.label === 'string' && (r as any).label.trim()
        ? (r as any).label.trim()
        : undefined
    out.push(label ? { url, label } : { url })
  }
  return out
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of raw) {
    if (typeof r !== 'string') continue
    const name = r.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

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
    // Absent pre-098 — an empty array reads as "no links, no tags", which is
    // exactly right and needs no special case anywhere downstream.
    links: normalizeLinks(r.links),
    tags: normalizeTags(r.tags),
    // Absent pre-112 — null means "unknown", and pastDueDays shows no chip.
    bucket_changed_at: r.bucket_changed_at ?? null,
  }
}

// ── Tag registry (orgs.task_tags, migration 098) ───────────────────────────
//
// ⛔ TASKS STORE TAG NAMES, NOT IDS. This registry exists for the picker and
// the colour only. Renaming a tag here therefore does NOT rewrite the tasks
// already carrying the old name — they keep it and render in the neutral
// fallback colour. Deliberate v1 tradeoff (see migration 098); the rename UI
// says so out loud, because a silent partial rename is the kind of thing
// someone discovers three weeks later.

export interface TaskTag {
  name: string
  /** A key from TASK_TAG_COLORS. Unknown/missing → the neutral swatch. */
  color: string
}

export const TASK_TAG_COLORS = [
  { key: 'gray', bg: '#F3F4F6', fg: '#4B5563', dot: '#9CA3AF' },
  { key: 'blue', bg: '#EFF6FF', fg: '#1E40AF', dot: '#3B82F6' },
  { key: 'green', bg: '#ECFDF5', fg: '#065F46', dot: '#10B981' },
  { key: 'amber', bg: '#FFFBEB', fg: '#92400E', dot: '#F59E0B' },
  { key: 'red', bg: '#FEF2F2', fg: '#991B1B', dot: '#EF4444' },
  { key: 'purple', bg: '#F5F3FF', fg: '#5B21B6', dot: '#8B5CF6' },
] as const

export type TaskTagColorKey = (typeof TASK_TAG_COLORS)[number]['key']

/** The swatch for a colour key. Falls back to neutral for an unknown key —
 *  and for a tag whose registry entry was renamed out from under it. */
export function tagSwatch(color: string | undefined) {
  return TASK_TAG_COLORS.find((c) => c.key === color) ?? TASK_TAG_COLORS[0]
}

function normalizeTagRegistry(raw: unknown): TaskTag[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TaskTag[] = []
  for (const r of raw) {
    const name = typeof (r as any)?.name === 'string' ? (r as any).name.trim() : ''
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const color = typeof (r as any)?.color === 'string' ? (r as any).color : 'gray'
    out.push({ name, color })
  }
  return out
}

/**
 * The org's tag registry. Read in an ISOLATED select — folding `task_tags`
 * into any shared org read would 42703 that entire read on a pre-098
 * database, which is how a settings card or a whole page goes blank.
 */
export async function listTaskTags(orgId: string): Promise<TaskTag[]> {
  const { data, error } = await supabase
    .from('orgs')
    .select('task_tags')
    .eq('id', orgId)
    .maybeSingle()
  if (error) {
    // Pre-098 is a normal state, not a failure — no tags yet.
    if (!isUnknownColumn(error)) console.error('listTaskTags', error)
    return []
  }
  return normalizeTagRegistry((data as { task_tags?: unknown } | null)?.task_tags)
}

/** Replace the registry. ⛔ Goes through `updateOrgChecked`: `orgs` has no
 *  browser UPDATE policy pattern to trust, and a zero-row update reports
 *  success. */
export async function saveTaskTags(orgId: string, tags: TaskTag[]): Promise<void> {
  await updateOrgChecked(orgId, { task_tags: normalizeTagRegistry(tags) })
}

// ── Reads ──

/**
 * Every OPEN task for the org.
 *
 * ⚠️ Completed tasks are NOT here any more. They used to ride along for a
 * week (`done_at >= cutoff`) so a collapsed Done section could show them, but
 * the Archive keeps completed work forever and loading a shop's entire
 * history on every page load to render a collapsed section would be absurd.
 * `listArchivedTasks` fetches it on demand instead. Anything that needs a
 * completed task must ask for it.
 */
export async function listTasks(orgId: string): Promise<Task[]> {
  const run = (cols: string) =>
    supabase
      .from('tasks')
      .select(cols)
      .eq('org_id', orgId)
      .is('done_at', null)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

  // ⛔ DECIDE FROM THE COLUMNS *THIS* CALL ASKED FOR, never from the shared
  // flag. Two earlier bugs lived here:
  //   · `else if (!error) extras = true` also fired for the BASE retry, so on
  //     a pre-098 database the flag flip-flopped every refresh — the Tags and
  //     Links sections appeared and vanished on alternate saves, and every
  //     other load wasted a failing round trip.
  //   · Gating the retry on `extras !== false` meant that with two task
  //     queries in flight, the second one saw the flag the first had just set,
  //     SKIPPED ITS OWN RETRY and returned an EMPTY LIST. Reachable: the
  //     Archive toggle is clickable while the first load is still running.
  let cols = taskColumns()
  let { data, error } = await run(cols)
  while (error && isUnknownColumn(error)) {
    const next = demoteColumns(cols)
    if (!next) break
    console.warn(
      next === TASK_COLUMNS_BASE
        ? 'listTasks: migration 098 (tasks.links / tasks.tags) has not been run — ' +
            'links and tags are unavailable until it is.'
        : 'listTasks: migration 112 (tasks.bucket_changed_at) has not been run — ' +
            'past-due tags are unavailable until it is.',
    )
    cols = next
    ;({ data, error } = await run(cols))
  }
  if (!error && cols === TASK_COLUMNS_112) {
    stamped = true
    extras = true
  } else if (!error && cols === TASK_COLUMNS_098) {
    extras = true
  }

  if (error) {
    console.error('listTasks', error)
    return []
  }
  return ((data || []) as any[]).map(normalizeTask)
}

/** How many completed tasks the Archive will load at once. High enough that a
 *  shop will not hit it for years, low enough to bound the query. If it IS
 *  hit, the UI says so — a silently truncated archive reads as lost work. */
export const ARCHIVE_PAGE_SIZE = 500

export interface ArchivePage {
  tasks: Task[]
  /** True when the archive is longer than we loaded. Surfaced in the UI. */
  truncated: boolean
  /** True when the fetch FAILED. Without this, a failed archive read is
   *  indistinguishable from an empty one and the panel confidently says
   *  "Nothing completed yet" — then caches that as loaded and never retries. */
  failed: boolean
}

/**
 * Completed tasks, newest first. Loaded only when someone opens the Archive.
 *
 * Not filtered by person here: the Mine/person filter is a client-side
 * concern everywhere else in this system, and a shop's archive is small
 * enough that one fetch serves every filter without a round trip per chip.
 */
export async function listArchivedTasks(orgId: string): Promise<ArchivePage> {
  const run = (cols: string) =>
    supabase
      .from('tasks')
      .select(cols)
      .eq('org_id', orgId)
      .not('done_at', 'is', null)
      .order('done_at', { ascending: false })
      // One extra row is the cheapest possible "is there more?" probe.
      .limit(ARCHIVE_PAGE_SIZE + 1)

  // Same per-call rule as listTasks — see the long note there.
  let cols = taskColumns()
  let { data, error } = await run(cols)
  while (error && isUnknownColumn(error)) {
    const next = demoteColumns(cols)
    if (!next) break
    cols = next
    ;({ data, error } = await run(cols))
  }
  if (!error && cols === TASK_COLUMNS_112) {
    stamped = true
    extras = true
  } else if (!error && cols === TASK_COLUMNS_098) {
    extras = true
  }

  if (error) {
    console.error('listArchivedTasks', error)
    return { tasks: [], truncated: false, failed: true }
  }
  const rows = (data || []) as any[]
  return {
    tasks: rows.slice(0, ARCHIVE_PAGE_SIZE).map(normalizeTask),
    truncated: rows.length > ARCHIVE_PAGE_SIZE,
    failed: false,
  }
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
  tags?: string[]
  createdBy?: string | null
}): Promise<Task> {
  const title = input.title.trim()
  if (!title) throw new Error('A task needs a title.')
  const row: Record<string, unknown> = {
    org_id: input.orgId,
    title,
    bucket: input.bucket ?? 'today',
    project_id: input.projectId ?? null,
    assignee_ids: input.assigneeIds ?? [],
    created_by: input.createdBy ?? null,
    // New rows sort to the top of their bucket — a task you just typed is
    // the one you're thinking about.
    sort_order: -Date.now(),
  }
  // Only name 098's columns when they exist, or the insert itself 42703s.
  if (extrasReady() && input.tags?.length) row.tags = normalizeTags(input.tags)

  // ⚠️ The RETURNING clause names the 098 columns too, so a create can fail on
  // a pre-098 database even when the INSERT itself is fine. This had no
  // fallback and no friendly message, which meant one stale flag left "New
  // task" permanently broken for the session.
  const attempt = (cols: string, body: Record<string, unknown>) =>
    supabase.from('tasks').insert(body).select(cols).single()

  // The same 112 → 098 → base ladder as the reads. `bucket_changed_at` is
  // never in the INSERT body (the column's DEFAULT now() is the birth stamp),
  // so only the RETURNING columns walk down; `tags` leaves the body at the
  // base rung because pre-098 the column isn't there to write.
  let cols = taskColumns()
  let body: Record<string, unknown> = row
  let { data, error } = await attempt(cols, body)
  while (error && isUnknownColumn(error)) {
    const next = demoteColumns(cols)
    if (!next) break
    cols = next
    if (cols === TASK_COLUMNS_BASE) {
      const { tags: _dropped, ...base } = body
      body = base
    }
    ;({ data, error } = await attempt(cols, body))
  }

  if (error || !data) {
    console.error('createTask', error)
    throw new Error(error?.message || 'Could not create the task.')
  }
  return normalizeTask(data)
}

export async function updateTask(
  taskId: string,
  patch: Partial<
    Pick<
      Task,
      'title' | 'bucket' | 'project_id' | 'assignee_ids' | 'sort_order' | 'done_at' | 'links' | 'tags'
    >
  >,
  orgId?: string,
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['title', 'bucket', 'project_id', 'assignee_ids', 'sort_order', 'done_at'] as const) {
    if (patch[k] !== undefined) update[k] = patch[k]
  }
  if (patch.links !== undefined) update.links = normalizeLinks(patch.links)
  if (patch.tags !== undefined) update.tags = normalizeTags(patch.tags)
  if (typeof update.title === 'string') {
    const t = (update.title as string).trim()
    if (!t) throw new Error('A task needs a title.')
    update.title = t
  }
  // ⛔ THE PAST-DUE STAMP RIDES EVERY BUCKET WRITE, HERE, NOT AT THE CALL
  // SITES. Drag on both surfaces and the row editor's bucket buttons all
  // funnel through this function (verified 2026-09-18: nothing else writes
  // tasks.bucket), so one line covers them all and a future quick-move can't
  // forget it. Pre-112 the retry below strips it back out — the bucket still
  // moves, only the past-due clock is unavailable.
  if (patch.bucket !== undefined && stamped !== false) {
    update.bucket_changed_at = new Date().toISOString()
  }
  const attempt = () => {
    let q = supabase.from('tasks').update(update).eq('id', taskId)
    if (orgId) q = q.eq('org_id', orgId)
    return q.select('id')
  }
  let { data, error } = await attempt()
  if (error && isUnknownColumn(error) && update.bucket_changed_at !== undefined) {
    stamped = false
    delete update.bucket_changed_at
    ;({ data, error } = await attempt())
  }
  if (error) {
    console.error('updateTask', error)
    if (isUnknownColumn(error) && (patch.links !== undefined || patch.tags !== undefined)) {
      extras = false
      throw new Error('Links and tags need migration 098. Run it, then reload.')
    }
    throw new Error(error.message || 'Could not save the task.')
  }
  if (!data || data.length === 0) throw new Error('Could not save the task.')
}

/** Flip completion. Passing `done: false` clears the stamp, which is what
 *  restores a row out of the Archive. */
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
