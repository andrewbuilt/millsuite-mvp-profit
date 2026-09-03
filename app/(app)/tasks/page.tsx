'use client'

// ============================================================================
// /tasks — the full-width action list.
// ============================================================================
// The drawer stays for quick capture from wherever you are; this is where you
// actually WORK the list. Same data, same rules (buckets never auto-roll, one
// shared list), laid out as four columns so the whole week is visible at once
// instead of scrolling a 420px rail.
//
// Deliberately reuses the panel's row component rather than growing a second
// one — two renderings of a task would drift the moment either changed.
// ============================================================================

import { useMemo, useState } from 'react'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import { useTasks } from '@/components/tasks/TasksProvider'
import { TaskRow, taskFirstName } from '@/components/tasks/TaskRow'
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
import { Check, Plus } from 'lucide-react'

export default function TasksPage() {
  const { user } = useAuth()
  const { enabled, tasks, assignees, projects, loading, refresh } = useTasks()

  const [filter, setFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [addingIn, setAddingIn] = useState<TaskBucket | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newAssignees, setNewAssignees] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<TaskBucket | null>(null)
  const [doneOpen, setDoneOpen] = useState(false)

  const myAssigneeId = useMemo(
    () => assignees.find((a) => a.userId && a.userId === user?.id)?.id ?? null,
    [assignees, user?.id],
  )

  const projectById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
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

  const visible = useMemo(
    () =>
      tasks.filter((t) => {
        if (filter === 'all') return true
        const target = filter === 'mine' ? myAssigneeId : filter
        if (!target) return false
        return t.assignee_ids.includes(target)
      }),
    [tasks, filter, myAssigneeId],
  )

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

  async function handleCreate(bucket: TaskBucket) {
    const title = newTitle.trim()
    if (!title || !user) return
    await run(async () => {
      await createTask({
        orgId: user.org_id,
        title,
        bucket,
        assigneeIds: newAssignees,
        createdBy: user.id,
      })
      setNewTitle('')
      setNewAssignees([])
      setAddingIn(null)
    })
  }

  async function handleDropInto(bucket: TaskBucket) {
    const id = dragId
    setDragId(null)
    setDragOver(null)
    if (!id) return
    const t = tasks.find((x) => x.id === id)
    if (!t || t.bucket === bucket) return
    await run(() => updateTask(id, { bucket, sort_order: -Date.now() }, user?.org_id))
  }

  if (!enabled) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Tasks aren’t available for this account.
      </div>
    )
  }

  return (
    <PlanGate requires="projects">
      <div className="min-h-screen bg-[#F9FAFB]">
        <div className="px-8 py-6 bg-white border-b border-[#E5E7EB]">
          <div className="max-w-[1400px] mx-auto">
            <h1 className="text-[22px] font-semibold text-[#111] tracking-tight">Tasks</h1>
            <p className="text-xs text-[#6B7280] mt-1">
              One list for the whole shop. Move things between buckets as priorities change —
              nothing reschedules itself.
            </p>
            <div className="flex items-center gap-1.5 flex-wrap mt-3">
              <Chip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
              <Chip label="Mine" active={filter === 'mine'} onClick={() => setFilter('mine')} />
              {pickable
                .filter((a) => a.id !== myAssigneeId)
                .map((a) => (
                  <Chip
                    key={a.id}
                    label={taskFirstName(a.name)}
                    active={filter === a.id}
                    onClick={() => setFilter(a.id)}
                  />
                ))}
            </div>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto px-8 py-6">
          {error && (
            <div className="mb-4 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading tasks…</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
              {TASK_BUCKETS.map((b) => (
                <section
                  key={b}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(b)
                  }}
                  onDragLeave={() => setDragOver((x) => (x === b ? null : x))}
                  onDrop={() => void handleDropInto(b)}
                  className={`bg-white border rounded-xl p-3 transition-colors ${
                    dragOver === b ? 'border-[#93C5FD] bg-[#F8FBFF]' : 'border-[#E5E7EB]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 px-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#6B7280]">
                      {BUCKET_LABEL[b]}
                    </span>
                    <span className="text-[10px] text-[#9CA3AF]">{byBucket[b].length}</span>
                  </div>

                  {byBucket[b].map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      project={t.project_id ? projectById.get(t.project_id) ?? null : null}
                      projects={projects}
                      assignees={pickable}
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
                  ))}

                  {addingIn === b ? (
                    <div className="mt-2 border border-[#BFDBFE] bg-[#EFF6FF] rounded-lg p-2 space-y-2">
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleCreate(b)
                          if (e.key === 'Escape') {
                            setAddingIn(null)
                            setNewTitle('')
                          }
                        }}
                        placeholder="What needs doing?"
                        className="w-full px-2 py-1.5 text-[13px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
                      />
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
                              {taskFirstName(a.name)}
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          disabled={busy || !newTitle.trim()}
                          onClick={() => void handleCreate(b)}
                          className="px-2.5 py-1 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
                        >
                          Add
                        </button>
                        <button
                          onClick={() => {
                            setAddingIn(null)
                            setNewTitle('')
                          }}
                          className="px-2.5 py-1 rounded-md border border-[#E5E7EB] text-[#374151] text-[12px] hover:bg-[#F9FAFB]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setAddingIn(b)
                        setNewTitle('')
                        setNewAssignees([])
                      }}
                      className="w-full mt-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md border border-dashed border-[#E5E7EB] text-[#9CA3AF] text-[11.5px] hover:border-[#2563EB] hover:text-[#2563EB] transition-colors"
                    >
                      <Plus className="w-3 h-3" /> Add
                    </button>
                  )}
                </section>
              ))}
            </div>
          )}

          {doneTasks.length > 0 && (
            <div className="mt-6 bg-white border border-[#E5E7EB] rounded-xl p-3">
              <button
                onClick={() => setDoneOpen((v) => !v)}
                className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF] hover:text-[#6B7280]"
              >
                Done · {doneTasks.length} {doneOpen ? '▾' : '▸'}
              </button>
              {doneOpen && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-x-4">
                  {doneTasks.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center gap-2 py-1.5 text-[13px] text-[#9CA3AF]"
                    >
                      <button
                        onClick={() => void run(() => setTaskDone(t.id, false, user?.org_id))}
                        title="Restore"
                        className="w-4 h-4 rounded border border-[#A7F3D0] bg-[#ECFDF5] text-[#059669] flex items-center justify-center flex-shrink-0"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <span className="line-through truncate">{t.title}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </PlanGate>
  )
}

function Chip({
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
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
        active
          ? 'bg-[#111] text-white border-[#111]'
          : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F9FAFB]'
      }`}
    >
      {label}
    </button>
  )
}
