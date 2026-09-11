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
//   · It opens on MINE, not All (Andrew's call 2026-09-03; it shipped on All).
//     What you personally owe is the question you open a task pane to answer;
//     the whole shop's list is one click away and the choice is remembered.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, Settings2, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  BUCKET_LABEL,
  TASK_BUCKETS,
  TASK_TAG_COLORS,
  createTask,
  setTaskDone,
  updateTask,
  type Task,
  type TaskBucket,
} from '@/lib/tasks'
import { useTasks, type TaskProjectRef } from './TasksProvider'
import { TaskRow, taskFirstName as firstName } from './TaskRow'
import { TaskArchive } from './TaskArchive'
import { TaskTagChip } from './TaskTagChip'
import { TagManager } from './TagManager'
import { matchesTagFilter } from './use-tag-filter'

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
    myAssigneeId,
    nameByUserId,
    archive,
    archiveLoaded,
    archiveLoading,
    archiveTruncated,
    loadArchive,
    taskTags,
    tagFilter,
    toggleTagFilter,
    clearTagFilter,
    saveTags,
    extrasAvailable,
    panelOpen,
    closePanel,
    projectFilter,
    setProjectFilter,
  } = useTasks()

  // Opens on Mine. See `visible` for what happens when the signed-in user has
  // no roster entry — it does NOT show an empty panel.
  const [filter, setFilter] = useState<Filter>('mine')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [managingTags, setManagingTags] = useState(false)
  const tagGearRef = useRef<HTMLButtonElement>(null)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBucket, setNewBucket] = useState<TaskBucket>('today')
  const [newAssignees, setNewAssignees] = useState<string[]>([])
  /** Project chosen while typing the task. Seeded from `projectFilter` so a
   *  task started from a project's "Tasks · N" still lands on that project
   *  without the operator re-picking it. */
  const [newProjectId, setNewProjectId] = useState<string>('')
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

  // Follow the drawer's project filter: opening it from a project should
  // pre-select that project, and clearing the filter shouldn't strand a
  // selection the operator can no longer see.
  useEffect(() => {
    setNewProjectId(projectFilter ?? '')
  }, [projectFilter])

  const projectById = useMemo(() => {
    const m = new Map<string, TaskProjectRef>()
    for (const p of projects) m.set(p.id, p)
    return m
  }, [projects])

  /** Who a picker offers. Distinct from `assignees`, which also carries
   *  people switched off on /team so their name still resolves on a task
   *  they were given earlier. */
  const pickable = useMemo(() => assignees.filter((a) => a.tasksEnabled), [assignees])

  const nameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignees) m.set(a.id, a.name)
    return m
  }, [assignees])

  // `myAssigneeId` comes from the provider (tasks are assigned to ROSTER ids,
  // so "Mine" hops signed-in login → team_members entry).
  //
  // Pulled out as one predicate because the ARCHIVE has to apply exactly the
  // same rule — "person filter + Archive = that person's archive" is the
  // feature, and two copies of this would be two chances to disagree.
  const matches = useCallback(
    (t: Task) => {
      if (projectFilter && t.project_id !== projectFilter) return false
      if (!matchesTagFilter(t, tagFilter)) return false
      if (filter === 'all') return true
      // Mine before the roster has loaded, or for a login with no roster row,
      // shows EVERYTHING rather than nothing. Since Mine is now the landing
      // filter, the alternative is that the panel opens blank for a fraction
      // of a second on every load — and permanently blank for an unlinked
      // login — which reads as "tasks are broken" rather than "you're owed
      // nothing". Same fallback rule as the nav badge.
      if (filter === 'mine' && !myAssigneeId) return true
      const target = filter === 'mine' ? myAssigneeId : filter
      if (!target) return false
      return t.assignee_ids.includes(target)
    },
    [filter, projectFilter, myAssigneeId, tagFilter],
  )

  const visible = useMemo(() => tasks.filter(matches), [tasks, matches])
  const visibleArchive = useMemo(() => archive.filter(matches), [archive, matches])

  const byBucket = useMemo(() => {
    const out: Record<TaskBucket, Task[]> = {
      today: [],
      this_week: [],
      next_week: [],
      someday: [],
    }
    // `tasks` holds only open rows now — completed work lives in the archive.
    for (const t of visible) out[t.bucket].push(t)
    return out
  }, [visible])

  /** Register a tag on the org and make it available everywhere. */
  const addTag = useCallback(
    async (name: string) => {
      const exists = taskTags.some((t) => t.name.toLowerCase() === name.toLowerCase())
      if (exists) return
      // Give each new tag the next unused colour so they don't all come out
      // gray and indistinguishable.
      const used = new Set(taskTags.map((t) => t.color))
      const color = TASK_TAG_COLORS.find((c) => !used.has(c.key))?.key ?? 'gray'
      await saveTags([...taskTags, { name, color }])
    },
    [taskTags, saveTags],
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
        projectId: newProjectId || null,
        assigneeIds: newAssignees,
        createdBy: user.id,
      })
      setNewTitle('')
      setNewAssignees([])
      setNewProjectId(projectFilter ?? '')
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
            {/* Follows the active filter. It was hardcoded to "Everyone's
                list", which was true when the panel opened on All — landing on
                Mine made it a lie, and a subtitle that contradicts the list
                under it is worse than none. */}
            <div className="text-[11px] text-[#9CA3AF]">
              {projectFilter
                ? projectById.get(projectFilter)?.name ?? 'This project'
                : filter === 'all'
                  ? 'Everyone’s list'
                  : filter === 'mine'
                    ? myAssigneeId
                      ? 'Assigned to you'
                      : 'Everyone’s list'
                    : `${firstName(nameById.get(filter) ?? '')}’s tasks`}
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
          {pickable
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

        {/* Tag filter — beside the person filter, its own row so a shop with
            eight tags doesn't push the people off screen. Hidden entirely
            pre-098, when there are no tags to filter by. */}
        {extrasAvailable && (taskTags.length > 0 || tagFilter.length > 0) && (
          <div className="px-4 py-2 border-b border-[#F3F4F6] flex items-center gap-1.5 flex-wrap relative">
            {taskTags.map((t) => {
              const on = tagFilter.some((x) => x.toLowerCase() === t.name.toLowerCase())
              return (
                <button key={t.name} onClick={() => toggleTagFilter(t.name)}>
                  <span className={on ? '' : 'opacity-40 grayscale'}>
                    <TaskTagChip name={t.name} registry={taskTags} size="xs" />
                  </span>
                </button>
              )
            })}
            {tagFilter.length > 0 && (
              <button
                onClick={clearTagFilter}
                className="text-[10px] text-[#9CA3AF] hover:text-[#111] underline"
              >
                Clear
              </button>
            )}
            <button
              ref={tagGearRef}
                  onClick={() => setManagingTags((v) => !v)}
              aria-label="Manage tags"
              title="Manage tags"
              className="ml-auto p-1 rounded-md text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6]"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            {managingTags && (
              <TagManager
                tags={taskTags}
                onSave={saveTags}
                triggerRef={tagGearRef}
                onClose={() => setManagingTags(false)}
              />
            )}
          </div>
        )}

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
              {/* Project, AT CREATE TIME. Same gap as assignment had: it only
                  existed inside an expanded row, so linking a task to a job
                  meant adding it, saving, reopening it and picking. */}
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1">
                  Project
                </div>
                <select
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value)}
                  className="w-full px-2 py-1.5 text-[12.5px] border border-[#E5E7EB] rounded-md bg-white focus:outline-none focus:border-[#2563EB]"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              {/* Who it's for, AT CREATE TIME. This was the whole gap in the
                  first cut: assignment only existed inside an expanded row, so
                  from the drawer there was no way to hand a task to anyone. */}
              {pickable.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1">
                    Who's doing it
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {pickable.map((a) => {
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
                    setNewProjectId(projectFilter ?? '')
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
                        assignees={pickable}
                        nameById={nameById}
                        nameByUserId={nameByUserId}
                        taskTags={taskTags}
                        onAddTag={addTag}
                        extrasAvailable={extrasAvailable}
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

              {/* Completed work — kept forever, loaded only when opened, and
                  filtered by the same person/tag rules as the list above. */}
              <TaskArchive
                tasks={visibleArchive}
                open={archiveOpen}
                onToggle={() => {
                  const next = !archiveOpen
                  setArchiveOpen(next)
                  if (next) void loadArchive()
                }}
                loading={archiveLoading}
                loaded={archiveLoaded}
                truncated={archiveTruncated}
                onRestore={(t) => void run(() => setTaskDone(t.id, false, user?.org_id))}
                taskTags={taskTags}
              />
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
