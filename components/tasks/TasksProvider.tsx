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
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '@/lib/auth-context'
import { useTagFilterState } from './use-tag-filter'
import { supabase } from '@/lib/supabase'
import {
  closeOutTask,
  extrasReady,
  listArchivedTasks,
  listAssignees,
  listCompletedForMe,
  listTaskTags,
  listTasks,
  saveTaskTags,
  type Task,
  type TaskAssignee,
  type TaskTag,
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
  /** MY open tasks — the nav badge. See the note where it's computed: this is
   *  deliberately not the org-wide count. */
  openCount: number
  /** The signed-in user's ROSTER id (`orgs.team_members[].id`), or null if
   *  their login isn't linked to a roster row. Computed once here because the
   *  badge, the panel and /tasks all need it and three copies would drift. */
  myAssigneeId: string | null
  /** Tasks I created that someone ELSE completed and I haven't closed out —
   *  the "Completed for you" strip (114). Empty pre-114. */
  completedForMe: Task[]
  /** The creator's "seen it" — drops a task out of the strip. */
  closeOut: (taskId: string) => Promise<void>
  /** LOGIN id (users.id) → display name, for `created_by` and comment authors.
   *  ⛔ A DIFFERENT MAP FROM the roster-id one the assignee chips use — see the
   *  header of lib/tasks. Built from the roster because RLS forbids the browser
   *  reading anyone else's `users` row; unlinked logins simply aren't in here
   *  and their name is not knowable client-side. */
  nameByUserId: Map<string, string>

  /** Completed tasks. Empty until someone opens the Archive — see loadArchive. */
  archive: Task[]
  archiveLoaded: boolean
  archiveLoading: boolean
  /** True when there are more completed tasks than we loaded. */
  archiveTruncated: boolean
  /** Fetch the archive. Cheap to call repeatedly; only the first one queries
   *  unless `force` is set. */
  loadArchive: (force?: boolean) => Promise<void>

  /** The org's tag registry (098). Empty pre-migration. */
  taskTags: TaskTag[]
  /** Selected tag names. Lives HERE, not in each surface — see the header of
   *  use-tag-filter for what happened when it didn't. */
  tagFilter: string[]
  toggleTagFilter: (name: string) => void
  clearTagFilter: () => void
  /** Replace the registry. Goes through updateOrgChecked. */
  saveTags: (tags: TaskTag[]) => Promise<void>
  /** False once the database has told us migration 098 isn't there — the
   *  links and tags affordances hide rather than throwing on every save. */
  extrasAvailable: boolean

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
  const [completedForMe, setCompletedForMe] = useState<Task[]>([])
  const [assignees, setAssignees] = useState<TaskAssignee[]>([])
  const [projects, setProjects] = useState<TaskProjectRef[]>([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [archive, setArchive] = useState<Task[]>([])
  const [archiveLoaded, setArchiveLoaded] = useState(false)
  const [archiveLoading, setArchiveLoading] = useState(false)
  const [archiveTruncated, setArchiveTruncated] = useState(false)
  const [taskTags, setTaskTags] = useState<TaskTag[]>([])
  const [extrasAvailable, setExtrasAvailable] = useState(true)
  // ONE instance for the whole app. Both surfaces read it off the context.
  const {
    selected: tagFilter,
    toggle: toggleTagFilter,
    clear: clearTagFilter,
  } = useTagFilterState()

  // Mirrored in a ref so `refresh` and `loadArchive` keep a STABLE identity.
  // Depending on the state directly would change `refresh` every time the
  // archive opened, and the mount effect below depends on `refresh` — so
  // opening the archive would silently re-fetch the project list too.
  const archiveLoadedRef = useRef(false)

  const pullArchive = useCallback(async (id: string) => {
    const page = await listArchivedTasks(id)
    // ⛔ A FAILED FETCH MUST NOT COUNT AS LOADED. Marking it loaded would make
    // the panel say "Nothing completed yet" and then cache that forever —
    // re-opening the section wouldn't retry, because loadArchive short-circuits
    // on the ref. Leave it unloaded so the next open has another go.
    if (page.failed) return
    setArchive(page.tasks)
    setArchiveTruncated(page.truncated)
    archiveLoadedRef.current = true
    setArchiveLoaded(true)
  }, [])

  /** Guards against two fetches racing — a click landing while `refresh` is
   *  already pulling the archive would otherwise double-fetch and could apply
   *  the results out of order. */
  const archiveInFlight = useRef(false)

  /** Fetch completed tasks. Deliberately NOT part of `refresh` — the archive
   *  grows without bound and most sessions never open it. */
  const loadArchive = useCallback(
    async (force = false) => {
      if (!orgId) return
      if (archiveLoadedRef.current && !force) return
      if (archiveInFlight.current) return
      archiveInFlight.current = true
      setArchiveLoading(true)
      try {
        await pullArchive(orgId)
      } finally {
        archiveInFlight.current = false
        setArchiveLoading(false)
      }
    },
    [orgId, pullArchive],
  )

  // Switching org (or signing out to a worker session) must not leave the
  // previous shop's completed tasks on screen. With no orgId `refresh` returns
  // early, so nothing else would ever clear them.
  useEffect(() => {
    archiveLoadedRef.current = false
    archiveInFlight.current = false
    setArchive([])
    setArchiveLoaded(false)
    setArchiveTruncated(false)
    setTaskTags([])
  }, [orgId])

  const refresh = useCallback(async () => {
    if (!orgId) return
    const [t, a, cfm] = await Promise.all([
      listTasks(orgId),
      listAssignees(orgId),
      // ⚠️ AFTER listTasks in source order but concurrent in time — it probes
      // the 114 columns itself and returns [] on a pre-114 database, so it
      // can't blank anything else.
      user?.id ? listCompletedForMe(orgId, user.id) : Promise.resolve([]),
    ])
    setTasks(t)
    setAssignees(a)
    setCompletedForMe(cfm)
    // listTasks probes for 098 — read the verdict once it has answered.
    setExtrasAvailable(extrasReady())
    setLoading(false)
    // Completing a task moves it OUT of `tasks` and INTO the archive. If the
    // archive is already on screen it has to follow, or the task vanishes from
    // both lists and looks deleted.
    if (archiveLoadedRef.current) await pullArchive(orgId)
  }, [orgId, user?.id, pullArchive])

  const closeOut = useCallback(
    async (taskId: string) => {
      if (!orgId) return
      await closeOutTask(taskId, orgId)
      await refresh()
    },
    [orgId, refresh],
  )

  const saveTags = useCallback(
    async (tags: TaskTag[]) => {
      if (!orgId) return
      await saveTaskTags(orgId, tags)
      setTaskTags(await listTaskTags(orgId))
    },
    [orgId],
  )

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
      // Alphabetical, sorted HERE so every picker built from this list agrees
      // (the row editor, both quick-create forms). It was newest-first, which
      // makes a dropdown a memory test — Andrew asked for A→Z (2026-09-17).
      // Client-side localeCompare rather than the query's .order(): Postgres
      // sorts by the column's collation, which is case-SENSITIVE ("Zeta"
      // before "alpha") unless the database says otherwise.
      setProjects(
        ((data || []) as TaskProjectRef[]).sort((a, b) =>
          (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }),
        ),
      )
    })()
    // Tag registry — its own isolated select, so a pre-098 org gets an empty
    // list rather than a failed read.
    void listTaskTags(orgId).then(setTaskTags)
  }, [orgId, refresh])

  const openCountByProject = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of tasks) {
      if (t.done_at || !t.project_id) continue
      out[t.project_id] = (out[t.project_id] || 0) + 1
    }
    return out
  }, [tasks])

  /** Signed-in login → their roster entry. Null when nobody on the roster
   *  carries this user_id, which is normal: the bridge is only written when
   *  someone links a team member to a login on /team. */
  const myAssigneeId = useMemo(
    () => assignees.find((a) => a.userId && a.userId === user?.id)?.id ?? null,
    [assignees, user?.id],
  )

  /**
   * LOGIN id → name, for "added by" and comment authors.
   *
   * ⛔ This is NOT the assignee map. Tasks carry two different kinds of id and
   * mixing them up fails SILENTLY: the old comment header looked an
   * `author_user_id` up in the roster-id map, never matched, and rendered
   * "Someone" on every comment in the system.
   *
   * The roster is the only client-side source, because `users_select_self`
   * (084) forbids reading another login's row from the browser. Someone whose
   * login isn't linked on /team therefore CANNOT be named here — callers omit
   * the line rather than printing "Unknown", which would be noise on every
   * task in a shop that hasn't done the linking pass.
   */
  const nameByUserId = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of assignees) {
      if (a.userId) m.set(a.userId, a.name)
    }
    // The signed-in user always resolves, even before /team links them —
    // their own name is on the session.
    if (user?.id && user.name && !m.has(user.id)) m.set(user.id, user.name)
    return m
  }, [assignees, user?.id, user?.name])

  /**
   * The nav badge: MY open tasks, not the org's.
   *
   * It counted every open task in the org, so the blue dot was permanently lit
   * for everyone the moment anyone had anything outstanding — which makes it
   * decoration rather than a signal. A badge should mean "you owe something".
   *
   * ⚠️ The fallback matters. If this user's login ISN'T linked to a roster row
   * (`myAssigneeId === null`) they cannot be assigned anything, so a personal
   * count would be a permanent, undiagnosable zero. Falling back to the
   * org-wide count instead makes the misconfiguration VISIBLE — a badge that
   * counts everything means "link this login on /team", which is a thing
   * someone can act on. Silence isn't.
   */
  const openCount = useMemo(() => {
    const open = tasks.filter((t) => !t.done_at)
    if (!myAssigneeId) return open.length
    return open.filter((t) => t.assignee_ids.includes(myAssigneeId)).length
  }, [tasks, myAssigneeId])

  const openPanel = useCallback((opts?: { projectId?: string | null }) => {
    if (opts && 'projectId' in opts) setProjectFilter(opts.projectId ?? null)
    setPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => setPanelOpen(false), [])

  const value = useMemo<TasksContextValue>(
    () => ({
      enabled,
      tasks,
      completedForMe,
      closeOut,
      assignees,
      projects,
      loading,
      refresh,
      openCountByProject,
      openCount,
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
      openPanel,
      closePanel,
      projectFilter,
      setProjectFilter,
    }),
    [
      enabled,
      tasks,
      completedForMe,
      closeOut,
      assignees,
      projects,
      loading,
      refresh,
      openCountByProject,
      openCount,
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
      openPanel,
      closePanel,
      projectFilter,
    ],
  )

  return <TasksContext.Provider value={value}>{children}</TasksContext.Provider>
}
