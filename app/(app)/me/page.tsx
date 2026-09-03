'use client'

// ============================================================================
// /me — worker phone app (chunk D). Bottom-tab PWA: Today / Week / PTO /
// History. Clock-in/out/switch writes time_entries (running row = null
// ended_at); PTO requests reuse lib/pto; scheduled jobs come from the
// worker's dept allocations for the week.
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import { TodayTab, WeekTab, PtoTab, HistoryTab, BottomTabs, type Tab } from '@/components/me/tabs'
import type { TeamMember } from '@/lib/shop-rate-setup'
import {
  loadMyMember,
  loadActiveEntry,
  loadEntriesInRange,
  loadRecentEntries,
  loadScheduledJobs,
  clockIn as apiClockIn,
  clockOut as apiClockOut,
  mondayOf,
  isoDate,
  type TimeEntry,
  type ScheduledJob,
} from '@/lib/worker-time'
import {
  loadPtoRequests,
  loadOrCreateDefaultPolicy,
  computeBalance,
  type PtoRequest,
  type PtoPolicy,
} from '@/lib/pto'
import { supabase } from '@/lib/supabase'

// The four tab bodies live in components/me/tabs.tsx — see the note there for
// why they can't sit in this file. Tracked time renders through the shared
// fmtActualHours ("2h 34m").

export default function MePage() {
  const { user, org, loading, authUser } = useAuth()
  const [tab, setTab] = useState<Tab>('today')
  const [me, setMe] = useState<TeamMember | null>(null)
  const [active, setActive] = useState<TimeEntry | null>(null)
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([])
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([])
  const [recent, setRecent] = useState<TimeEntry[]>([])
  const [jobs, setJobs] = useState<ScheduledJob[]>([])
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [ptoRequests, setPtoRequests] = useState<PtoRequest[]>([])
  const [ptoPolicy, setPtoPolicy] = useState<PtoPolicy | null>(null)
  const [ready, setReady] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const todayISO = useMemo(() => isoDate(new Date()), [])
  const weekStart = useMemo(() => mondayOf(new Date()), [])
  const weekDays = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(d.getDate() + i)
        return d
      }),
    [weekStart],
  )

  const orgId = org?.id
  const userId = user?.id

  const refresh = useCallback(async () => {
    if (!orgId || !userId) return
    const weekEndISO = isoDate(weekDays[4])
    const [member, act, today, wk, rec, sched, ptoReqs] = await Promise.all([
      loadMyMember(orgId, userId),
      loadActiveEntry(userId),
      loadEntriesInRange(userId, todayISO, todayISO),
      loadEntriesInRange(userId, isoDate(weekStart), weekEndISO),
      loadRecentEntries(userId, 30),
      (async () => {
        const m = await loadMyMember(orgId, userId)
        const deptIds = m?.dept_assignments || []
        return loadScheduledJobs(deptIds, isoDate(weekStart), weekEndISO)
      })(),
      loadPtoRequests(orgId).catch(() => [] as PtoRequest[]),
    ])
    setMe(member)
    setActive(act)
    setTodayEntries(today)
    setWeekEntries(wk)
    setRecent(rec)
    setJobs(sched)
    setPtoRequests(ptoReqs)
  }, [orgId, userId, todayISO, weekStart, weekDays])

  useEffect(() => {
    if (!orgId || !userId) return
    let cancelled = false
    ;(async () => {
      await refresh()
      const [{ data: projs }, policy] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name')
          .eq('org_id', orgId)
          .in('stage', ['sold', 'production', 'installed'])
          .order('name'),
        loadOrCreateDefaultPolicy(orgId).catch(() => null),
      ])
      if (cancelled) return
      setProjects((projs || []) as Array<{ id: string; name: string }>)
      setPtoPolicy(policy)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, userId, refresh])

  // Tick the elapsed clock while a timer is running.
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])

  const balance = useMemo(
    () => (me ? computeBalance(me, ptoPolicy, ptoRequests, todayISO) : null),
    [me, ptoPolicy, ptoRequests, todayISO],
  )

  async function clockInJob(job: ScheduledJob) {
    if (!orgId || !userId) return
    await apiClockIn({
      orgId,
      userId,
      projectId: job.projectId,
      subprojectId: job.subprojectId,
      departmentId: job.departmentId,
    })
    await refresh()
  }

  async function clockInProject(projectId: string) {
    if (!orgId || !userId || !projectId) return
    await apiClockIn({ orgId, userId, projectId })
    await refresh()
  }

  async function clockOut() {
    if (!active) return
    await apiClockOut(active)
    await refresh()
  }

  if (loading || !ready) {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading…</div>
    )
  }

  if (!me) {
    return (
      <div className="max-w-md mx-auto px-6 py-16 text-center">
        <p className="text-sm text-[#6B7280]">
          Your login isn&apos;t linked to a team member yet. Ask your shop owner to finish setting
          up your account on the Team page.
        </p>
      </div>
    )
  }

  const firstName = (user?.name || me.name || '').trim().split(/\s+/)[0] || 'there'

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-24">
      <h1 className="text-xl font-semibold tracking-tight mb-4">Hi {firstName}</h1>

      {tab === 'today' && (
        <TodayTab
          active={active}
          now={now}
          jobs={jobs.filter((j) => j.scheduledDate === todayISO)}
          projects={projects}
          todayEntries={todayEntries}
          onClockInJob={clockInJob}
          onClockInProject={clockInProject}
          onClockOut={clockOut}
        />
      )}
      {tab === 'week' && (
        <WeekTab weekDays={weekDays} jobs={jobs} entries={weekEntries} ptoRequests={ptoRequests} meId={me.id} />
      )}
      {tab === 'pto' && (
        <PtoTab
          orgId={orgId!}
          meId={me.id}
          balance={balance}
          requests={ptoRequests.filter((r) => r.team_member_id === me.id)}
          onChanged={refresh}
        />
      )}
      {tab === 'history' && (
        <HistoryTab
          entries={recent}
          onChanged={refresh}
          email={authUser?.email ?? null}
          projects={projects}
        />
      )}

      <BottomTabs tab={tab} setTab={setTab} clockedIn={!!active} />
    </div>
  )
}
