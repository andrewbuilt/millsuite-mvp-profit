'use client'

// ============================================================================
// TasksProvider — one shared task store + the slide-out panel's open state.
// ============================================================================
// Three surfaces reach the same data: the nav trigger (with its open-count
// badge), the panel itself, and the project page's "+ Task" / "Tasks · N".
// They share ONE provider so a task created from a project page updates the
// nav badge without a reload, and so the list isn't fetched three times.
//
// Mounted in app/(app)/layout.tsx beside TopNav. Role-gated there: workers
// live in /me and have no part in this list in v1.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import {
  listAssignees,
  listTasks,
  type Task,
  type TaskAssignee,
} from '@/lib/tasks'

/** Lightweight project reference for the chips + the project picker. */
export interface TaskProjectRef {
  id: string
  name: string
}

interface TasksContextValue {
  /** False for workers — every surface renders nothing rather than an empty
   *  list that looks broken. */
  enabled: boolean
  tasks: Task[]
  assignees: TaskAssignee[]
  projects: TaskProjectRef[]
  loading: boolean
  /** Re-read from the database. Called after every write. */
  refresh: () => Promise<void>
  /** Open tasks per project id — the project page's "Tasks · N". */
  openCountByProject: Record<string, number>
  openCount: number

  panelOpen: boolean
  /** Opening with a projectId pre-filters the panel to that project. */
  openPanel: (opts?: { projectId?: string | null }) => void
  closePanel: () => void
  projectFilter: string | null
  setProjectFilter: (id: string | null) => void
}

/** Exported so a dev harness can render the panel against fixture data — the
 *  panel needs auth + migration 093 to be reachable in the app, and a
 *  copied-markup mock would drift from what ships. Nothing in the app should
 *  consume this directly; use the hooks. */
export const TasksContext = createContext<TasksContextValue | null>(null)
export type { TasksContextValue }

export function useTasks(): TasksContextValue {
  const ctx = useContext(TasksContext)
  if (!ctx) {
    throw new Error('useTasks must be used inside <TasksProvider>')
  }
  return ctx
}

/** Safe variant for surfaces that may render outside the provider (e.g. a
 *  worker's `/me`, where the provider isn't mounted). Returns null rather
 *  than throwing, so a "+ Task" button can simply not render. */
export function useTasksOptional(): TasksContextValue | null {
  return useContext(TasksContext)
}

export function TasksProvider({ children }: { children: ReactNode }) {
  const { org, user } = useAuth()
  // Workers live in /me and have no part in this list in v1 (extending it to
  // them is a later item if it earns one). Gating HERE rather than only
  // hiding the button means a worker's session never fetches the org's task
  // list at all.
  const enabled = !!user && user.role !== 'member'
  const orgId = enabled ? org?.id ?? null : null

  const [tasks, setTasks] = useState<Task[]>([])
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [projects, setProjects] = useState<TaskProjectRef[]>([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!orgId) return
    const [t, a] = await Promise.all([listTasks(orgId), listAssignees(orgId)])
    setTasks(t)
    setAssignees(a)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    if (!orgId) return
    void refresh()
    // Project names for the chips. Deliberately a thin select of its own
    // rather than reusing loadSalesProjects — that pulls subprojects and
    // pricing this panel has no use for.
    ;(async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
      setProjects((data || []) as TaskProjectRef[])
    })()
  }, [orgId, refresh])

  const openCountByProject = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of tasks) {
      if (t.done_at || !t.project_id) continue
      out[t.project_id] = (out[t.project_id] || 0) + 1
    }
    return out
  }, [tasks])

  const openCount = useMemo(() => tasks.filter((t) => !t.done_at).length, [tasks])

  const openPanel = useCallback((opts?: { projectId?: string | null }) => {
    if (opts && 'projectId' in opts) setProjectFilter(opts.projectId ?? null)
    setPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => setPanelOpen(false), [])

  const value = useMemo<TasksContextValue>(
    () => ({
      enabled,
      tasks,
      assignees,
      projects,
      loading,
      refresh,
      openCountByProject,
      openCount,
      panelOpen,
      openPanel,
      closePanel,
      projectFilter,
      setProjectFilter,
    }),
    [
      enabled,
      tasks,
      assignees,
      projects,
      loading,
      refresh,
      openCountByProject,
      openCount,
      panelOpen,
      openPanel,
      closePanel,
      projectFilter,
    ],
  )

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}
