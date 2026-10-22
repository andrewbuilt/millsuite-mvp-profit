'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_TIME_FILTER,
  isFilterActive,
  isoDate,
  matchesTimeFilter,
  type TimeFilter,
  type TimeRangeChip,
} from '@/lib/time-filters'
import { triggerPhaseAdvance, triggerProjectRollup } from '@/lib/phase-client'
import { loadArchivedProjectIds } from '@/lib/project-archive'
import { useAuth } from '@/lib/auth-context'
import { Play, Square, Trash2, Pencil, Check, X, Clock, BookOpen, Download, Search } from 'lucide-react'
import { fmtActualHours } from '@/lib/actual-hours'
import {
  loadActiveEntry,
  clockIn,
  clockOut,
  type TimeEntry as WorkerTimeEntry,
} from '@/lib/worker-time'

// ─── Types ────────────────────────────────────────────────────────────
interface Project {
  id: string
  name: string
  stage: string
}

interface Subproject {
  id: string
  project_id: string
  name: string
}

interface Department {
  id: string
  name: string
  display_order: number
  active: boolean
}

interface TimeEntry {
  id: string
  /** The LOGIN that tracked it (users.id). ⛔ NOT a roster id — resolve it
   *  through `orgs.team_members[].user_id` to get a name. The browser cannot
   *  read another login's `users` row (users_select_self, 084), so a
   *  `users(name)` join comes back NULL for everyone but the viewer. */
  user_id: string | null
  project_id: string
  subproject_id: string | null
  department_id: string | null
  duration_minutes: number
  notes: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  /** Migration 117 — last manual edit on this page. Absent pre-117. */
  edited_by?: string | null
  edited_at?: string | null
  project?: Project
  subproject?: Subproject
  department?: Department
}

// ⛔ THE RUNNING TIMER IS THE OPEN time_entries ROW (ended_at null) — the
// same row /me's clock-in writes. This page used to keep its timer in
// localStorage and only insert a row on Stop, so a timer started here was
// invisible to the phone (and vice versa) — the October-batch item 4 bug.
// The old key is read ONCE, to adopt a timer that was running at deploy time.
interface LegacyTimerState {
  projectId: string
  subprojectId: string
  departmentId: string
  startedAt: string // ISO string
  notes: string
}

const LEGACY_TIMER_KEY = 'millsuite_timer'

/** How often to re-read the open row while the page is visible — so a timer
 *  started or stopped on another device shows up within seconds. */
const TIMER_POLL_MS = 15000

// ─── Helpers ──────────────────────────────────────────────────────────
// Tracked time renders through the shared fmtActualHours ("2h 34m"). The local
// formatHours ("2.6 hrs") is gone — three pages each had their own, which is
// how the same minutes came out three different ways.

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':')
}

function dateLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)

  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function groupByDate(entries: TimeEntry[]): Record<string, TimeEntry[]> {
  const groups: Record<string, TimeEntry[]> = {}
  for (const e of entries) {
    const key = (e.started_at || e.created_at).slice(0, 10)
    if (!groups[key]) groups[key] = []
    groups[key].push(e)
  }
  return groups
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function TimePage() {
  const { org, user } = useAuth()
  // Shared data
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojectsMap, setSubprojectsMap] = useState<Record<string, Subproject[]>>({})
  const [departments, setDepartments] = useState<Department[]>([])
  const [entries, setEntries] = useState<TimeEntry[]>([])
  // ⛔ THE ROSTER IS HOW A NAME IS RESOLVED. `time_entries.user_id` is a LOGIN
  // id, and `users_select_self` (084) stops the browser reading anyone else's
  // users row — a `users(name)` join returns null for every entry but your
  // own. `orgs.team_members[].user_id` is the only client-side bridge, which
  // is the same rule the task system follows for `created_by`.
  const [roster, setRoster] = useState<Array<{ id: string; name: string; userId: string | null }>>([])
  /**
   * ⛔ SEEDED FROM `?member=`, so /team's "tracked this week" link lands on a
   * filtered timesheet instead of the whole shop's. Without this the link is
   * silently a no-op — the page opens, looks right, and shows everyone.
   *
   * Read in the INITIALISER, not an effect: applying it afterwards paints
   * every entry for a beat and then snaps to one person, which reads as the
   * filter having been applied by accident.
   *
   * ⚠️ `window` is guarded because this initialiser also runs during the
   * server render, where there is no location.
   */
  const [filter, setFilter] = useState<TimeFilter>(() => {
    if (typeof window === 'undefined') return EMPTY_TIME_FILTER
    const q = new URLSearchParams(window.location.search)
    const memberId = q.get('member')
    // ⛔ `?project=` MUST carry a `projects.id`. /reports links here from the
    // diagnostic drawer to answer "which hours are these?", and the object it
    // links from holds a `project_outcomes.id` in its `.id` field — pass that
    // by mistake and this page filters to nothing and reads as "no time was
    // tracked on this job". A wrong answer in the shape of a real one.
    const projectId = q.get('project')
    const next = { ...EMPTY_TIME_FILTER }
    if (memberId) next.memberId = memberId
    if (projectId) next.projectId = projectId
    return next
  })
  const [loading, setLoading] = useState(true)

  // Timer state
  const [timerActive, setTimerActive] = useState(false)
  const [timerProjectId, setTimerProjectId] = useState('')
  const [timerSubprojectId, setTimerSubprojectId] = useState('')
  const [timerDepartmentId, setTimerDepartmentId] = useState('')
  const [timerNotes, setTimerNotes] = useState('')
  const [timerStartedAt, setTimerStartedAt] = useState<Date | null>(null)
  /** The open row this timer IS. Null when stopped. */
  const [activeEntry, setActiveEntry] = useState<WorkerTimeEntry | null>(null)
  const [timerError, setTimerError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [saved, setSaved] = useState(false)

  // Manual entry state
  const [manualDate, setManualDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [manualProjectId, setManualProjectId] = useState('')
  const [manualSubprojectId, setManualSubprojectId] = useState('')
  const [manualDepartmentId, setManualDepartmentId] = useState('')
  const [manualHours, setManualHours] = useState('')
  const [manualNotes, setManualNotes] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editHours, setEditHours] = useState('')
  const [editProjectId, setEditProjectId] = useState('')
  const [editSubprojectId, setEditSubprojectId] = useState('')
  const [editDepartmentId, setEditDepartmentId] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  // ── Fetch projects ────────────────────────────────────────────────
  const fetchProjects = useCallback(async () => {
    if (!org?.id) return
    const [{ data }, archived] = await Promise.all([
      supabase.from('projects').select('id, name, stage').eq('org_id', org.id).order('name'),
      loadArchivedProjectIds(org.id),
    ])
    if (data) setProjects(data)
    setArchivedIds(archived)
  }, [org?.id])
  // Archived projects (119) stay in the list so past entries keep their names
  // and the filter can find them; the pickers for NEW time leave them out,
  // except whichever one is already selected.
  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set())
  const pickableProjects = (selectedId?: string | null) =>
    projects.filter((p) => !archivedIds.has(p.id) || p.id === selectedId)

  // ── Fetch departments ─────────────────────────────────────────────
  // Active departments only; filter management out the same way /schedule
  // does, since time entries should count against production depts.
  const fetchDepartments = useCallback(async () => {
    if (!org?.id) return
    const { data } = await supabase
      .from('departments')
      .select('id, name, display_order, active')
      .eq('org_id', org.id)
      .eq('active', true)
      .order('display_order')
    if (data) {
      setDepartments(
        data.filter((d) => !d.name.toLowerCase().includes('management'))
      )
    }
  }, [org?.id])

  // ── Fetch subprojects for a project (cached) ─────────────────────
  const fetchSubprojects = useCallback(async (projectId: string) => {
    if (!projectId) return
    if (subprojectsMap[projectId]) return
    const { data } = await supabase
      .from('subprojects')
      .select('id, project_id, name')
      .eq('project_id', projectId)
      .order('name')
    if (data) {
      setSubprojectsMap(prev => ({ ...prev, [projectId]: data }))
    }
  }, [subprojectsMap])

  // ── Fetch recent time entries ─────────────────────────────────────
  const fetchEntries = useCallback(async () => {
    if (!org?.id) return
    // ⛔ 30 DAYS, NOT 7. The "Last week" chip reaches up to 13 days back, so a
    // 7-day fetch made that filter silently return nothing — the filter would
    // have looked broken when the data simply wasn't loaded. Filtering is
    // client-side at shop scale, so the window has to cover the widest chip.
    const windowStart = new Date()
    windowStart.setDate(windowStart.getDate() - 30)

    const { data } = await supabase
      .from('time_entries')
      .select('*, project:projects(id, name, stage), subproject:subprojects(id, project_id, name), department:departments(id, name)')
      .eq('org_id', org.id)
      .gte('created_at', windowStart.toISOString())
      .order('created_at', { ascending: false })

    // The open row is the running timer (shown above), not a 0-minute entry.
    if (data) setEntries((data as TimeEntry[]).filter((e) => e.ended_at !== null))
  }, [])

  // ── Roster, for resolving who tracked each entry ──────────────────
  useEffect(() => {
    if (!org?.id) return
    let alive = true
    void (async () => {
      const { data } = await supabase
        .from('orgs')
        .select('team_members')
        .eq('id', org.id)
        .maybeSingle()
      if (!alive) return
      const raw = (data as { team_members?: unknown } | null)?.team_members
      const rows = Array.isArray(raw) ? raw : []
      setRoster(
        rows
          .map((m: any) => ({
            id: String(m?.id ?? ''),
            name: String(m?.name ?? '').trim(),
            userId: m?.user_id ? String(m.user_id) : null,
          }))
          .filter((m) => m.id && m.name)
          .sort((a, b) => a.name.localeCompare(b.name)),
      )
    })()
    return () => {
      alive = false
    }
  }, [org?.id])

  /** LOGIN id → roster member. The bridge; see the `roster` declaration. */
  const memberByUserId = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const r of roster) if (r.userId) m.set(r.userId, { id: r.id, name: r.name })
    return m
  }, [roster])

  /** The entry's LOCAL calendar day. ⛔ `started_at` when present — that's when
   *  the work happened; `created_at` is when the row was written, and a manual
   *  entry for last Tuesday is created today. Filtering on the wrong one puts
   *  back-dated hours in the wrong week. */
  const entryDay = useCallback((e: TimeEntry) => {
    const src = e.started_at || e.created_at
    return isoDate(new Date(src))
  }, [])

  const visibleEntries = useMemo(() => {
    if (!isFilterActive(filter)) return entries
    return entries.filter((e) => {
      const member = e.user_id ? memberByUserId.get(e.user_id) : undefined
      const haystack = [
        (e.project as any)?.name,
        (e.subproject as any)?.name,
        (e.department as any)?.name,
        e.notes,
        member?.name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesTimeFilter(
        {
          projectId: e.project_id ?? null,
          memberId: member?.id ?? null,
          day: entryDay(e),
          haystack,
        },
        filter,
      )
    })
  }, [entries, filter, memberByUserId, entryDay])

  // ── Sync the timer from the open row ──────────────────────────────
  /** Make the timer UI mirror the open row (or its absence). */
  const activeIdRef = useRef<string | null>(null)
  const applyActive = useCallback((row: WorkerTimeEntry | null) => {
    activeIdRef.current = row?.id ?? null
    setActiveEntry(row)
    if (row && row.started_at) {
      setTimerProjectId(row.project_id)
      setTimerSubprojectId(row.subproject_id || '')
      setTimerDepartmentId(row.department_id || '')
      setTimerNotes(row.notes || '')
      setTimerStartedAt(new Date(row.started_at))
      setTimerActive(true)
      if (row.project_id) fetchSubprojects(row.project_id)
    } else {
      setTimerActive(false)
      setTimerStartedAt(null)
    }
  }, [fetchSubprojects])

  const syncTimer = useCallback(async () => {
    if (!user?.id) return
    const row = await loadActiveEntry(user.id)
    // A different open row (or none) than we're showing → another device
    // started/stopped/switched. Same row → leave local edits (notes) alone.
    if ((row?.id ?? null) !== activeIdRef.current) {
      applyActive(row)
      fetchEntries()
    }
  }, [user?.id, applyActive, fetchEntries])

  // First load: adopt the open row; if there is none but this browser still
  // holds a pre-fix localStorage timer, turn THAT into the open row once so
  // nobody loses the span that was running when this shipped.
  useEffect(() => {
    if (!user?.id || !org?.id) return
    let alive = true
    void (async () => {
      let row = await loadActiveEntry(user.id)
      let legacy: LegacyTimerState | null = null
      try {
        const raw = localStorage.getItem(LEGACY_TIMER_KEY)
        if (raw) legacy = JSON.parse(raw)
      } catch { /* unreadable → ignore */ }
      if (!row && legacy?.projectId && legacy.startedAt) {
        try {
          const { data } = await supabase
            .from('time_entries')
            .insert({
              org_id: org.id,
              user_id: user.id,
              project_id: legacy.projectId,
              subproject_id: legacy.subprojectId || null,
              department_id: legacy.departmentId || null,
              notes: legacy.notes || null,
              started_at: legacy.startedAt,
              ended_at: null,
              duration_minutes: 0,
            })
            .select('*')
            .single()
          row = (data as WorkerTimeEntry) || null
        } catch (e) {
          console.error('adopt legacy timer', e)
        }
      }
      try { localStorage.removeItem(LEGACY_TIMER_KEY) } catch { /* noop */ }
      if (alive) applyActive(row)
    })()
    return () => {
      alive = false
    }
  }, [user?.id, org?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-read on focus / tab-visible, and poll while visible.
  useEffect(() => {
    if (!user?.id) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncTimer()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void syncTimer()
    }, TIMER_POLL_MS)
    return () => {
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(t)
    }
  }, [user?.id, syncTimer])

  // ── Tick the timer ────────────────────────────────────────────────
  useEffect(() => {
    if (timerActive && timerStartedAt) {
      const tick = () => {
        setElapsed(Math.floor((Date.now() - timerStartedAt.getTime()) / 1000))
      }
      tick()
      intervalRef.current = setInterval(tick, 1000)
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    } else {
      setElapsed(0)
    }
  }, [timerActive, timerStartedAt])

  // ── Init data ─────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([fetchProjects(), fetchDepartments(), fetchEntries()]).then(() =>
      setLoading(false)
    )
  }, [fetchProjects, fetchDepartments, fetchEntries])

  // ── Timer project change → load subs ──────────────────────────────
  useEffect(() => {
    if (timerProjectId) fetchSubprojects(timerProjectId)
  }, [timerProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (manualProjectId) fetchSubprojects(manualProjectId)
  }, [manualProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Start timer ───────────────────────────────────────────────────
  // clockIn closes any other open row for this login first — the same
  // one-running-timer rule the phone follows.
  async function handleStart() {
    if (!timerProjectId || !org?.id || !user?.id) return
    setTimerError(null)
    try {
      const row = await clockIn({
        orgId: org.id,
        userId: user.id,
        projectId: timerProjectId,
        subprojectId: timerSubprojectId || null,
        departmentId: timerDepartmentId || null,
        notes: timerNotes || null,
      })
      applyActive(row)
      fetchEntries()
    } catch (e) {
      setTimerError(e instanceof Error ? e.message : 'Could not start the timer.')
    }
  }

  // ── Stop timer ────────────────────────────────────────────────────
  async function handleStop() {
    if (!activeEntry) return
    setTimerError(null)
    const projectId = activeEntry.project_id
    try {
      // Re-read first: if another device already stopped it, don't stamp an
      // end on a row that's closed (or clobber a newer one).
      const current = user?.id ? await loadActiveEntry(user.id) : null
      if (current && current.id === activeEntry.id) {
        // Carry the mid-span department / notes edits onto the row.
        await supabase
          .from('time_entries')
          .update({ department_id: timerDepartmentId || null })
          .eq('id', current.id)
        await clockOut(current, timerNotes || null)
        // Sub-minute spans still count as a minute, as before.
        const mins = Math.round((Date.now() - new Date(current.started_at || Date.now()).getTime()) / 60000)
        if (mins < 1) {
          await supabase.from('time_entries').update({ duration_minutes: 1 }).eq('id', current.id)
        }
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    } catch (e) {
      setTimerError(e instanceof Error ? e.message : 'Could not stop the timer.')
      return
    }

    // Fire-and-forget: recompute project actuals + try to advance phase.
    if (projectId) {
      void triggerProjectRollup(projectId)
      void triggerPhaseAdvance(projectId)
    }

    setTimerNotes('')
    setTimerDepartmentId('')
    setElapsed(0)
    applyActive(null)
    fetchEntries()
  }

  // ── Manual save ───────────────────────────────────────────────────
  async function handleManualSave() {
    if (!manualProjectId || !manualHours) return
    setManualSaving(true)

    const durationMinutes = Math.round(parseFloat(manualHours) * 60)
    const startedAt = new Date(manualDate + 'T09:00:00')

    await supabase.from('time_entries').insert({
      org_id: org?.id,
      user_id: user?.id,
      project_id: manualProjectId,
      subproject_id: manualSubprojectId || null,
      department_id: manualDepartmentId || null,
      duration_minutes: durationMinutes,
      notes: manualNotes || null,
      started_at: startedAt.toISOString(),
      ended_at: new Date(startedAt.getTime() + durationMinutes * 60000).toISOString(),
    })

    if (manualProjectId) {
      void triggerProjectRollup(manualProjectId)
      void triggerPhaseAdvance(manualProjectId)
    }

    setManualHours('')
    setManualNotes('')
    setManualDepartmentId('')
    setManualSaving(false)
    fetchEntries()
  }

  // ── Inline edit (hours · project/subproject · department) ─────────
  // October batch item 3: any manager can correct an entry, not just its
  // hours. /time is already owner+manager only (RoleGate sends workers to
  // /me) and time_entries' policy is org-wide (100), so there is no extra
  // gate to open — the gap was the editor itself.
  function startEdit(entry: TimeEntry) {
    setEditingId(entry.id)
    setEditError(null)
    setEditHours((entry.duration_minutes / 60).toFixed(2))
    setEditProjectId(entry.project_id)
    setEditSubprojectId(entry.subproject_id || '')
    setEditDepartmentId(entry.department_id || '')
    if (entry.project_id) fetchSubprojects(entry.project_id)
  }

  useEffect(() => {
    if (editProjectId) fetchSubprojects(editProjectId)
  }, [editProjectId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleEditSave(entry: TimeEntry) {
    const durationMinutes = Math.round(parseFloat(editHours) * 60)
    if (isNaN(durationMinutes) || durationMinutes <= 0 || !editProjectId) return
    setEditError(null)

    const patch: Record<string, unknown> = {
      duration_minutes: durationMinutes,
      project_id: editProjectId,
      subproject_id: editSubprojectId || null,
      department_id: editDepartmentId || null,
      // Cheap honesty, not an audit trail (117): who last touched it, when.
      edited_by: user?.id ?? null,
      edited_at: new Date().toISOString(),
    }
    // Keep ended_at consistent with the new duration so anything reading the
    // span (rather than duration_minutes) agrees with what was typed.
    if (entry.started_at) {
      patch.ended_at = new Date(new Date(entry.started_at).getTime() + durationMinutes * 60000).toISOString()
    }
    const run = (body: Record<string, unknown>) =>
      supabase.from('time_entries').update(body).eq('id', entry.id).select('id')
    let { data, error } = await run(patch)
    // Pre-117: the stamps don't exist yet — save the edit without them.
    if (error && String((error as { code?: string }).code) === '42703') {
      const { edited_by: _b, edited_at: _a, ...rest } = patch
      ;({ data, error } = await run(rest))
    }
    if (error || !data || data.length === 0) {
      setEditError(error?.message || 'The database refused the edit.')
      return
    }

    // Both jobs' actuals move when an entry changes project.
    for (const pid of new Set([entry.project_id, editProjectId])) {
      if (pid) {
        void triggerProjectRollup(pid)
        void triggerPhaseAdvance(pid)
      }
    }
    setEditingId(null)
    fetchEntries()
  }

  // ── Delete entry ──────────────────────────────────────────────────
  async function handleDelete(id: string) {
    await supabase.from('time_entries').delete().eq('id', id)
    fetchEntries()
  }

  // ── Persist mid-span department / notes onto the open row ─────────
  // Users can switch department mid-span if they realise they miscategorised.
  // Debounced write to the row itself, so the phone sees it too.
  useEffect(() => {
    if (!timerActive || !activeEntry) return
    if (
      (activeEntry.notes || '') === timerNotes &&
      (activeEntry.department_id || '') === timerDepartmentId
    ) return
    const t = setTimeout(() => {
      void supabase
        .from('time_entries')
        .update({ notes: timerNotes || null, department_id: timerDepartmentId || null })
        .eq('id', activeEntry.id)
        .is('ended_at', null)
        .then(() =>
          setActiveEntry((cur) =>
            cur && cur.id === activeEntry.id
              ? { ...cur, notes: timerNotes || null, department_id: timerDepartmentId || null }
              : cur,
          ),
        )
    }, 800)
    return () => clearTimeout(t)
  }, [timerNotes, timerDepartmentId, timerActive, activeEntry])

  // ── Shared styles ─────────────────────────────────────────────────
  const selectClass =
    'w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl bg-white text-[#111] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB] transition-colors'
  const inputClass = selectClass
  const btnPrimary =
    'px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  const grouped = groupByDate(visibleEntries)
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
  const projectName = projects.find(p => p.id === timerProjectId)?.name
  const timerSubs = subprojectsMap[timerProjectId] || []

  // ── Render ────────────────────────────────────────────────────────
  return (
    <>

      {/* ═══════ MOBILE TIMER VIEW ═══════ */}
      <div className="md:hidden min-h-[calc(100vh-3.5rem)] bg-[#F9FAFB] flex flex-col">
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          {/* Timer display */}
          <div className="text-6xl font-mono tabular-nums font-bold text-[#111] mb-8">
            {formatElapsed(elapsed)}
          </div>

          {timerActive && (
            <div className="flex items-center gap-2 mb-6">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
              </span>
              <span className="text-sm text-[#6B7280]">{projectName}</span>
            </div>
          )}

          {saved && (
            <div className="mb-6 px-4 py-2 bg-[#ECFDF5] text-[#059669] text-sm font-medium rounded-xl">
              Time saved!
            </div>
          )}
          {timerError && (
            <div className="mb-6 px-4 py-2 bg-[#FEF2F2] text-[#B91C1C] text-sm rounded-xl">
              {timerError}
            </div>
          )}

          {/* Controls — shown when stopped */}
          {!timerActive && (
            <div className="w-full max-w-xs space-y-3 mb-8">
              <select
                value={timerProjectId}
                onChange={e => { setTimerProjectId(e.target.value); setTimerSubprojectId('') }}
                className="w-full px-4 py-3 text-base border border-[#E5E7EB] rounded-xl bg-white"
              >
                <option value="">Select project...</option>
                {pickableProjects(timerProjectId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {timerSubs.length > 0 && (
                <select
                  value={timerSubprojectId}
                  onChange={e => setTimerSubprojectId(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-[#E5E7EB] rounded-xl bg-white"
                >
                  <option value="">Subproject (optional)</option>
                  {timerSubs.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {departments.length > 0 && (
                <select
                  value={timerDepartmentId}
                  onChange={e => setTimerDepartmentId(e.target.value)}
                  className="w-full px-4 py-3 text-base border border-[#E5E7EB] rounded-xl bg-white"
                >
                  <option value="">Department (optional)</option>
                  {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
              <input
                type="text"
                value={timerNotes}
                onChange={e => setTimerNotes(e.target.value)}
                placeholder="What are you working on?"
                className="w-full px-4 py-3 text-base border border-[#E5E7EB] rounded-xl bg-white"
              />
            </div>
          )}

          {/* Big button */}
          <button
            onClick={timerActive ? handleStop : handleStart}
            disabled={!timerActive && !timerProjectId}
            className={`w-24 h-24 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95 ${
              timerActive
                ? 'bg-red-500 text-white'
                : timerProjectId
                ? 'bg-[#2563EB] text-white'
                : 'bg-[#E5E7EB] text-[#9CA3AF]'
            }`}
          >
            {timerActive ? <Square className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
          </button>

          <p className="text-xs text-[#9CA3AF] mt-4">
            {timerActive ? 'Tap to stop' : timerProjectId ? 'Tap to start' : 'Select a project'}
          </p>
        </div>

        {/* Mobile history — compact */}
        {entries.length > 0 && (
          <div className="border-t border-[#E5E7EB] bg-white px-4 py-4">
            <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wider mb-3">Recent</h3>
            <div className="space-y-2">
              {entries.slice(0, 5).map(entry => (
                <div key={entry.id} className="flex items-center justify-between py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-[#111] truncate">
                      {(entry.project as any)?.name || 'Unknown'}
                    </div>
                    {entry.notes && (
                      <div className="text-xs text-[#9CA3AF] truncate">{entry.notes}</div>
                    )}
                  </div>
                  <span className="text-sm font-mono text-[#6B7280] ml-3 flex-shrink-0">
                    {fmtActualHours(entry.duration_minutes)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ═══════ DESKTOP VIEW ═══════ */}
      <div className="hidden md:block max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Time Tracking</h1>
          <button
            onClick={async () => {
              if (!org?.id) return
              // Pull last 90 days server-side — broader than the 7-day window shown on page
              const ninetyDaysAgo = new Date()
              ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
              const { data, error } = await supabase
                .from('time_entries')
                // ⛔ NO `user:users(...)` JOIN. `users_select_self` (084) lets
                // the browser read only its OWN users row, and PostgREST
                // returns an RLS-denied embed as NULL rather than an error —
                // so this export's User column was BLANK for every entry but
                // the exporter's own, silently, on a file that goes to
                // payroll. Resolved through the roster instead, exactly like
                // the on-screen rows.
                .select('*, project:projects(name), subproject:subprojects(name)')
                .eq('org_id', org.id)
                .gte('created_at', ninetyDaysAgo.toISOString())
                .order('created_at', { ascending: false })
              if (error || !data) {
                alert('Export failed — please try again')
                return
              }
              const csvEscape = (v: any) => {
                if (v == null) return ''
                const s = String(v).replace(/"/g, '""')
                return /[",\n]/.test(s) ? `"${s}"` : s
              }
              const header = ['Date', 'User', 'Project', 'Subproject', 'Hours', 'Notes', 'Started', 'Ended']
              const rows = (data as any[]).map(e => {
                const date = e.started_at ? new Date(e.started_at) : new Date(e.created_at)
                return [
                  date.toISOString().slice(0, 10),
                  (e.user_id ? memberByUserId.get(e.user_id)?.name : '') || '',
                  e.project?.name || '',
                  e.subproject?.name || '',
                  ((e.duration_minutes || 0) / 60).toFixed(2),
                  e.notes || '',
                  e.started_at || '',
                  e.ended_at || '',
                ].map(csvEscape).join(',')
              })
              const csv = [header.join(','), ...rows].join('\n')
              const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              const today = new Date().toISOString().slice(0, 10)
              link.download = `time-entries-${today}.csv`
              link.click()
              URL.revokeObjectURL(url)
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-[#6B7280] hover:text-[#111] border border-[#E5E7EB] rounded-lg hover:bg-[#F9FAFB] transition-colors"
            title="Export last 90 days as CSV"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>

        {/* ────────── TIMER SECTION ────────── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <Clock className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider">Timer</h2>
          </div>
          {timerError && (
            <div className="mb-4 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-sm rounded-lg">
              {timerError}
            </div>
          )}

          {/* Selects row — Phase 8: department is now a required dimension
              for actuals-by-dept rollups. The select itself stays optional
              (the DB column is nullable for legacy parity), but it's the
              canonical way to clock in for Phase 8. */}
          <div className="grid grid-cols-3 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Project</label>
              <select
                className={selectClass}
                value={timerProjectId}
                onChange={e => {
                  setTimerProjectId(e.target.value)
                  setTimerSubprojectId('')
                }}
                disabled={timerActive}
              >
                <option value="">Select project...</option>
                {pickableProjects(timerProjectId).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Subproject</label>
              <select
                className={selectClass}
                value={timerSubprojectId}
                onChange={e => setTimerSubprojectId(e.target.value)}
                disabled={timerActive || !timerProjectId}
              >
                <option value="">None</option>
                {timerSubs.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Department</label>
              <select
                className={selectClass}
                value={timerDepartmentId}
                onChange={e => setTimerDepartmentId(e.target.value)}
              >
                <option value="">None</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Notes (optional)</label>
            <input
              type="text"
              className={inputClass}
              placeholder="What are you working on?"
              value={timerNotes}
              onChange={e => setTimerNotes(e.target.value)}
            />
          </div>

          {/* Timer display + button */}
          <div className="flex items-center gap-6">
            <button
              onClick={timerActive ? handleStop : handleStart}
              disabled={!timerActive && !timerProjectId}
              className={`flex items-center justify-center w-14 h-14 rounded-full transition-colors ${
                timerActive
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : 'bg-[#2563EB] hover:bg-[#1D4ED8] text-white disabled:opacity-40 disabled:cursor-not-allowed'
              }`}
            >
              {timerActive ? <Square className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
            </button>

            <div className="font-mono text-4xl font-semibold tracking-tight text-[#111] tabular-nums">
              {formatElapsed(elapsed)}
            </div>

            {timerActive && (
              <div className="ml-auto flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <span className="text-xs font-medium text-red-500">Recording</span>
              </div>
            )}
          </div>
        </div>

        {/* ────────── MANUAL ENTRY SECTION ────────── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <div className="flex items-center gap-2 mb-5">
            <BookOpen className="w-4 h-4 text-[#6B7280]" />
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider">Log Hours Manually</h2>
          </div>

          <div className="grid grid-cols-6 gap-4 mb-5">
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Date</label>
              <input
                type="date"
                className={inputClass}
                value={manualDate}
                onChange={e => setManualDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Project</label>
              <select
                className={selectClass}
                value={manualProjectId}
                onChange={e => {
                  setManualProjectId(e.target.value)
                  setManualSubprojectId('')
                }}
              >
                <option value="">Select project...</option>
                {pickableProjects(manualProjectId).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Subproject</label>
              <select
                className={selectClass}
                value={manualSubprojectId}
                onChange={e => setManualSubprojectId(e.target.value)}
                disabled={!manualProjectId}
              >
                <option value="">None</option>
                {(subprojectsMap[manualProjectId] || []).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Department</label>
              <select
                className={selectClass}
                value={manualDepartmentId}
                onChange={e => setManualDepartmentId(e.target.value)}
              >
                <option value="">None</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Hours</label>
              <input
                type="number"
                step="0.25"
                min="0.25"
                className={inputClass}
                placeholder="e.g. 2.5"
                value={manualHours}
                onChange={e => setManualHours(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Notes</label>
              <input
                type="text"
                className={inputClass}
                placeholder="Optional"
                value={manualNotes}
                onChange={e => setManualNotes(e.target.value)}
              />
            </div>
          </div>

          <button
            className={btnPrimary}
            disabled={!manualProjectId || !manualHours || manualSaving}
            onClick={handleManualSave}
          >
            {manualSaving ? 'Saving...' : 'Save Entry'}
          </button>
        </div>

        {/* ────────── HISTORY SECTION ────────── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
          <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
            <h2 className="text-sm font-semibold text-[#6B7280] uppercase tracking-wider">
              {isFilterActive(filter) ? 'Filtered' : 'Last 30 days'}
            </h2>
            {isFilterActive(filter) && (
              <span className="text-[11.5px] text-[#9CA3AF]">
                {visibleEntries.length} of {entries.length} entries ·{' '}
                <button
                  onClick={() => setFilter(EMPTY_TIME_FILTER)}
                  className="text-[#2563EB] hover:underline"
                >
                  clear
                </button>
              </span>
            )}
          </div>

          <TimeFilterBar
            filter={filter}
            setFilter={setFilter}
            projects={projects}
            roster={roster}
          />

          {loading ? (
            <p className="text-sm text-[#9CA3AF] text-center py-8">Loading...</p>
          ) : visibleEntries.length === 0 ? (
            <p className="text-sm text-[#9CA3AF] text-center py-8">
              {isFilterActive(filter)
                ? 'Nothing matches those filters.'
                : 'No time entries yet. Start the timer or log hours manually.'}
            </p>
          ) : (
            <div className="space-y-6">
              {sortedDates.map(date => {
                const dayEntries = grouped[date]
                const dayTotal = dayEntries.reduce((sum, e) => sum + e.duration_minutes, 0)
                return (
                  <div key={date}>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold text-[#111]">
                        {dateLabel(date + 'T12:00:00')}
                      </span>
                      <span className="text-xs font-medium text-[#6B7280] font-mono">
                        {fmtActualHours(dayTotal)}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {dayEntries.map(entry => (
                        <div key={entry.id} className="bg-[#F9FAFB] rounded-xl group">
                        <div className="flex items-center gap-4 px-4 py-3">
                          {/* Project / subproject / department */}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-[#111] truncate">
                              {(entry.project as any)?.name || 'Unknown Project'}
                              {(entry.subproject as any)?.name && (
                                <span className="text-[#9CA3AF] font-normal"> / {(entry.subproject as any).name}</span>
                              )}
                              {(entry.department as any)?.name && (
                                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] bg-[#F3F4F6] rounded px-1.5 py-0.5 align-middle">
                                  {(entry.department as any).name}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {/* ⛔ WHO TRACKED IT — via the roster bridge, not
                                  a users join (RLS returns null for everyone
                                  but the viewer). An unlinked login can't be
                                  named at all, so it says so rather than
                                  printing "Unknown" on every row in a shop
                                  that hasn't done the linking pass. */}
                              {(() => {
                                const who = entry.user_id
                                  ? memberByUserId.get(entry.user_id)
                                  : undefined
                                return (
                                  <span
                                    className={`text-[11px] px-1.5 py-0.5 rounded ${
                                      who
                                        ? 'bg-[#EFF6FF] text-[#1D4ED8]'
                                        : 'bg-[#F3F4F6] text-[#9CA3AF] italic'
                                    }`}
                                    title={who ? undefined : 'This login isn’t linked to a team member on /team'}
                                  >
                                    {who?.name ?? 'unlinked login'}
                                  </span>
                                )
                              })()}
                              {entry.notes && (
                                <span className="text-xs text-[#9CA3AF] truncate">{entry.notes}</span>
                              )}
                            </div>
                          </div>

                          {/* Hours (editable — the full editor opens below the row) */}
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-mono font-medium text-[#111] min-w-[60px] text-right">
                              {fmtActualHours(entry.duration_minutes)}
                            </span>
                            {entry.edited_at && (
                              <span
                                className="text-[10px] text-[#9CA3AF] italic"
                                title={`Edited ${new Date(entry.edited_at).toLocaleString()}${
                                  entry.edited_by && memberByUserId.get(entry.edited_by)
                                    ? ` by ${memberByUserId.get(entry.edited_by)!.name}`
                                    : ''
                                }`}
                              >
                                edited
                              </span>
                            )}
                            <button
                              onClick={() => (editingId === entry.id ? setEditingId(null) : startEdit(entry))}
                              className={`p-1 rounded-lg text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F3F4F6] transition-all ${
                                editingId === entry.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                              }`}
                              aria-label="Edit entry"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Delete */}
                          <button
                            onClick={() => handleDelete(entry.id)}
                            className="p-1 rounded-lg text-[#9CA3AF] hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {editingId === entry.id && (
                          <div className="px-4 pb-3 flex items-end gap-2 flex-wrap border-t border-[#E5E7EB] pt-3">
                            <label className="flex flex-col gap-1 min-w-[160px] flex-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Project</span>
                              <select
                                value={editProjectId}
                                onChange={(e) => {
                                  setEditProjectId(e.target.value)
                                  setEditSubprojectId('')
                                }}
                                className="px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                              >
                                {pickableProjects(editProjectId).map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 min-w-[140px] flex-1">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Subproject</span>
                              <select
                                value={editSubprojectId}
                                onChange={(e) => setEditSubprojectId(e.target.value)}
                                className="px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                              >
                                <option value="">—</option>
                                {(subprojectsMap[editProjectId] || []).map((sp) => (
                                  <option key={sp.id} value={sp.id}>{sp.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 min-w-[120px]">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Department</span>
                              <select
                                value={editDepartmentId}
                                onChange={(e) => setEditDepartmentId(e.target.value)}
                                className="px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white"
                              >
                                <option value="">—</option>
                                {departments.map((d) => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-1 w-20">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Hours</span>
                              <input
                                type="number"
                                step="0.25"
                                min="0.25"
                                className="px-2 py-1.5 text-sm font-mono border border-[#E5E7EB] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                                value={editHours}
                                onChange={(e) => setEditHours(e.target.value)}
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') void handleEditSave(entry)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                              />
                            </label>
                            <button
                              onClick={() => void handleEditSave(entry)}
                              className="px-3 py-1.5 text-sm font-medium rounded-lg bg-[#2563EB] text-white hover:bg-[#1D4ED8] inline-flex items-center gap-1"
                            >
                              <Check className="w-3.5 h-3.5" /> Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="px-3 py-1.5 text-sm rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F3F4F6] inline-flex items-center gap-1"
                            >
                              <X className="w-3.5 h-3.5" /> Cancel
                            </button>
                            {editError && (
                              <div className="w-full text-[11.5px] text-[#B91C1C]">{editError}</div>
                            )}
                          </div>
                        )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Filter bar ──────────────────────────────────────────────────────────────

/**
 * Search + filters over the loaded entries.
 *
 * ⛔ CLIENT-SIDE ON PURPOSE (scoped): a shop's month of time fits in memory,
 * and filtering in the browser keeps the list instant. The tradeoff is that
 * the FETCH WINDOW bounds what any filter can find — `fetchEntries` pulls 30
 * days, which is why "Last week" works. Widen one and widen the other.
 *
 * ⚠️ The dropdowns list the ORG's own projects and roster, not the distinct
 * values present in the entries. Picking someone who logged nothing should
 * return "nothing matches" — that's an answer. A list built from the entries
 * would silently hide the people you most want to check on.
 */
function TimeFilterBar({
  filter,
  setFilter,
  projects,
  roster,
}: {
  filter: TimeFilter
  setFilter: (f: TimeFilter) => void
  projects: Project[]
  roster: Array<{ id: string; name: string; userId: string | null }>
}) {
  const field =
    'px-2.5 py-1.5 text-[13px] border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]'

  const chip = (value: TimeRangeChip, label: string) => {
    const on = filter.chip === value
    return (
      <button
        key={label}
        // Clicking the active chip clears it — a filter you can't switch off
        // without hunting for a reset is a trap.
        onClick={() => setFilter({ ...filter, chip: on ? null : value })}
        className={`px-2.5 py-1.5 rounded-lg border text-[12px] transition-colors ${
          on
            ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8] font-medium'
            : 'border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]'
        }`}
      >
        {label}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 mb-5 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          value={filter.text}
          onChange={(e) => setFilter({ ...filter, text: e.target.value })}
          placeholder="Search project, person, notes…"
          className={`${field} w-full pl-8`}
        />
      </div>

      <select
        value={filter.projectId}
        onChange={(e) => setFilter({ ...filter, projectId: e.target.value })}
        className={field}
      >
        <option value="">All projects</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>

      <select
        value={filter.memberId}
        onChange={(e) => setFilter({ ...filter, memberId: e.target.value })}
        className={field}
      >
        <option value="">Everyone</option>
        {roster.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      <input
        type="date"
        value={filter.date}
        onChange={(e) => setFilter({ ...filter, date: e.target.value })}
        className={field}
      />

      {chip('today', 'Today')}
      {chip('this_week', 'This week')}
      {chip('last_week', 'Last week')}
    </div>
  )
}
