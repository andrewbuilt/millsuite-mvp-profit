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
import Link from 'next/link'
import { Check, ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  BUCKET_LABEL,
  TASK_BUCKETS,
  createTask,
  isRecentlyDone,
  setTaskDone,
  updateTask,
  type Task,
  type TaskBucket,
} from '@/lib/tasks'
import { useTasks, type TaskProjectRef } from './TasksProvider'
import { TaskRow, taskFirstName as firstName } from './TaskRow'

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
  const [newAssignees, setNewAssignees] = useState<string[]>([])
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

  // Tasks are assigned to ROSTER ids, so "Mine" has to hop from the signed-in
  // login to that person's team_members entry. Null when the owner isn't on
  // the roster — Mine then shows nothing rather than silently showing all.
  const myAssigneeId = useMemo(
    () => assignees.find((a) => a.userId && a.userId === user?.id)?.id ?? null,
    [assignees, user?.id],
  )

  const visible = useMemo(() => {
    return tasks.filter((t) => {
      if (projectFilter && t.project_id !== projectFilter) return false
      if (filter === 'all') return true
      const target = filter === 'mine' ? myAssigneeId : filter
      if (!target) return false
      return t.assignee_ids.includes(target)
    })
  }, [tasks, filter, projectFilter, myAssigneeId])

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
        assigneeIds: newAssignees,
        createdBy: user.id,
      })
      setNewTitle('')
      setNewAssignees([])
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
            {/* The drawer is for a quick look and quick capture; /tasks is
                where you work the list. */}
            <Link
              href="/tasks"
              onClick={closePanel}
              className="text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] whitespace-nowrap"
            >
              Full list →
            </Link>
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
            .filter((a) => a.id !== myAssigneeId)
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
              {/* Who it's for, AT CREATE TIME. This was the whole gap in the
                  first cut: assignment only existed inside an expanded row, so
                  from the drawer there was no way to hand a task to anyone. */}
              {assignees.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1">
                    Who's doing it
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {assignees.map((a) => {
                      const on = newAssignees.includes(a.id)
                      return (
                        <button
                          key={a.id}
                          onClick={() =>
                            setNewAssignees((prev) =>
                              on ? prev.filter((x) => x !== a.id) : [...prev, a.id],
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
              )}
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
