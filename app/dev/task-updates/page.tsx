'use client'

// ============================================================================
// /dev/task-updates — fixture harness for the task modal (2026-11-24 round)
// ============================================================================
// Mounts the REAL TaskRow / TaskModal / NewTaskModal on a fixture roster, with
// the Supabase client's `from()` swapped for an in-memory table — so the real
// lib/tasks code (createTask, postTaskUpdate, markTaskSeen, listComments) runs
// end to end and nothing touches the database. "Viewing as" switches who's
// signed in, which is how you SEE a post re-alert someone else.
//
// The roster has two Matts on purpose: an ambiguous first name must insert
// the full name. Dev-only: production builds 404 it.
// ============================================================================

import { useCallback, useMemo, useState } from 'react'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { TasksContext, type TasksContextValue } from '@/components/tasks/TasksProvider'
import { NewTaskModal, TaskRow, type NewTaskPreset } from '@/components/tasks/TaskRow'
import {
  comparePriority,
  isUnseenBy,
  listTasks,
  localISO,
  markTaskSeen,
  needByForPick,
  type Task,
  type TaskAssignee,
} from '@/lib/tasks'

const ORG = 'org-fixture'
const ROSTER: TaskAssignee[] = [
  { id: 'm-andrew', name: 'Andrew Watson', userId: 'u-andrew', tasksEnabled: true },
  { id: 'm-hunter', name: 'Hunter Cole', userId: 'u-hunter', tasksEnabled: true },
  { id: 'm-kaylin', name: 'Kaylin Brooks', userId: 'u-kaylin', tasksEnabled: true },
  { id: 'm-matt-r', name: 'Matt Reyes', userId: 'u-matt-r', tasksEnabled: true },
  { id: 'm-matt-o', name: 'Matt Olsen', userId: null, tasksEnabled: true },
  { id: 'm-nick', name: 'Nicholas Hart', userId: 'u-nick', tasksEnabled: true },
]

type Row = Record<string, any>
const db: { tasks: Row[]; task_comments: Row[] } = { tasks: [], task_comments: [] }
let seq = 0

function seed() {
  const now = new Date().toISOString()
  db.tasks = [
    {
      id: 't1', org_id: ORG, project_id: 'p1', title: 'Set up Nicholas’s accounts', bucket: 'today',
      need_by: localISO(), assignee_ids: ['m-andrew', 'm-hunter'], done_at: null, created_by: 'u-kaylin',
      sort_order: 1, created_at: now, updated_at: now, links: [], tags: [], completed_by: null,
      acknowledged_at: null, critical: false, seen_by: ['m-andrew', 'm-hunter'], description: null,
    },
    {
      id: 't2', org_id: ORG, project_id: null, title: 'Order edge banding for Kinser', bucket: 'next_week',
      need_by: needByForPick('next_week'), assignee_ids: ['m-kaylin'], done_at: null, created_by: 'u-andrew',
      sort_order: 2, created_at: now, updated_at: now, links: [], tags: [], completed_by: null,
      acknowledged_at: null, critical: false, seen_by: ['m-kaylin'], description: null,
    },
  ]
  db.task_comments = [
    {
      id: 'c1', org_id: ORG, task_id: 't1', author_user_id: 'u-kaylin',
      body: 'Email is live — see https://millsuite.com/team. @Hunter can you add him to the shared drive?',
      created_at: new Date(Date.now() - 26 * 3600000).toISOString(),
    },
  ]
}

/** Just enough of the PostgREST builder for lib/tasks' task + comment calls. */
function fakeFrom(table: string) {
  const st = { op: 'select', body: null as Row | null, single: false, filters: [] as ((r: Row) => boolean)[] }
  const rows = (): Row[] => (db as any)[table] ?? []
  const exec = () => {
    let out: Row[]
    if (st.op === 'insert') {
      const now = new Date().toISOString()
      const r: Row = { id: `x${++seq}`, created_at: now, updated_at: now, done_at: null, ...st.body }
      rows().push(r)
      out = [r]
    } else {
      out = rows().filter((r) => st.filters.every((f) => f(r)))
      if (st.op === 'update') out.forEach((r) => Object.assign(r, st.body))
      if (st.op === 'delete') (db as any)[table] = rows().filter((r) => !out.includes(r))
    }
    const data = st.single ? out[0] ?? null : out
    return { data: JSON.parse(JSON.stringify(data)), error: null }
  }
  const b: any = {
    select: () => b,
    insert: (x: Row) => ((st.op = 'insert'), (st.body = x), b),
    update: (x: Row) => ((st.op = 'update'), (st.body = x), b),
    delete: () => ((st.op = 'delete'), b),
    eq: (k: string, v: unknown) => (st.filters.push((r) => r[k] === v), b),
    neq: (k: string, v: unknown) => (st.filters.push((r) => r[k] !== v), b),
    is: (k: string, v: unknown) => (st.filters.push((r) => (r[k] ?? null) === v), b),
    not: (k: string, _op: string, v: unknown) => (st.filters.push((r) => (r[k] ?? null) !== v), b),
    order: () => b,
    limit: () => b,
    single: () => ((st.single = true), b),
    maybeSingle: () => ((st.single = true), b),
    then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
  }
  return b
}

export default function TaskUpdatesFixture() {
  if (process.env.NODE_ENV === 'production') notFound()

  // Swap the client's table access for the in-memory one, once.
  useState(() => {
    seed()
    ;(supabase as any).from = fakeFrom
    return true
  })

  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [viewer, setViewer] = useState('m-andrew')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState<NewTaskPreset | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setTasks(await listTasks(ORG))
    setLoading(false)
  }, [])
  useState(() => void refresh())

  const me = ROSTER.find((r) => r.id === viewer)!
  const nameById = useMemo(() => new Map(ROSTER.map((r) => [r.id, r.name])), [])
  const nameByUserId = useMemo(
    () => new Map(ROSTER.filter((r) => r.userId).map((r) => [r.userId as string, r.name])),
    [],
  )
  const projects = useMemo(() => [{ id: 'p1', name: 'Kinser residence' }, { id: 'p2', name: 'Towers lobby' }], [])

  const markSeen = useCallback(
    (task: Task) => {
      if (!isUnseenBy(task, viewer)) return
      setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, seen_by: [...t.seen_by, viewer] } : t)))
      void markTaskSeen(task.id, viewer, ORG)
    },
    [viewer],
  )

  const value = useMemo(
    () =>
      ({
        enabled: true,
        tasks,
        assignees: ROSTER,
        projects,
        loading,
        refresh,
        myAssigneeId: viewer,
        nameByUserId,
        markSeen,
        taskTags: [{ name: 'Purchasing', color: 'amber' }],
        saveTags: async () => {},
        extrasAvailable: true,
      }) as unknown as TasksContextValue,
    [tasks, projects, loading, refresh, viewer, nameByUserId, markSeen],
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

  const names = (ids: string[]) => ids.map((id) => nameById.get(id) ?? id).join(', ') || '—'
  const unseenCount = tasks.filter((t) => isUnseenBy(t, viewer)).length

  return (
    <TasksContext.Provider value={value}>
      <div className="min-h-screen bg-[#F9FAFB] p-8">
        <div className="max-w-[640px] mx-auto space-y-4">
          <div className="flex items-center gap-3 flex-wrap text-[13px]">
            <span className="font-semibold text-[#111]">Task updates fixture</span>
            <label className="inline-flex items-center gap-1.5 text-[#6B7280]">
              Viewing as
              <select
                aria-label="Viewing as"
                value={viewer}
                onChange={(e) => {
                  setViewer(e.target.value)
                  setExpandedId(null)
                }}
                className="px-2 py-1 border border-[#E5E7EB] rounded-md bg-white"
              >
                {ROSTER.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <span data-testid="unseen" className="px-2 py-0.5 rounded-full bg-[#2563EB] text-white text-[11px]">
              unseen: {unseenCount}
            </span>
            <button
              onClick={() => setCreating({ needBy: localISO(), assigneeIds: [viewer] })}
              className="px-2.5 py-1 rounded-md border border-dashed border-[#D1D5DB] text-[#6B7280]"
            >
              + New task (Today, me)
            </button>
            <button
              onClick={() => setCreating({ needBy: needByForPick('next_week') })}
              className="px-2.5 py-1 rounded-md border border-dashed border-[#D1D5DB] text-[#6B7280]"
            >
              + Add (Next week)
            </button>
          </div>
          {error && <div className="text-[12px] text-[#B91C1C]">{error}</div>}
          <div className="bg-white border border-[#E5E7EB] rounded-xl p-3">
            {[...tasks].sort(comparePriority).map((t) => (
              <div key={t.id}>
                <TaskRow
                  task={t}
                  project={projects.find((p) => p.id === t.project_id) ?? null}
                  projects={projects}
                  assignees={ROSTER}
                  nameById={nameById}
                  nameByUserId={nameByUserId}
                  taskTags={value.taskTags}
                  onAddTag={async () => {}}
                  extrasAvailable
                  expanded={expandedId === t.id}
                  onToggleExpand={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                  onRun={run}
                  busy={busy}
                  orgId={ORG}
                  userId={me.userId}
                  onDragStart={() => {}}
                  onDragEnd={() => {}}
                  isDragging={false}
                />
                <div data-testid={`state-${t.id}`} className="pl-8 pb-2 text-[10.5px] text-[#9CA3AF] font-mono">
                  need_by {t.need_by ?? 'none'} · assignees: {names(t.assignee_ids)} · seen_by: {names(t.seen_by)}
                </div>
              </div>
            ))}
          </div>
        </div>
        {creating && (
          <NewTaskModal preset={creating} orgId={ORG} userId={me.userId} onClose={() => setCreating(null)} />
        )}
      </div>
    </TasksContext.Provider>
  )
}
