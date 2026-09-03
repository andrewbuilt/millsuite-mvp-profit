'use client'

// ============================================================================
// /me — worker phone app (chunk D). Bottom-tab PWA: Today / Week / PTO /
// History. Clock-in/out/switch writes time_entries (running row = null
// ended_at); PTO requests reuse lib/pto; scheduled jobs come from the
// worker's dept allocations for the week.
// ============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAuth } from '@/lib/auth-context'
import ChangePassword from '@/components/change-password'
import { Clock, CalendarDays, Palmtree, ListChecks, Play, Square, Repeat, Trash2 } from 'lucide-react'
import type { TeamMember } from '@/lib/shop-rate-setup'
import {
  loadMyMember,
  loadActiveEntry,
  loadEntriesInRange,
  loadRecentEntries,
  loadScheduledJobs,
  clockIn as apiClockIn,
  clockOut as apiClockOut,
  updateEntryMinutes,
  deleteEntry,
  mondayOf,
  isoDate,
  type TimeEntry,
  type ScheduledJob,
} from '@/lib/worker-time'
import {
  loadPtoRequests,
  loadOrCreateDefaultPolicy,
  createPtoRequest,
  deletePtoRequest,
  computeBalance,
  type PtoRequest,
  type PtoPolicy,
  type PtoReason,
} from '@/lib/pto'
import { supabase } from '@/lib/supabase'
import { fmtActualHours } from '@/lib/actual-hours'

type Tab = 'today' | 'week' | 'pto' | 'history'

// Tracked time renders through the shared fmtActualHours. This page had the
// right format already ("2h 34m") in a local hoursLabel — it's now the one the
// whole app uses, so /time and the project pages match instead of drifting.

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
        <HistoryTab entries={recent} onChanged={refresh} email={authUser?.email ?? null} />
      )}

      <BottomTabs tab={tab} setTab={setTab} clockedIn={!!active} />
    </div>
  )
}

// ── Today ──
function TodayTab({
  active,
  now,
  jobs,
  projects,
  todayEntries,
  onClockInJob,
  onClockInProject,
  onClockOut,
}: {
  active: TimeEntry | null
  now: number
  jobs: ScheduledJob[]
  projects: Array<{ id: string; name: string }>
  todayEntries: TimeEntry[]
  onClockInJob: (j: ScheduledJob) => void
  onClockInProject: (projectId: string) => void
  onClockOut: () => void
}) {
  const [otherProject, setOtherProject] = useState('')
  const [busy, setBusy] = useState(false)
  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || 'Job'

  const elapsedMin = active?.started_at
    ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 60000))
    : 0
  const elapsedSec = active?.started_at
    ? Math.max(0, Math.floor((now - new Date(active.started_at).getTime()) / 1000)) % 60
    : 0
  const todayTotal = todayEntries.reduce((s, e) => s + (e.duration_minutes || 0), 0)

  async function wrap(fn: () => Promise<void> | void) {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {active ? (
        <div className="rounded-2xl bg-[#111] text-white p-5">
          <div className="text-[11px] uppercase tracking-wider text-white/50 mb-1">Clocked in</div>
          <div className="text-lg font-semibold">{projName(active.project_id)}</div>
          <div className="text-4xl font-mono tabular-nums mt-2">
            {String(Math.floor(elapsedMin / 60)).padStart(2, '0')}:
            {String(elapsedMin % 60).padStart(2, '0')}:{String(elapsedSec).padStart(2, '0')}
          </div>
          <button
            disabled={busy}
            onClick={() => wrap(onClockOut)}
            className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-white text-[#111] font-semibold py-3 disabled:opacity-60"
          >
            <Square className="w-4 h-4" /> Clock out
          </button>
          <div className="text-[11px] text-white/50 mt-2 text-center">
            Tap a job below to switch — it closes this one first.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-center text-sm text-[#6B7280]">
          Not clocked in. Tap a scheduled job to start.
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
          Today&apos;s jobs
        </div>
        {jobs.length === 0 ? (
          <div className="text-xs text-[#9CA3AF] py-1">Nothing scheduled for your team today.</div>
        ) : (
          <div className="space-y-2">
            {jobs.map((j) => {
              const isActive = active?.subproject_id === j.subprojectId
              return (
                <button
                  key={j.allocationId}
                  disabled={busy}
                  onClick={() => wrap(() => onClockInJob(j))}
                  className={`w-full flex items-center justify-between rounded-xl border p-3 text-left disabled:opacity-60 ${
                    isActive ? 'border-[#111] bg-[#F3F4F6]' : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#111] truncate">{j.projectName}</div>
                    <div className="text-[11px] text-[#9CA3AF] truncate">{j.subprojectName}</div>
                  </div>
                  <span className="flex-shrink-0 ml-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB]">
                    {active ? <Repeat className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {active ? 'Switch' : 'Start'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
          Other work
        </div>
        <div className="flex gap-2">
          <select
            value={otherProject}
            onChange={(e) => setOtherProject(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-[#E5E7EB] rounded-xl bg-white outline-none focus:border-[#2563EB]"
          >
            <option value="">Pick a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            disabled={busy || !otherProject}
            onClick={() => wrap(() => onClockInProject(otherProject))}
            className="px-4 rounded-xl bg-[#2563EB] text-white text-sm font-semibold disabled:opacity-50"
          >
            {active ? 'Switch' : 'Start'}
          </button>
        </div>
      </div>

      {todayEntries.length > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
            <span>Today</span>
            <span className="font-mono">{fmtActualHours(todayTotal)}</span>
          </div>
          <div className="space-y-1">
            {todayEntries.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-sm px-1 py-1">
                <span className="text-[#111] truncate">{projName(e.project_id)}</span>
                <span className="font-mono tabular-nums text-[#6B7280]">
                  {fmtActualHours(e.duration_minutes || 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── My week ──
function WeekTab({
  weekDays,
  jobs,
  entries,
  ptoRequests,
  meId,
}: {
  weekDays: Date[]
  jobs: ScheduledJob[]
  entries: TimeEntry[]
  ptoRequests: PtoRequest[]
  meId: string
}) {
  const label = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const loggedByDay = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of entries) {
      if (!e.started_at) continue
      const key = e.started_at.slice(0, 10)
      m[key] = (m[key] || 0) + (e.duration_minutes || 0)
    }
    return m
  }, [entries])
  const myPto = ptoRequests.filter((r) => r.team_member_id === meId && r.status !== 'denied')

  function isPto(iso: string) {
    return myPto.find((r) => iso >= r.start_date && iso <= r.end_date)
  }

  return (
    <div className="space-y-2">
      {weekDays.map((d) => {
        const iso = isoDate(d)
        const dayJobs = jobs.filter((j) => j.scheduledDate === iso)
        const logged = loggedByDay[iso] || 0
        const pto = isPto(iso)
        return (
          <div key={iso} className="rounded-xl border border-[#E5E7EB] bg-white p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-[#111]">{label(d)}</span>
              <span className="text-[11px] font-mono text-[#6B7280]">
                {logged > 0 ? fmtActualHours(logged) : '—'}
              </span>
            </div>
            {pto ? (
              <div className="text-[11px] text-[#B45309] bg-[#FEF3C7] rounded px-2 py-1 inline-block">
                {pto.status === 'approved' ? 'PTO' : 'PTO (pending)'} · {pto.reason}
              </div>
            ) : dayJobs.length === 0 ? (
              <div className="text-[11px] text-[#9CA3AF]">No jobs scheduled</div>
            ) : (
              <div className="space-y-0.5">
                {dayJobs.map((j) => (
                  <div key={j.allocationId} className="text-[12px] text-[#374151] truncate">
                    {j.projectName} · <span className="text-[#9CA3AF]">{j.subprojectName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── PTO ──
function PtoTab({
  orgId,
  meId,
  balance,
  requests,
  onChanged,
}: {
  orgId: string
  meId: string
  balance: { allowed: number; used: number; pending: number; remaining: number } | null
  requests: PtoRequest[]
  onChanged: () => Promise<void>
}) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState<PtoReason>('PTO')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (!start) {
      setErr('Pick a date')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await createPtoRequest({
        orgId,
        teamMemberId: meId,
        startDate: start,
        endDate: end || start,
        reason,
        notes: notes.trim() || null,
      })
      setStart('')
      setEnd('')
      setNotes('')
      await onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit')
    } finally {
      setBusy(false)
    }
  }

  const fmt = (iso: string) =>
    new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <div className="space-y-5">
      {balance && (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-[#111]">Time off</span>
            <span className="font-mono tabular-nums text-[#6B7280]">
              {balance.remaining} of {balance.allowed} days left
            </span>
          </div>
          <div className="h-2 bg-[#E5E7EB] rounded-full overflow-hidden">
            <div
              className="h-full bg-[#10B981] rounded-full"
              style={{
                width: `${balance.allowed > 0 ? Math.min(100, (balance.used / balance.allowed) * 100) : 0}%`,
              }}
            />
          </div>
          <div className="text-[11px] text-[#9CA3AF] mt-1">
            {balance.used} used{balance.pending > 0 ? ` · ${balance.pending} pending` : ''} · resets
            on your work anniversary
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-4 space-y-2">
        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide">Request time off</div>
        <div className="flex gap-2">
          <label className="flex-1 text-[11px] text-[#9CA3AF]">
            From
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="mt-0.5 w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
            />
          </label>
          <label className="flex-1 text-[11px] text-[#9CA3AF]">
            To (optional)
            <input
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="mt-0.5 w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
            />
          </label>
        </div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as PtoReason)}
          className="w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg bg-white outline-none focus:border-[#2563EB]"
        >
          {(['PTO', 'Sick', 'Personal', 'Other'] as PtoReason[]).map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
        />
        {err && <div className="text-[11px] text-[#DC2626]">{err}</div>}
        <button
          onClick={submit}
          disabled={busy}
          className="w-full py-2.5 rounded-xl bg-[#2563EB] text-white text-sm font-semibold disabled:opacity-60"
        >
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
      </div>

      {requests.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
            My requests
          </div>
          <div className="space-y-1.5">
            {requests.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-3 py-2"
              >
                <div className="text-sm text-[#111]">
                  {r.start_date === r.end_date ? fmt(r.start_date) : `${fmt(r.start_date)} – ${fmt(r.end_date)}`}
                  <span className="text-[11px] text-[#9CA3AF]"> · {r.reason}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[11px] font-medium ${
                      r.status === 'approved'
                        ? 'text-[#065F46]'
                        : r.status === 'denied'
                          ? 'text-[#991B1B]'
                          : 'text-[#B45309]'
                    }`}
                  >
                    {r.status}
                  </span>
                  {r.status === 'pending' && (
                    <button
                      onClick={async () => {
                        await deletePtoRequest(r)
                        await onChanged()
                      }}
                      className="text-[#D1D5DB] hover:text-[#DC2626]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── History ──
function HistoryTab({ entries, onChanged, email }: { entries: TimeEntry[]; onChanged: () => Promise<void>; email: string | null }) {
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-1">
        Recent entries
      </div>
      {entries.length === 0 ? (
        <div className="text-xs text-[#9CA3AF] py-2">No time logged yet.</div>
      ) : (
        entries.map((e) => (
          <HistoryRow key={e.id} entry={e} fmtDate={fmt} onChanged={onChanged} />
        ))
      )}

      {/* Account — the only settings surface a worker has; /settings is
          owner-only and the rest of the app is off-limits to them. */}
      <div className="pt-4 mt-4 border-t border-[#E5E7EB]">
        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
          Account
        </div>
        <ChangePassword email={email} />
      </div>
    </div>
  )
}

function HistoryRow({
  entry,
  fmtDate,
  onChanged,
}: {
  entry: TimeEntry
  fmtDate: (iso: string | null) => string
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [hours, setHours] = useState((entry.duration_minutes / 60).toFixed(2))

  async function save() {
    const mins = Math.round((parseFloat(hours) || 0) * 60)
    await updateEntryMinutes(entry.id, mins)
    setEditing(false)
    await onChanged()
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-3 py-2">
      <div className="text-sm text-[#111] min-w-0">
        <span className="text-[11px] text-[#9CA3AF] font-mono mr-2">{fmtDate(entry.started_at)}</span>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {editing ? (
          <>
            <input
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              inputMode="decimal"
              className="w-16 px-2 py-1 text-sm font-mono border border-[#E5E7EB] rounded-lg outline-none focus:border-[#2563EB]"
            />
            <span className="text-[11px] text-[#9CA3AF]">h</span>
            <button onClick={save} className="text-xs font-semibold text-[#2563EB]">
              Save
            </button>
          </>
        ) : (
          <>
            <span className="font-mono tabular-nums text-[#6B7280]">
              {fmtActualHours(entry.duration_minutes || 0)}
            </span>
            <button onClick={() => setEditing(true)} className="text-xs text-[#2563EB]">
              Edit
            </button>
            <button
              onClick={async () => {
                await deleteEntry(entry.id)
                await onChanged()
              }}
              className="text-[#D1D5DB] hover:text-[#DC2626]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Bottom tab bar ──
function BottomTabs({
  tab,
  setTab,
  clockedIn,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  clockedIn: boolean
}) {
  const items: Array<{ key: Tab; label: string; Icon: typeof Clock }> = [
    { key: 'today', label: 'Today', Icon: Clock },
    { key: 'week', label: 'Week', Icon: CalendarDays },
    { key: 'pto', label: 'Time off', Icon: Palmtree },
    { key: 'history', label: 'History', Icon: ListChecks },
  ]
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-[#E5E7EB]">
      <div className="max-w-md mx-auto grid grid-cols-4">
        {items.map(({ key, label, Icon }) => {
          const on = tab === key
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium relative ${
                on ? 'text-[#2563EB]' : 'text-[#9CA3AF]'
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
              {key === 'today' && clockedIn && (
                <span className="absolute top-1.5 right-1/2 translate-x-3 w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
