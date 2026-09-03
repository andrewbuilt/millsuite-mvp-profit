'use client'

// ============================================================================
// TasksPanel — the shared action list, as a right-hand slide-out.
// ============================================================================
// The Google Sheet this replaces was one list everyone read, so this is one
// list everyone reads: sections by BUCKET (Today / This week / Next week /
// Someday) plus a collapsed Done, and any manager can edit any row.
//
// Two behaviours that look like omissions but are the design:
//   · Nothing auto-rolls. A stale Today item stays in Today until a human
//     drags it. Kaylin's daily pass IS the process; ageing rows for her would
//     quietly take the judgement away.
//   · The default filter is ALL, not Mine. It's a master list — you're meant
//     to see what everyone is carrying. Mine is one click away and the choice
//     is remembered.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  BUCKET_LABEL,
  TASK_BUCKETS,
  addComment,
  createTask,
  deleteTask,
  isRecentlyDone,
  listComments,
  setTaskDone,
  updateTask,
  type Task,
  type TaskBucket,
  type TaskComment,
} from '@/lib/tasks'
import { useTasks, type TaskProjectRef } from './TasksProvider'

const FILTER_KEY = 'millsuite.tasks.filter'

/** All | Mine | a specific user id. */
type Filter = 'all' | 'mine' | string

export default function TasksPanel() {
  const { user } = useAuth()
  const {
    enabled,
    tasks,
    assignees,
    projects,
    loading,
    refresh,
    panelOpen,
    closePanel,
    projectFilter,
    setProjectFilter,
  } = useTasks()

  const [filter, setFilter] = useState<Filter>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [doneOpen, setDoneOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBucket, setNewBucket] = useState<TaskBucket>('today')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<TaskBucket | null>(null)

  // Remember the filter choice, but only read it once on mount — writing it
  // back on every render would fight the user mid-click.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(FILTER_KEY)
      if (saved) setFilter(saved)
    } catch {
      /* private mode / blocked storage — the default is fine */
    }
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem(FILTER_KEY, filter)
    } catch {
      /* ignore */
    }
  }, [filter])

  const projectById = useMemo(() => {
    const m = new Map<string, TaskProjectRef>()
    for (const p of projects) m.set(p.id, p)
    return m
  }, [projects])

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignees) m.set(a.id, a.name)
    return m
  }, [assignees])

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      if (projectFilter && t.project_id !== projectFilter) return false
      if (filter === 'all') return true
      const target = filter === 'mine' ? user?.id : filter
      if (!target) return true
      return t.assignee_ids.includes(target)
    })
  }, [tasks, filter, projectFilter, user?.id])

  const byBucket = useMemo(() => {
    const out: Record<TaskBucket, Task[]> = {
      today: [],
      this_week: [],
      next_week: [],
      someday: [],
    }
    for (const t of visible) {
      if (t.done_at) continue
      out[t.bucket].push(t)
    }
    return out
  }, [visible])

  const doneTasks = useMemo(
    () => visible.filter((t) => t.done_at && isRecentlyDone(t)),
    [visible],
  )

  async function run(fn: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCreate() {
    const title = newTitle.trim()
    if (!title || !user) return
    await run(async () => {
      await createTask({
        orgId: user.org_id,
        title,
        bucket: newBucket,
        projectId: projectFilter ?? null,
        createdBy: user.id,
      })
      setNewTitle('')
      setAdding(false)
    })
  }

  /** Drop a dragged task into a bucket. Only fires when the bucket actually
   *  changes, so a drag that lands where it started is a no-op. */
  async function handleDropInto(bucket: TaskBucket) {
    const id = dragId
    setDragId(null)
    setDragOver(null)
    if (!id) return
    const t = tasks.find((x) => x.id === id)
    if (!t || t.bucket === bucket) return
    await run(() => updateTask(id, { bucket, sort_order: -Date.now() }, user?.org_id))
  }

  if (!enabled || !panelOpen) return null

  return (
    <>
      {/* Scrim. Click-away closes — this is a side panel, not a modal that
          traps you. */}
      <div
        className="fixed inset-0 z-[60] bg-black/20"
        onClick={closePanel}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-label="Tasks"
        className="fixed right-0 top-0 bottom-0 z-[61] w-full sm:w-[420px] bg-white border-l border-[#E5E7EB] shadow-xl flex flex-col"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-[#111]">Tasks</div>
            <div className="text-[11px] text-[#9CA3AF]">
              {projectFilter
                ? projectById.get(projectFilter)?.name ?? 'This project'
                : 'Everyone’s list'}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {projectFilter && (
              <button
                onClick={() => setProjectFilter(null)}
                className="text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB]"
              >
                Show all projects
              </button>
            )}
            <button
              onClick={closePanel}
              aria-label="Close tasks"
              className="p-1.5 rounded-md text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter chips. Default All — it's a master list. */}
        <div className="px-4 py-2 border-b border-[#F3F4F6] flex items-center gap-1.5 flex-wrap">
          <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
          <FilterChip label="Mine" active={filter === 'mine'} onClick={() => setFilter('mine')} />
          {assignees
            .filter((a) => a.id !== user?.id)
            .map((a) => (
              <FilterChip
                key={a.id}
                label={firstName(a.name)}
                active={filter === a.id}
                onClick={() => setFilter(a.id)}
              />
            ))}
        </div>

        {error && (
          <div className="mx-4 mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* New task */}
        <div className="px-4 py-2.5 border-b border-[#F3F4F6]">
          {adding ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate()
                  if (e.key === 'Escape') {
                    setAdding(false)
                    setNewTitle('')
                  }
                }}
                placeholder="What needs doing?"
                className="w-full px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
              <div className="flex items-center gap-1.5 flex-wrap">
                {TASK_BUCKETS.map((b) => (
                  <button
                    key={b}
                    onClick={() => setNewBucket(b)}
                    className={`text-[11px] px-2 py-1 rounded-md border transition-colors ${
                      newBucket === b
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {BUCKET_LABEL[b]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button
                  disabled={busy || !newTitle.trim()}
                  onClick={() => void handleCreate()}
                  className="px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  Add task
                </button>
                <button
                  onClick={() => {
                    setAdding(false)
                    setNewTitle('')
                  }}
                  className="px-3 py-1.5 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-[#D1D5DB] text-[#6B7280] text-[12px] hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New task
            </button>
          )}
        </div>

        {/* Buckets */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="text-[12px] text-[#9CA3AF] italic py-4">Loading tasks…</div>
          ) : (
            <>
              {TASK_BUCKETS.map((b) => (
                <section
                  key={b}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(b)
                  }}
                  onDragLeave={() => setDragOver((x) => (x === b ? null : x))}
                  onDrop={() => void handleDropInto(b)}
                  className={`mb-4 rounded-lg transition-colors ${
                    dragOver === b ? 'bg-[#EFF6FF] ring-1 ring-[#BFDBFE]' : ''
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5 px-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF]">
                      {BUCKET_LABEL[b]}
                    </span>
                    <span className="text-[10px] text-[#D1D5DB]">{byBucket[b].length}</span>
                  </div>
                  {byBucket[b].length === 0 ? (
                    <div className="text-[11.5px] text-[#D1D5DB] italic px-0.5 py-1">
                      Nothing here.
                    </div>
                  ) : (
                    byBucket[b].map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        project={t.project_id ? projectById.get(t.project_id) ?? null : null}
                        projects={projects}
                        assignees={assignees}
                        nameById={nameById}
                        expanded={expandedId === t.id}
                        onToggleExpand={() =>
                          setExpandedId((id) => (id === t.id ? null : t.id))
                        }
                        onRun={run}
                        busy={busy}
                        orgId={user?.org_id}
                        userId={user?.id ?? null}
                        onDragStart={() => setDragId(t.id)}
                        onDragEnd={() => {
                          setDragId(null)
                          setDragOver(null)
                        }}
                        isDragging={dragId === t.id}
                      />
                    ))
                  )}
                </section>
              ))}

              {/* Done — collapsed, and only the last week's worth. Anything
                  older is gone from view on purpose; a Done pile nobody reads
                  is just clutter. */}
              {doneTasks.length > 0 && (
                <section className="mt-2 border-t border-[#F3F4F6] pt-3">
                  <button
                    onClick={() => setDoneOpen((v) => !v)}
                    className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] hover:text-[#6B7280]"
                  >
                    {doneOpen ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                    Done · {doneTasks.length}
                  </button>
                  {doneOpen &&
                    doneTasks.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2 py-1.5 text-[13px] text-[#9CA3AF]"
                      >
                        <button
                          onClick={() =>
                            void run(() => setTaskDone(t.id, false, user?.org_id))
                          }
                          title="Restore"
                          className="w-4 h-4 rounded border border-[#A7F3D0] bg-[#ECFDF5] text-[#059669] flex items-center justify-center flex-shrink-0"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <span className="line-through truncate">{t.title}</span>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  )
}

// ── Row ──

function TaskRow({
  task,
  project,
  projects,
  assignees,
  nameById,
  expanded,
  onToggleExpand,
  onRun,
  busy,
  orgId,
  userId,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: Task
  project: TaskProjectRef | null
  projects: TaskProjectRef[]
  assignees: { id: string; name: string }[]
  nameById: Map<string, string>
  expanded: boolean
  onToggleExpand: () => void
  onRun: (fn: () => Promise<unknown>) => Promise<void>
  busy: boolean
  orgId: string | undefined
  userId: string | null
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  const [title, setTitle] = useState(task.title)
  const [comments, setComments] = useState<TaskComment[]>([])
  const [commentBody, setCommentBody] = useState('')
  const [loadedComments, setLoadedComments] = useState(false)

  // Comments load lazily — a list of forty tasks shouldn't fetch forty
  // threads nobody opened.
  useEffect(() => {
    if (!expanded || loadedComments) return
    void (async () => {
      setComments(await listComments(task.id))
      setLoadedComments(true)
    })()
  }, [expanded, loadedComments, task.id])

  useEffect(() => setTitle(task.title), [task.title])

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-transparent hover:border-[#E5E7EB] hover:bg-[#FAFCFF] transition-colors ${
        isDragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start gap-2 px-1.5 py-1.5">
        <button
          onClick={() => void onRun(() => setTaskDone(task.id, true, orgId))}
          disabled={busy}
          title="Mark done"
          className="mt-0.5 w-4 h-4 rounded border border-[#D1D5DB] hover:border-[#059669] hover:bg-[#ECFDF5] flex-shrink-0 transition-colors"
        />
        <button
          onClick={onToggleExpand}
          className="flex-1 min-w-0 text-left cursor-pointer"
        >
          <div className="text-[13px] text-[#111] leading-snug">{task.title}</div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {project ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#EFF6FF] text-[#1E40AF] max-w-[160px] truncate">
                {project.name}
              </span>
            ) : (
              // The sheet's plain TASK rows — no job attached, and that's fine.
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280]">
                Task
              </span>
            )}
            {task.assignee_ids.map((id) => (
              <span
                key={id}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F3F4F6] text-[#4B5563]"
              >
                {firstName(nameById.get(id) || 'Unknown')}
              </span>
            ))}
          </div>
        </button>
      </div>

      {expanded && (
        <div className="px-1.5 pb-2.5 pt-1 border-t border-[#F3F4F6] mt-1 space-y-2.5">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title !== task.title) {
                void onRun(() => updateTask(task.id, { title }, orgId))
              }
            }}
            className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
          />

          <div className="flex items-center gap-1.5 flex-wrap">
            {TASK_BUCKETS.map((b) => (
              <button
                key={b}
                onClick={() => void onRun(() => updateTask(task.id, { bucket: b }, orgId))}
                className={`text-[11px] px-2 py-0.5 rounded-md border transition-colors ${
                  task.bucket === b
                    ? 'bg-[#2563EB] text-white border-[#2563EB]'
                    : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                }`}
              >
                {BUCKET_LABEL[b]}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Project
            </span>
            <select
              value={task.project_id ?? ''}
              onChange={(e) =>
                void onRun(() =>
                  updateTask(task.id, { project_id: e.target.value || null }, orgId),
                )
              }
              className="w-full mt-0.5 px-2 py-1.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Assigned to
            </span>
            <div className="flex items-center gap-1.5 flex-wrap mt-1">
              {assignees.map((a) => {
                const on = task.assignee_ids.includes(a.id)
                return (
                  <button
                    key={a.id}
                    onClick={() =>
                      void onRun(() =>
                        updateTask(
                          task.id,
                          {
                            assignee_ids: on
                              ? task.assignee_ids.filter((x) => x !== a.id)
                              : [...task.assignee_ids, a.id],
                          },
                          orgId,
                        ),
                      )
                    }
                    className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                      on
                        ? 'bg-[#2563EB] text-white border-[#2563EB]'
                        : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
                    }`}
                  >
                    {firstName(a.name)}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Comments — the sheet's Notes column, but as a running thread so
              "Ordered, ETA 9/3" doesn't overwrite last week's note. */}
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Updates
            </span>
            <div className="mt-1 space-y-1.5">
              {comments.map((c) => (
                <div key={c.id} className="text-[12px] text-[#374151] leading-snug">
                  <span className="text-[#9CA3AF]">
                    {firstName(nameById.get(c.author_user_id || '') || 'Someone')} ·{' '}
                    {new Date(c.created_at).toLocaleDateString()}
                  </span>
                  <div>{c.body}</div>
                </div>
              ))}
              {loadedComments && comments.length === 0 && (
                <div className="text-[11.5px] text-[#D1D5DB] italic">No updates yet.</div>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-1.5">
              <input
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !commentBody.trim() || !orgId) return
                  const body = commentBody
                  setCommentBody('')
                  void (async () => {
                    const c = await addComment({
                      orgId,
                      taskId: task.id,
                      body,
                      authorUserId: userId,
                    })
                    setComments((prev) => [...prev, c])
                  })()
                }}
                placeholder="Add an update…"
                className="flex-1 px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
            </div>
          </div>

          <button
            onClick={() => void onRun(() => deleteTask(task.id, orgId))}
            className="inline-flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#DC2626]"
          >
            <Trash2 className="w-3 h-3" /> Delete task
          </button>
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
        active
          ? 'bg-[#111] text-white border-[#111]'
          : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
      }`}
    >
      {label}
    </button>
  )
}

/** Chips are tight — a first name is enough to tell people apart in a shop. */
function firstName(full: string): string {
  return (full || '').trim().split(/\s+/)[0] || full
}
