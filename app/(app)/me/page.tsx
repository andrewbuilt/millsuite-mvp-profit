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
import { weekBar } from '@/lib/time-filters'
import {
  loadPtoRequests,
  loadOrCreateDefaultPolicy,
  computeBalance,
  type PtoRequest,
  type PtoPolicy,
} from '@/lib/pto'
import { supabase } from '@/lib/supabase'
import { fmtActualHours } from '@/lib/actual-hours'

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
    // ⛔ THE FETCH RUNS MON..SUNDAY, THE VIEW RENDERS MON..FRI. The week tab
    // only draws `weekDays` (5), so the extra rows are harmless there — but
    // the hours banner has to count Saturday and Sunday work, or someone who
    // came in at the weekend sees their hours disappear from their own total.
    const weekEndISO = isoDate(new Date(weekStart.getTime() + 6 * 86400000))
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

  // One clock-in for the whole flow. The subproject tag is the point of the
  // redesign — entries land subproject-tagged so the production fill bar and
  // est-vs-actual can see them; departmentId comes through only when the
  // flow could name it unambiguously.
  async function clockInTarget(
    projectId: string,
    subprojectId: string | null,
    departmentId: string | null,
  ) {
    if (!orgId || !userId || !projectId) return
    await apiClockIn({ orgId, userId, projectId, subprojectId, departmentId })
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
      <h1 className="text-xl font-semibold tracking-tight mb-3">Hi {firstName}</h1>

      <WeekHoursBar
        minutes={weekEntries.reduce((s, e) => s + (e.duration_minutes || 0), 0)}
        targetHours={Number(me.hours_per_week) > 0 ? Number(me.hours_per_week) : 40}
        liveMinutes={active && active.started_at ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 60000)) : 0}
      />

      {tab === 'today' && (
        <TodayTab
          active={active}
          now={now}
          orgId={orgId!}
          myDeptIds={me.dept_assignments || []}
          projects={projects}
          todayEntries={todayEntries}
          onClockIn={clockInTarget}
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

// ── Week hours banner ───────────────────────────────────────────────────────

/**
 * Hours logged this week against the member's own weekly hours.
 *
 * ⛔ PLAIN `hours_per_week`, NOT PTO-ADJUSTED (scoped explicitly). Capacity
 * already computes a PTO-aware week, and folding that in here would make the
 * bar move for reasons the person reading it didn't cause — a target that
 * shrinks because you booked a day off reads as the app losing your hours.
 * 40 is the fallback when the roster has no per-person figure, which is what
 * Andrew asked for ("vs 40 hours") without hardcoding it for everyone.
 *
 * ⚠️ COUNTS THE RUNNING CLOCK. `weekEntries` only has closed entries — an
 * open shift has no `duration_minutes` yet — so a worker four hours into the
 * day would watch the bar sit still all morning and conclude it was broken.
 * `liveMinutes` is the in-progress shift, recomputed from the page's `now`
 * tick, which is why this fills as time tracks.
 */
function WeekHoursBar({
  minutes,
  targetHours,
  liveMinutes,
}: {
  minutes: number
  targetHours: number
  liveMinutes: number
}) {
  // ⛔ THE MATH MOVED TO lib/time-filters. /team now shows this same bar on
  // every collapsed roster row, and two implementations of "am I at 100% this
  // week?" would eventually disagree about the same person on the same day.
  const { total, width, color } = weekBar(minutes, liveMinutes, targetHours)

  return (
    <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
          This week
        </span>
        <span className="text-[12.5px] font-mono tabular-nums text-[#374151]">
          <strong className="text-[#111]">{fmtActualHours(total)}</strong>
          <span className="text-[#9CA3AF]"> of {targetHours}h</span>
        </span>
      </div>
      <div className="h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
      {liveMinutes > 0 && (
        <div className="mt-1 text-[10.5px] text-[#9CA3AF]">
          includes {fmtActualHours(liveMinutes)} still running
        </div>
      )}
    </div>
  )
}
