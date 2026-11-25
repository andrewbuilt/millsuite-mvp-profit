'use client'

// ============================================================================
// components/engineering/EngBoard.tsx — the ENGINEERING BOARD
// ============================================================================
// Redesign 2026-11-25 (Andrew: "too many words, hard to just hop in"). Built
// to the approved canvas "Millsuite Engineering Schedule Redesign":
//
//   · One engineer at a time (tabs), plus a Whole team overview.
//   · Their list IS the priority: top gets drawn first; drag rows to reorder.
//     Each row has its own Start/Stop timer and a live clock.
//   · A 3-week chart below, stepped 2 weeks at a time. Every job on the list
//     is laid out in list order (lib/eng-board-math packLane — unchanged).
//   · "Needs an engineer" on the right: drag to rank (shared, migration 137),
//     drag onto the list or use Assign… to hand it to someone.
//   · Click a job for the side panel — plain words, no "placed" / "on the
//     board" / "auto-pack".
//
// Data is unchanged: lib/eng-board (loader + writes), eng_assignments (129,
// 131), the SAME lib/worker-time clock as /me. Hand-divided days and a pinned
// start still work (the side panel's "I'll pick the days").
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { MONO, UI_FONT } from '@/lib/schedule-style'
import {
  entryMinutes, entryDay,
  type AssignmentPatch, type BoardData, type BoardEntry, type EngAssignment, type BoardProject, type DayOff,
} from '@/lib/eng-board'
import {
  packLane, workdaysFrom, mondayOfKey, dateKey, parseKey, evenDivide, divisionsMatch,
  priorityBetween, fmtH, remainingHours, stripBudget, poolRemainder, shiftWorkdays,
  type PackedLane, type PackedStrip, type Division,
} from '@/lib/eng-board-math'

const VIEW_DAYS = 15
/** The chart's arrows move two weeks (10 workdays) at a time. */
const STEP_DAYS = 10
const HORIZON_DAYS = 260
const POOL_KEY = 'millsuite:eng-pool-order'

// ── Look (the approved redesign) ──
const INK = '#18181B'
const MUTED = '#52525B'
const FAINT = '#71717A'
const LINE = '#E4E4E7'
const SOFT = '#F4F4F5'
const PAGE = '#FAFAF9'
const BLUE = '#2563EB'
const GREEN = '#16A34A'
const ORANGE = '#EA580C'
const CARD: React.CSSProperties = { background: '#FFF', border: `1px solid ${LINE}`, borderRadius: 12 }

type TagKind = 'late' | 'risk' | 'ok' | 'none'
const TAG: Record<TagKind, React.CSSProperties> = {
  late: { background: '#FFEDD5', color: '#9A3412' },
  risk: { background: '#FEF3C7', color: '#854D0E' },
  ok: { background: '#DCFCE7', color: '#166534' },
  none: { background: SOFT, color: MUTED },
}
const tagStyle = (k: TagKind): React.CSSProperties => ({ ...TAG[k], fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap' })

function shortDay(k: string | null): string {
  if (!k) return '—'
  return parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
function monthDay(k: string): string {
  return parseKey(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
function weekday(k: string): string {
  return parseKey(k).toLocaleDateString('en-US', { weekday: 'short' })
}
function clockText(fromIso: string | null, nowMs: number): string {
  const secs = fromIso ? Math.max(0, Math.floor((nowMs - new Date(fromIso).getTime()) / 1000)) : 0
  return `${Math.floor(secs / 3600)}:${String(Math.floor((secs % 3600) / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
}
/** Holiday / PTO wording for a day (from /team → Holidays & PTO). */
function offTag(o: DayOff, dailyHours: number): { short: string; whole: boolean } {
  const whole = o.hours >= dailyHours - 0.05
  if (o.holiday) return { short: o.label || 'Holiday', whole: true }
  return { short: whole ? 'Time off' : `${fmtH(o.hours)}h off`, whole }
}

/** Everything the board reads and writes. The page wires Supabase
 *  (lib/eng-board + lib/worker-time); /dev/eng-board wires local fixtures. */
export interface BoardApi {
  load: (fromKey: string, horizonEndKey: string) => Promise<BoardData>
  /** `boardHours` (131) = the job's scheduled hours; null/absent = the estimate. */
  assign: (projectId: string, memberId: string, priority: number, boardHours?: number | null) => Promise<void>
  update: (assignmentId: string, patch: AssignmentPatch) => Promise<void>
  /** "Engineering done" / reopen — the only way a job leaves a list. */
  setDone: (assignmentId: string, projectId: string, done: boolean, trackedHours: number) => Promise<void>
  unassign: (assignmentId: string) => Promise<void>
  /** Same clockIn as /me — closes whatever that person had running first. */
  startTimer: (userId: string, projectId: string, subprojectId: string | null, departmentId: string | null) => Promise<void>
  stopTimer: (entry: BoardEntry) => Promise<void>
  /** 137 — save the "Needs an engineer" order. Absent → kept in this browser. */
  savePoolOrder?: (projectIds: string[]) => Promise<void>
  canTime: boolean
}

type Drag = { id: string; from: 'queue' | 'pool' }

interface JobStatus { text: string; kind: TagKind }

export default function EngBoard({ api, meUserId = null }: { api: BoardApi; meUserId?: string | null }) {
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [clockMs, setClockMs] = useState(() => Date.now())
  const [who, setWho] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [localPool, setLocalPool] = useState<string[]>([])
  const [poolDraft, setPoolDraft] = useState<string[] | null>(null)
  const loadSeq = useRef(0)

  const today = dateKey(new Date(nowMs))
  const thisMonday = mondayOfKey(today)
  const windowStart = useMemo(() => shiftWorkdays(thisMonday, step * STEP_DAYS), [thisMonday, step])
  const viewDays = useMemo(() => workdaysFrom(windowStart, VIEW_DAYS), [windowStart])
  const horizon = useMemo(() => workdaysFrom(today, HORIZON_DAYS), [today])
  // Day cells need logged time on past days even when paged back.
  const loadFrom = windowStart < thisMonday ? windowStart : thisMonday

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const d = await api.load(loadFrom, horizon[horizon.length - 1])
      if (seq !== loadSeq.current) return
      setData(d)
      setPoolDraft(null)
      setError(null)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(e instanceof Error ? e.message : 'Couldn’t load the schedule.')
    }
  }, [api, loadFrom, horizon])

  useEffect(() => { reload() }, [reload])
  // The plan repacks twice a minute (a running timer eats hours); the clocks tick every second.
  useEffect(() => {
    const slow = setInterval(() => setNowMs(Date.now()), 30000)
    const fast = setInterval(() => setClockMs(Date.now()), 1000)
    return () => { clearInterval(slow); clearInterval(fast) }
  }, [])
  useEffect(() => {
    try { setLocalPool(JSON.parse(window.localStorage.getItem(POOL_KEY) || '[]')) } catch { /* private mode */ }
  }, [])

  // ── Derived (same data model as before the redesign) ──
  const projectById = useMemo(() => new Map((data?.projects || []).map((p) => [p.id, p])), [data])
  const engineerIds = useMemo(() => new Set((data?.engineers || []).map((e) => e.member.id)), [data])
  const userToMember = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of data?.engineers || []) if (e.member.user_id) m.set(e.member.user_id, e.member.id)
    return m
  }, [data])

  const loadedAt = useRef(Date.now())
  useEffect(() => { loadedAt.current = Date.now() }, [data])
  /** Tracked minutes per project INCLUDING running timers up to `at`. */
  const trackedMinAt = useCallback((p: BoardProject, at: number): number => {
    let extra = 0
    for (const e of data?.entries || []) {
      if (e.ended_at || e.project_id !== p.id || !e.department_id || !data!.engDeptIds.includes(e.department_id)) continue
      extra += Math.max(0, entryMinutes(e, at) - entryMinutes(e, loadedAt.current))
    }
    return p.trackedMinutes + extra
  }, [data])
  const trackedMin = useCallback((p: BoardProject) => trackedMinAt(p, nowMs), [trackedMinAt, nowMs])

  // ⛔ "Engineering done" is the ONLY thing that takes a job off a list.
  const liveAssignments = useMemo(
    () => (data?.assignments || []).filter((a) => !a.done_at && engineerIds.has(a.member_id) && projectById.has(a.project_id)),
    [data, engineerIds, projectById],
  )
  const assignmentByProject = useMemo(() => new Map(liveAssignments.map((a) => [a.project_id, a])), [liveAssignments])
  const anyAssignmentByProject = useMemo(() => new Map((data?.assignments || []).map((a) => [a.project_id, a])), [data])
  const doneThisMonth = useMemo(() => {
    const month = today.slice(0, 7)
    return (data?.assignments || [])
      .filter((a) => a.done_at && dateKey(new Date(a.done_at)).slice(0, 7) === month && projectById.has(a.project_id))
      .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''))
  }, [data, today, projectById])

  /** member → date → engineering hours logged (all projects), running included. */
  const trackedByMemberDay = useMemo(() => {
    const out: Record<string, Record<string, number>> = {}
    for (const e of data?.entries || []) {
      if (!e.department_id || !data!.engDeptIds.includes(e.department_id)) continue
      const mid = userToMember.get(e.user_id)
      if (!mid) continue
      const day = entryDay(e)
      const m = (out[mid] ||= {})
      m[day] = (m[day] || 0) + entryMinutes(e, nowMs) / 60
    }
    return out
  }, [data, userToMember, nowMs])

  const lanes = useMemo(() => {
    if (!data) return [] as Array<{ eng: BoardData['engineers'][number]; packed: PackedLane }>
    return data.engineers.map((eng) => {
      const mine = liveAssignments.filter((a) => a.member_id === eng.member.id)
      const packed = packLane(
        {
          memberId: eng.member.id,
          dailyHours: eng.dailyHours,
          outByDay: data.outByMember[eng.member.id] || {},
          trackedByDay: trackedByMemberDay[eng.member.id] || {},
        },
        mine.map((a) => {
          const p = projectById.get(a.project_id)!
          return {
            projectId: a.project_id, memberId: a.member_id, priority: a.priority,
            estHours: p.estHours, trackedHours: trackedMin(p) / 60,
            divisions: a.divisions, firmDate: a.firm_date,
            boardHours: a.board_hours, startDate: a.start_date,
          }
        }),
        today,
        horizon,
      )
      return { eng, packed }
    })
  }, [data, liveAssignments, projectById, trackedByMemberDay, trackedMin, today, horizon])

  const stripByProject = useMemo(() => {
    const m = new Map<string, PackedStrip>()
    for (const l of lanes) for (const s of l.packed.strips) m.set(s.projectId, s)
    return m
  }, [lanes])

  const runningByMember = useMemo(() => {
    const m = new Map<string, BoardEntry>()
    for (const e of data?.entries || []) {
      if (e.ended_at) continue
      const mid = userToMember.get(e.user_id)
      if (mid) m.set(mid, e)
    }
    return m
  }, [data, userToMember])

  /** "Needs an engineer": unassigned projects with engineering left, plus
   *  assigned ones that only scheduled part of their estimate (the rest
   *  waits here). Done projects are out. */
  const poolIds = useMemo(() => {
    return (data?.projects || [])
      .filter((p) => {
        const a = anyAssignmentByProject.get(p.id)
        if (a?.done_at) return false
        const tracked = trackedMin(p) / 60
        if (!a) return remainingHours(p.estHours, tracked) > 0.05
        return poolRemainder(p.estHours, tracked, a.board_hours) > 0.05
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => p.id)
  }, [data, anyAssignmentByProject, trackedMin])
  const poolShared = !!api.savePoolOrder && data?.poolOrder != null
  const poolOrdered = useMemo(() => {
    const order = poolDraft || (poolShared ? data!.poolOrder! : localPool)
    const rank = new Map(order.map((id, i) => [id, i]))
    return [...poolIds].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9))
  }, [poolIds, poolDraft, poolShared, data, localPool])

  // Default tab: the signed-in engineer, else the first one.
  useEffect(() => {
    if (!data || (who && (who === 'team' || engineerIds.has(who)))) return
    const mine = data.engineers.find((e) => meUserId && e.member.user_id === meUserId)
    setWho((mine || data.engineers[0])?.member.id || 'team')
  }, [data, who, engineerIds, meUserId])

  // ── Writes ──
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn(); await reload() } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save.')
    } finally { setBusy(false) }
  }

  function savePool(ids: string[]) {
    setPoolDraft(ids)
    if (poolShared) {
      run(() => api.savePoolOrder!(ids))
    } else {
      setLocalPool(ids)
      try { window.localStorage.setItem(POOL_KEY, JSON.stringify(ids)) } catch { /* private mode */ }
    }
  }

  /** Put a job on an engineer's list, above `beforeId` (null = the bottom). */
  function placeOnList(pid: string, memberId: string, beforeId: string | null) {
    if (pid === beforeId) return
    const rows = liveAssignments
      .filter((a) => a.member_id === memberId && a.project_id !== pid)
      .sort((a, b) => a.priority - b.priority)
    const i = beforeId ? rows.findIndex((r) => r.project_id === beforeId) : -1
    const at = i < 0 ? rows.length : i
    const priority = priorityBetween(at > 0 ? rows[at - 1].priority : null, at < rows.length ? rows[at].priority : null)
    const a = anyAssignmentByProject.get(pid)
    run(async () => {
      if (a) await api.update(a.id, { member_id: memberId, priority, ...(a.done_at ? { done_at: null } : {}) })
      else await api.assign(pid, memberId, priority)
    })
  }

  /** Back to "Needs an engineer", above `beforeId` (null = the bottom). */
  function backToPool(pid: string, beforeId: string | null) {
    const a = assignmentByProject.get(pid)
    const ids = poolOrdered.filter((x) => x !== pid)
    const i = beforeId ? ids.indexOf(beforeId) : -1
    ids.splice(i < 0 ? ids.length : i, 0, pid)
    if (a) {
      run(async () => {
        await api.unassign(a.id)
        if (poolShared) await api.savePoolOrder!(ids)
      })
      if (!poolShared) savePool(ids)
    } else {
      savePool(ids)
    }
  }

  function endDrag() { setDrag(null); setOverKey(null) }
  function dropOn(target: 'queue' | 'pool', beforeId: string | null) {
    const d = drag
    endDrag()
    if (!d || d.id === beforeId) return
    if (target === 'queue') {
      if (who && who !== 'team') placeOnList(d.id, who, beforeId)
    } else if (d.from === 'pool') {
      // Re-rank only — a part-scheduled job keeps its engineer.
      const ids = poolOrdered.filter((x) => x !== d.id)
      const i = beforeId ? ids.indexOf(beforeId) : -1
      ids.splice(i < 0 ? ids.length : i, 0, d.id)
      savePool(ids)
    } else {
      backToPool(d.id, beforeId)
    }
  }
  const dragProps = (id: string, from: Drag['from']) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); setDrag({ id, from }) },
    onDragEnd: endDrag,
  })
  const dropZone = (key: string, target: 'queue' | 'pool', beforeId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (!drag) return; e.preventDefault(); e.stopPropagation(); if (overKey !== key) setOverKey(key) },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); dropOn(target, beforeId) },
  })

  function toggleTimer(memberId: string, pid: string, subId: string | null = null) {
    const eng = data?.engineers.find((e) => e.member.id === memberId)
    const userId = eng?.member.user_id
    if (!userId) return
    const running = runningByMember.get(memberId)
    run(async () => {
      if (running && running.project_id === pid) await api.stopTimer(running)
      else await api.startTimer(userId, pid, subId, data!.engDeptIds[0] || null)
    })
  }

  // ── View helpers ──
  function statusOf(a: EngAssignment, s: PackedStrip | undefined): JobStatus {
    if (s?.over) {
      const what = a.board_hours != null ? 'scheduled hours' : 'estimate'
      return { text: s.overBy > 0.05 ? `${fmtH(s.overBy)}h over ${what}` : `Used all its ${what === 'estimate' ? 'estimated' : 'scheduled'} hours`, kind: 'late' }
    }
    if (a.firm_date && a.firm_date < today) return { text: 'Late', kind: 'late' }
    if (s?.atRisk) return { text: 'Won’t make due date', kind: 'risk' }
    if (a.firm_date) return { text: 'On track', kind: 'ok' }
    return { text: 'No due date', kind: 'none' }
  }

  function listFor(memberId: string) {
    return liveAssignments.filter((a) => a.member_id === memberId).sort((a, b) => a.priority - b.priority)
  }

  function dayLoad(eng: BoardData['engineers'][number], packed: PackedLane | null, d: string) {
    const off = data?.offByMember?.[eng.member.id]?.[d] || null
    const tag = off ? offTag(off, eng.dailyHours) : null
    const cap = Math.max(0, eng.dailyHours - (data?.outByMember[eng.member.id]?.[d] || 0))
    const tracked = trackedByMemberDay[eng.member.id]?.[d] || 0
    const planned = packed?.load[d]?.planned || 0
    const past = d < today
    const load = past ? tracked : planned + (d === today ? tracked : 0)
    const wholeOff = !!tag?.whole
    return { tag, cap, tracked, load, past, wholeOff, over: !wholeOff && load > cap + 0.05 }
  }

  if (!data && !error) {
    return <div style={{ padding: 24, fontFamily: UI_FONT, fontSize: 13, color: FAINT }}>Loading engineering…</div>
  }

  const engineers = data?.engineers || []
  const selEng = who && who !== 'team' ? engineers.find((e) => e.member.id === who) || null : null
  const selLane = selEng ? lanes.find((l) => l.eng.member.id === selEng.member.id)?.packed || null : null
  const rangeText = `${monthDay(viewDays[0])} – ${monthDay(viewDays[viewDays.length - 1])}`
  const openProject = openId ? projectById.get(openId) || null : null

  return (
    <div style={{ fontFamily: UI_FONT, background: PAGE, color: INK, minHeight: '100vh', fontSize: 14 }}>
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 32px 48px', boxSizing: 'border-box' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.6px' }}>Engineering</h1>
          {busy && <span style={{ fontSize: 12, color: FAINT }}>Saving…</span>}
        </div>
        {(error || data?.planError) && (
          <div style={{ marginBottom: 16, fontSize: 13, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px' }}>
            {data?.planError || error}
          </div>
        )}

        {/* Engineer tabs */}
        <div role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
          {[...engineers.map((e) => e.member.id), 'team'].map((k) => {
            const sel = k === who
            const eng = engineers.find((e) => e.member.id === k)
            const label = eng ? `${eng.member.name}${meUserId && eng.member.user_id === meUserId ? ' (you)' : ''}` : 'Whole team'
            const lane = lanes.find((l) => l.eng.member.id === k)
            const sub = eng ? `${fmtH(lane?.packed.queued || 0)}h left` : 'Compare everyone'
            return (
              <button key={k} role="tab" aria-selected={sel} onClick={() => { setWho(k); setOpenId(null) }}
                style={{
                  minHeight: 56, padding: '8px 18px', textAlign: 'left', borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${sel ? INK : LINE}`, background: sel ? INK : '#FFF', color: sel ? '#FFF' : INK, fontFamily: UI_FONT,
                }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{label}</span>
                <span style={{ display: 'block', fontSize: 12, marginTop: 2, opacity: 0.75 }}>{sub}</span>
              </button>
            )
          })}
        </div>

        {engineers.length === 0 && (
          <div style={{ ...CARD, padding: 20, color: MUTED, marginBottom: 24 }}>
            No engineers yet — put people in the Engineering department on /team and they show up here.
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'flex-start' }}>
          {/* MAIN */}
          <div style={{ flex: '999 1 640px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
            {selEng && (() => {
              const list = listFor(selEng.member.id)
              const statuses = list.map((a) => statusOf(a, stripByProject.get(a.project_id)))
              const late = statuses.filter((s) => s.kind === 'late').length
              const overDays = (selLane ? Object.keys(selLane.load) : []).filter((d) => d >= today && dayLoad(selEng, selLane, d).over).length
              const last = list.map((a) => stripByProject.get(a.project_id)?.end || '').sort().pop() || null
              const running = runningByMember.get(selEng.member.id) || null
              const runningElsewhere = running && !assignmentByProject.has(running.project_id) ? projectById.get(running.project_id)?.name || 'other work' : null
              return (
                <>
                  {/* Summary */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <Pill>{fmtH(selLane?.queued || 0)}h of engineering left</Pill>
                    <Pill muted>{last ? `Booked through ${shortDay(last)}` : 'Nothing booked'}</Pill>
                    {late > 0 && <Pill warn>{late} late {late === 1 ? 'job' : 'jobs'}</Pill>}
                    {overDays > 0 && <Pill warn>Over {fmtH(selEng.dailyHours)}h on {overDays} {overDays === 1 ? 'day' : 'days'}</Pill>}
                    {runningElsewhere && <Pill muted>Timer on: {runningElsewhere}</Pill>}
                  </div>

                  {/* The list */}
                  <div {...dropZone('q:end', 'queue', null)}
                    style={{ ...CARD, overflow: 'hidden', paddingBottom: 12, borderColor: overKey === 'q:end' && drag ? BLUE : LINE, boxShadow: overKey === 'q:end' && drag ? '0 0 0 3px #DBEAFE' : 'none' }}>
                    <div style={{ padding: '16px 20px', borderBottom: `1px solid ${SOFT}` }}>
                      <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{selEng.member.name.split(' ')[0]}’s list</h2>
                    </div>
                    {list.length === 0 && (
                      <div style={{ padding: '28px 20px', color: FAINT }}>Nothing assigned. Drag a job here from “Needs an engineer”.</div>
                    )}
                    {list.map((a, i) => {
                      const p = projectById.get(a.project_id)!
                      const s = stripByProject.get(a.project_id)
                      const st = statuses[i]
                      const budget = s?.budget ?? stripBudget(p.estHours, a.board_hours)
                      const trackedNow = trackedMinAt(p, clockMs) / 60
                      const left = Math.max(0, budget - trackedNow)
                      const overBy = Math.max(0, trackedNow - budget)
                      const pct = budget > 0 ? Math.min(100, (trackedNow / budget) * 100) : 100
                      const timing = running?.project_id === a.project_id
                      const canRun = api.canTime && !!selEng.member.user_id
                      const rowKey = `q:${a.project_id}`
                      return (
                        <div key={a.id} {...dragProps(a.project_id, 'queue')} {...dropZone(rowKey, 'queue', a.project_id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px', flexWrap: 'wrap', cursor: 'grab', background: '#FFF',
                            borderTop: `2px solid ${overKey === rowKey && drag && drag.id !== a.project_id ? BLUE : SOFT}`,
                            opacity: drag?.id === a.project_id ? 0.4 : 1,
                          }}>
                          <Grip />
                          <span style={{ width: 28, height: 28, flex: 'none', borderRadius: 8, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13 }}>{i + 1}</span>
                          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                            <button onClick={() => setOpenId(a.project_id)} style={{ display: 'block', maxWidth: '100%', padding: 0, border: 'none', background: 'none', textAlign: 'left', fontSize: 15, fontWeight: 600, color: INK, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: UI_FONT }}>
                              {p.name}
                            </button>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap', fontSize: 13, color: MUTED }}>
                              <span style={tagStyle(st.kind)}>{st.text}</span>
                              {a.firm_date && <span>Due {shortDay(a.firm_date)}</span>}
                              {s?.end && !s.over && <span style={{ color: FAINT }}>Finishes {shortDay(s.end)}</span>}
                            </div>
                          </div>
                          <div style={{ flex: '0 1 200px', minWidth: 160 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6, gap: 8 }}>
                              <span style={{ fontWeight: 600, color: overBy > 0.05 ? '#C2410C' : INK }}>{overBy > 0.05 ? `${fmtH(overBy)}h over` : `${fmtH(left)}h left`}</span>
                              <span style={{ color: FAINT }}>{fmtH(trackedNow)} of {fmtH(budget)}h logged</span>
                            </div>
                            <div style={{ height: 6, background: SOFT, borderRadius: 999, overflow: 'hidden' }}>
                              <div style={{ height: '100%', width: `${pct}%`, background: st.kind === 'late' ? ORANGE : BLUE, borderRadius: 999 }} />
                            </div>
                          </div>
                          <div style={{ flex: 'none', width: 220, display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
                            {timing && <Clock text={clockText(running!.started_at, clockMs)} />}
                            <button disabled={!canRun || busy} onClick={() => toggleTimer(selEng.member.id, a.project_id)}
                              title={!canRun ? `${selEng.member.name} has no login, so the timer can’t run for them — link one on /team.` : undefined}
                              style={timing ? btnStop : btnStart(canRun)}>
                              {timing ? 'Stop' : 'Start'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Chart */}
                  <div style={{ ...CARD, padding: '16px 20px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => setStep((s) => s - 1)} aria-label="Back two weeks" style={btnArrow}>‹</button>
                          <button onClick={() => setStep((s) => s + 1)} aria-label="Forward two weeks" style={btnArrow}>›</button>
                        </div>
                        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{rangeText}</h2>
                        {step !== 0 && (
                          <button onClick={() => setStep(0)} style={{ height: 32, padding: '0 12px', border: `1px solid ${LINE}`, background: '#FFF', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' }}>Back to today</button>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: MUTED }}>
                        <Legend color="#BFDBFE" label="Planned" />
                        <Legend color={MUTED} label="Logged" />
                        <Legend color={ORANGE} label={`Over ${fmtH(selEng.dailyHours)}h`} />
                      </div>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <div style={{ minWidth: 900 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${VIEW_DAYS}, minmax(0, 1fr))`, gap: 4 }}>
                          {viewDays.map((d) => {
                            const L = dayLoad(selEng, selLane, d)
                            const h = L.wholeOff ? 0 : Math.min(32, Math.round((L.load / Math.max(1, selEng.dailyHours * 1.5)) * 32))
                            const isToday = d === today
                            return (
                              <div key={d} title={L.tag?.short} style={{
                                textAlign: 'center', padding: '8px 4px', borderRadius: 8,
                                background: isToday ? '#EFF6FF' : L.tag ? SOFT : '#FFF', border: `1px solid ${isToday ? '#BFDBFE' : SOFT}`,
                              }}>
                                <div style={{ fontSize: 11, color: FAINT, fontWeight: 500 }}>{isToday ? 'Today' : weekday(d)}</div>
                                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{monthDay(d)}</div>
                                <div style={{ height: 32, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', marginTop: 8 }}>
                                  <div style={{ width: 18, height: h, borderRadius: 3, background: L.past ? MUTED : L.over ? ORANGE : '#BFDBFE' }} />
                                </div>
                                <div style={{ fontSize: 11, marginTop: 6, fontWeight: L.over ? 700 : 500, color: L.over ? '#C2410C' : L.tag ? FAINT : MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {L.wholeOff ? L.tag!.short : L.past ? `${fmtH(L.tracked)}h` : `${fmtH(L.load)} / ${fmtH(L.cap)}h`}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                          {list.map((a) => {
                            const p = projectById.get(a.project_id)!
                            const s = stripByProject.get(a.project_id)
                            const st = statusOf(a, s)
                            const first = viewDays[0]
                            const lastDay = viewDays[viewDays.length - 1]
                            const hours = s?.over ? `${fmtH(s.overBy)}h over` : `${fmtH(s?.remaining || 0)}h`
                            const start = s?.start || null
                            const end = s?.end || null
                            const before = !!end && end < first
                            const after = !start || start > lastDay
                            const ghost = before || after
                            const note = !start ? ' · not scheduled yet' : after ? ` · starts ${shortDay(start)}` : before ? ` · finishes ${shortDay(end)}` : ''
                            const colOf = (k: string) => { const i = viewDays.indexOf(k); return i >= 0 ? i : viewDays.findIndex((x) => x > k) }
                            const c0 = ghost ? 1 : (start! < first ? 0 : colOf(start!)) + 1
                            const c1 = ghost ? VIEW_DAYS + 1 : (end! > lastDay ? VIEW_DAYS - 1 : Math.max(colOf(end!), c0 - 1)) + 2
                            const pre = !ghost && start! < first ? '← ' : ''
                            const post = !ghost && end! > lastDay ? ' →' : ''
                            const warm = st.kind === 'late' || st.kind === 'risk'
                            return (
                              <div key={a.id} style={{ display: 'grid', gridTemplateColumns: `repeat(${VIEW_DAYS}, minmax(0, 1fr))`, gap: 4 }}>
                                <button onClick={() => setOpenId(a.project_id)} title={`${p.name} · ${hours}`}
                                  style={{
                                    gridColumn: `${c0} / ${c1}`, height: 32, padding: '0 10px', borderRadius: 6, textAlign: 'left', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: UI_FONT,
                                    border: ghost ? '1px dashed #D4D4D8' : 'none',
                                    background: ghost ? PAGE : warm ? '#FED7AA' : '#DBEAFE',
                                    color: ghost ? FAINT : warm ? '#9A3412' : '#1E3A8A',
                                  }}>
                                  {pre}{p.name} · {hours}{note}{post}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )
            })()}

            {who === 'team' && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => setStep((s) => s - 1)} aria-label="Back two weeks" style={btnArrow}>‹</button>
                    <button onClick={() => setStep((s) => s + 1)} aria-label="Forward two weeks" style={btnArrow}>›</button>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 600 }}>{rangeText}</span>
                  {step !== 0 && <button onClick={() => setStep(0)} style={{ height: 32, padding: '0 12px', border: `1px solid ${LINE}`, background: '#FFF', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Back to today</button>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
                  {lanes.map(({ eng, packed }) => {
                    const list = listFor(eng.member.id)
                    const late = list.filter((a) => statusOf(a, stripByProject.get(a.project_id)).kind === 'late').length
                    const running = runningByMember.get(eng.member.id)
                    const outToday = (data?.outByMember[eng.member.id]?.[today] || 0) >= eng.dailyHours - 0.05
                    return (
                      <div key={eng.member.id} style={{ ...CARD, padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div>
                          <div style={{ fontSize: 17, fontWeight: 600 }}>{eng.member.name}</div>
                          <div style={{ fontSize: 13, color: running ? '#15803D' : MUTED, marginTop: 2 }}>
                            {running ? `Timer on: ${projectById.get(running.project_id)?.name || 'other work'}` : outToday ? 'Out today' : 'No timer running'}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 20 }}>
                          <Stat value={fmtH(packed.queued)} label="hours left" />
                          <Stat value={String(list.length)} label="jobs" />
                          <Stat value={String(late)} label="late" warn={late > 0} />
                        </div>
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${VIEW_DAYS}, minmax(0, 1fr))`, gap: 3 }}>
                            {viewDays.map((d) => {
                              const L = dayLoad(eng, packed, d)
                              const bg = L.wholeOff ? '#E4E4E7' : L.over ? ORANGE : L.load >= L.cap - 0.05 && L.cap > 0 ? BLUE : L.load > 0.05 ? '#BFDBFE' : SOFT
                              return <div key={d} title={`${monthDay(d)}: ${L.wholeOff ? L.tag!.short : `${fmtH(L.load)}h`}`} style={{ height: 22, borderRadius: 4, background: bg }} />
                            })}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: FAINT, marginTop: 4 }}>
                            <span>{monthDay(viewDays[0])}</span><span>{monthDay(viewDays[viewDays.length - 1])}</span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {list.slice(0, 6).map((a, i) => {
                            const st = statusOf(a, stripByProject.get(a.project_id))
                            return (
                              <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 13 }}>
                                <span style={{ color: FAINT, width: 16 }}>{i + 1}</span>
                                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{projectById.get(a.project_id)?.name}</span>
                                <span style={{ color: st.kind === 'late' ? '#C2410C' : FAINT, fontWeight: st.kind === 'late' ? 600 : 400, whiteSpace: 'nowrap' }}>{a.firm_date ? monthDay(a.firm_date) : ''}</span>
                              </div>
                            )
                          })}
                          {list.length > 6 && <div style={{ fontSize: 12, color: FAINT }}>+ {list.length - 6} more</div>}
                        </div>
                        <button onClick={() => setWho(eng.member.id)} style={{ height: 44, border: `1px solid ${LINE}`, background: '#FFF', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontFamily: UI_FONT, fontSize: 14 }}>
                          Open {eng.member.name.split(' ')[0]}’s schedule
                        </button>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* SIDEBAR — Needs an engineer */}
          <div style={{ flex: '1 1 320px', maxWidth: 380, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div {...dropZone('p:end', 'pool', null)}
              style={{ ...CARD, overflow: 'hidden', paddingBottom: 12, borderColor: overKey === 'p:end' && drag ? BLUE : LINE, boxShadow: overKey === 'p:end' && drag ? '0 0 0 3px #DBEAFE' : 'none' }}>
              <div style={{ padding: '16px 18px', borderBottom: `1px solid ${SOFT}` }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Needs an engineer <span style={{ color: FAINT, fontWeight: 500 }}>· {poolOrdered.length}</span></h2>
                {!poolShared && data && (
                  <div style={{ fontSize: 12, color: FAINT, marginTop: 4 }}>This order is only saved on this computer until migration 137 runs.</div>
                )}
              </div>
              {poolOrdered.length === 0 && <div style={{ padding: '20px 18px', fontSize: 13, color: FAINT }}>Every job with engineering left has an engineer.</div>}
              {poolOrdered.map((pid, i) => {
                const p = projectById.get(pid)!
                const a = assignmentByProject.get(pid)
                const tracked = trackedMin(p) / 60
                const left = a ? poolRemainder(p.estHours, tracked, a.board_hours) : remainingHours(p.estHours, tracked)
                const owner = a ? engineers.find((e) => e.member.id === a.member_id) : null
                const rowKey = `p:${pid}`
                return (
                  <div key={pid} {...dragProps(pid, 'pool')} {...dropZone(rowKey, 'pool', pid)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', cursor: 'grab', background: '#FFF',
                      borderTop: `2px solid ${overKey === rowKey && drag && drag.id !== pid ? BLUE : SOFT}`, opacity: drag?.id === pid ? 0.4 : 1,
                    }}>
                    <Grip small />
                    <span style={{ width: 22, height: 22, flex: 'none', borderRadius: 6, background: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 12 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                        <button onClick={() => setOpenId(pid)} style={{ display: 'block', minWidth: 0, padding: 0, border: 'none', background: 'none', textAlign: 'left', fontWeight: 500, fontSize: 13, color: INK, cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: UI_FONT }}>
                          {p.name}
                        </button>
                        {p.isTemp && <span style={{ flex: 'none', fontSize: 10, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 4, padding: '1px 5px' }}>TEMP</span>}
                      </div>
                      <div style={{ fontSize: 12, color: FAINT, marginTop: 2 }}>
                        {fmtH(left)}h of engineering{owner ? ` · the rest is on ${owner.member.name.split(' ')[0]}’s list` : ''}
                      </div>
                    </div>
                    {!a && engineers.length > 0 && (
                      <select value="" aria-label={`Assign ${p.name}`} onChange={(e) => { if (e.target.value) placeOnList(pid, e.target.value, null) }}
                        style={{ height: 36, border: `1px solid ${LINE}`, borderRadius: 8, background: '#FFF', padding: '0 8px', fontSize: 13, color: INK }}>
                        <option value="">Assign…</option>
                        {engineers.map((e) => <option key={e.member.id} value={e.member.id}>{e.member.name.split(' ')[0]}</option>)}
                      </select>
                    )}
                  </div>
                )
              })}
            </div>

            {doneThisMonth.length > 0 && (
              <div style={{ ...CARD, padding: '14px 18px' }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Finished this month <span style={{ color: FAINT, fontWeight: 500 }}>· {doneThisMonth.length}</span></div>
                {doneThisMonth.map((a) => {
                  const p = projectById.get(a.project_id)!
                  const tracked = trackedMin(p) / 60
                  return (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 13, borderTop: `1px solid ${SOFT}` }}>
                      <span style={{ color: GREEN }}>✓</span>
                      <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                      <span style={{ fontSize: 12, color: FAINT, whiteSpace: 'nowrap' }}>{fmtH(tracked)}h · {monthDay(dateKey(new Date(a.done_at!)))}</span>
                      <button onClick={() => run(() => api.setDone(a.id, a.project_id, false, tracked))}
                        style={{ border: 'none', background: 'none', padding: 0, fontSize: 12, color: '#1D4ED8', cursor: 'pointer' }}>Reopen</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {openProject && data && (
        <JobPanel
          key={`${openProject.id}:${assignmentByProject.get(openProject.id)?.member_id || ''}:${assignmentByProject.get(openProject.id)?.priority ?? ''}`}
          project={openProject}
          assignment={assignmentByProject.get(openProject.id) || null}
          status={assignmentByProject.get(openProject.id) ? statusOf(assignmentByProject.get(openProject.id)!, stripByProject.get(openProject.id)) : null}
          strip={stripByProject.get(openProject.id) || null}
          lane={lanes.find((l) => l.packed.memberId === assignmentByProject.get(openProject.id)?.member_id)?.packed || null}
          engineers={engineers}
          trackedHours={trackedMinAt(openProject, clockMs) / 60}
          subs={data.subsByProject[openProject.id] || []}
          running={runningByMember}
          projectById={projectById}
          engDeptIds={data.engDeptIds}
          today={today}
          horizon={horizon}
          clockMs={clockMs}
          canTime={api.canTime}
          busy={busy}
          onClose={() => setOpenId(null)}
          onAssign={(memberId, boardHours) => run(async () => {
            const a = assignmentByProject.get(openProject.id)
            const rows = liveAssignments.filter((x) => x.member_id === memberId && x.project_id !== openProject.id)
            const priority = rows.length ? Math.max(...rows.map((x) => x.priority)) + 1 : 1
            if (a) await api.update(a.id, { member_id: memberId, priority })
            else await api.assign(openProject.id, memberId, priority, boardHours)
          })}
          onSave={(patch) => run(async () => {
            const a = assignmentByProject.get(openProject.id)
            if (a) await api.update(a.id, patch)
          })}
          onDone={() => run(async () => {
            const a = assignmentByProject.get(openProject.id)
            if (a) await api.setDone(a.id, openProject.id, true, trackedMin(openProject) / 60)
            setOpenId(null)
          })}
          onRemove={() => { backToPool(openProject.id, null); setOpenId(null) }}
          onTimer={(memberId, subId) => toggleTimer(memberId, openProject.id, subId)}
        />
      )}
      <style>{`@keyframes engPulse { 50% { opacity: .55 } } .eng-pulse { animation: engPulse 1.6s infinite }`}</style>
    </div>
  )
}

// ── Small pieces ──
const btnArrow: React.CSSProperties = { width: 36, height: 36, border: `1px solid ${LINE}`, background: '#FFF', borderRadius: 8, fontSize: 16, color: '#3F3F46', cursor: 'pointer' }
const btnStop: React.CSSProperties = { height: 44, minWidth: 76, padding: '0 14px', border: 'none', background: INK, color: '#FFF', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: UI_FONT }
const btnStart = (enabled: boolean): React.CSSProperties => ({
  height: 44, minWidth: 76, padding: '0 14px', border: `1px solid ${enabled ? GREEN : LINE}`, background: '#FFF', color: enabled ? '#15803D' : '#A1A1AA',
  borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: enabled ? 'pointer' : 'not-allowed', fontFamily: UI_FONT,
})

function Pill({ children, muted, warn }: { children: React.ReactNode; muted?: boolean; warn?: boolean }) {
  return (
    <span style={{
      padding: '6px 12px', borderRadius: 999, fontSize: 13, fontWeight: warn || !muted ? 500 : 400,
      background: warn ? '#FFEDD5' : '#FFF', border: warn ? '1px solid #FFEDD5' : `1px solid ${LINE}`, color: warn ? '#9A3412' : muted ? MUTED : INK,
    }}>{children}</span>
  )
}

function Stat({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700, color: warn ? '#C2410C' : INK }}>{value}</div>
      <div style={{ fontSize: 12, color: FAINT }}>{label}</div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span><span aria-hidden="true" style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: color, marginRight: 6 }} />{label}</span>
}

function Grip({ small }: { small?: boolean }) {
  return (
    <span aria-hidden="true" title="Drag to reorder" style={{ flex: 'none', color: '#A1A1AA', display: 'flex', alignItems: 'center', marginRight: small ? -4 : -6 }}>
      <svg width={small ? 12 : 14} height={small ? 18 : 20} viewBox="0 0 14 20" fill="currentColor">
        <circle cx="4" cy="4" r="1.6" /><circle cx="10" cy="4" r="1.6" /><circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="4" cy="16" r="1.6" /><circle cx="10" cy="16" r="1.6" />
      </svg>
    </span>
  )
}

function Clock({ text, big }: { text: string; big?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: big ? 48 : 44, boxSizing: 'border-box', padding: '0 14px', borderRadius: 8, background: '#DCFCE7', color: '#166534', fontSize: 17, lineHeight: 1, fontWeight: 600 }}>
      <span className="eng-pulse" aria-hidden="true" style={{ width: 10, height: 10, borderRadius: '50%', background: GREEN }} />
      <span style={{ fontFamily: MONO }}>{text}</span>
    </span>
  )
}

// =====================================================
// JOB PANEL — the side panel (replaces the strip modal)
// =====================================================
function JobPanel({
  project, assignment, status, strip, lane, engineers, trackedHours, subs, running, projectById, engDeptIds, today, horizon, clockMs, canTime, busy,
  onClose, onAssign, onSave, onDone, onRemove, onTimer,
}: {
  project: BoardProject
  assignment: EngAssignment | null
  status: JobStatus | null
  strip: PackedStrip | null
  lane: PackedLane | null
  engineers: BoardData['engineers']
  trackedHours: number
  subs: Array<{ id: string; name: string }>
  running: Map<string, BoardEntry>
  projectById: Map<string, BoardProject>
  engDeptIds: string[]
  today: string
  horizon: string[]
  clockMs: number
  canTime: boolean
  busy: boolean
  onClose: () => void
  onAssign: (memberId: string, boardHours: number | null) => void
  onSave: (patch: AssignmentPatch) => void
  onDone: () => void
  onRemove: () => void
  onTimer: (memberId: string, subId: string | null) => void
}) {
  const eng = assignment ? engineers.find((e) => e.member.id === assignment.member_id) || null : null
  const first = eng ? eng.member.name.split(' ')[0] : ''
  const estLeft = remainingHours(project.estHours, trackedHours)

  // Scheduled hours (131): typed as what's still to do; stored as the total incl. logged.
  const savedBudget = stripBudget(project.estHours, assignment?.board_hours ?? null)
  const savedLeft = Math.max(0, assignment ? savedBudget - trackedHours : estLeft)
  const [hoursIn, setHoursIn] = useState(() => fmtH(savedLeft))
  const hoursTyped = Math.max(0, Number(hoursIn) || 0)
  const hoursDirty = Math.abs(hoursTyped - savedLeft) > 0.05
  const remaining = assignment ? hoursTyped : estLeft
  const boardTotal = (typed: number): number | null =>
    Math.abs(typed - estLeft) <= 0.05 && (assignment?.board_hours ?? null) == null ? null : Math.round((trackedHours + typed) * 10) / 10

  // Due date (firm_date).
  const [due, setDue] = useState(assignment?.firm_date || '')
  const dueDirty = (due || null) !== (assignment?.firm_date || null)

  // When the hours happen: automatic (pack in list order) or picked days.
  const savedCustom = !!(strip?.divided || strip?.pinned)
  const [custom, setCustom] = useState(savedCustom)
  const initialRows = useMemo(() => {
    const days = strip ? Object.entries(strip.days).filter(([, h]) => h > 0.001).sort(([a], [b]) => a.localeCompare(b)) : []
    return days.map(([date, hours]) => ({ date, hours: String(Math.round(hours * 10) / 10) }))
  }, [strip])
  const [rows, setRows] = useState<Array<{ date: string; hours: string }>>(initialRows)
  const [rowsDirty, setRowsDirty] = useState(false)
  const modeDirty = custom !== savedCustom
  const parsed: Division[] = rows.map((r) => ({ date: r.date, hours: Number(r.hours) || 0 }))
  const sum = parsed.reduce((s, r) => s + r.hours, 0)
  const matches = divisionsMatch(parsed, remaining)
  const dupDates = new Set(parsed.map((r) => r.date)).size !== parsed.length
  const rowsOk = matches && !dupDates && parsed.every((r) => r.date >= today)

  const [subId, setSubId] = useState('')
  const [timerFor, setTimerFor] = useState<string>(() => {
    const onThis = engineers.find((e) => running.get(e.member.id)?.project_id === project.id)
    return (onThis || engineers.find((e) => e.member.user_id) || engineers[0])?.member.id || ''
  })
  const timerEng = eng || engineers.find((e) => e.member.id === timerFor) || null
  const active = timerEng ? running.get(timerEng.member.id) || null : null
  const timingHere = !!active && active.project_id === project.id && (!active.department_id || engDeptIds.includes(active.department_id))
  const canRun = canTime && !!timerEng?.member.user_id

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  /** Hours still open that day for other work, after this job's rows. */
  const openOn = (d: string): number | null => {
    if (!lane) return null
    const L = lane.load[d]
    if (!L) return null
    const others = L.planned - (strip?.days[d] || 0)
    const mine = parsed.filter((r) => r.date === d).reduce((s, r) => s + r.hours, 0)
    return L.cap - others - mine - (d === today ? L.tracked : 0)
  }
  function patchRow(i: number, patch: Partial<{ date: string; hours: string }>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setRowsDirty(true)
  }
  function addDay() {
    const lastDate = rows.length ? rows[rows.length - 1].date : null
    const next = lastDate ? workdaysFrom(lastDate, 2)[1] : horizon[0]
    setRows((rs) => [...rs, { date: next, hours: '0' }])
    setRowsDirty(true)
  }
  function evenSplit() {
    const dates = rows.length ? rows.map((r) => r.date) : [horizon[0]]
    setRows(evenDivide(remaining, dates).map((r) => ({ date: r.date, hours: String(r.hours) })))
    setRowsDirty(true)
  }

  const changed = !!assignment && (hoursDirty || dueDirty || modeDirty || (custom && rowsDirty))
  const canSave = changed && (!custom || !(rowsDirty || modeDirty) || rowsOk)
  function save() {
    const patch: AssignmentPatch = {}
    if (dueDirty) patch.firm_date = due || null
    if (hoursDirty) {
      patch.board_hours = boardTotal(hoursTyped)
      // Picked days for the old number no longer add up — back to automatic
      // unless the days were re-picked against the new number.
      if (strip?.divided && !(custom && rowsDirty)) patch.divisions = null
    }
    if (!custom && savedCustom) { patch.divisions = null; patch.start_date = null }
    if (custom && (rowsDirty || modeDirty)) {
      patch.divisions = parsed.filter((r) => r.hours > 0).sort((a, b) => a.date.localeCompare(b.date))
      patch.start_date = null
    }
    onSave(patch)
  }
  function cancel() {
    setHoursIn(fmtH(savedLeft)); setDue(assignment?.firm_date || ''); setCustom(savedCustom); setRows(initialRows); setRowsDirty(false)
  }

  const pct = savedBudget > 0 ? Math.min(100, (trackedHours / (assignment ? savedBudget : project.estHours || 1)) * 100) : 100
  const overBy = strip?.over ? Math.max(0, trackedHours - savedBudget) : 0
  const seg = (on: boolean): React.CSSProperties => ({
    height: 40, border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: UI_FONT,
    background: on ? '#FFF' : 'transparent', color: on ? INK : MUTED, boxShadow: on ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
  })
  const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6, color: INK }
  const input: React.CSSProperties = { width: '100%', height: 44, border: '1px solid #D4D4D8', borderRadius: 8, padding: '0 10px', fontSize: 14, boxSizing: 'border-box', background: '#FFF', fontFamily: UI_FONT }
  const link: React.CSSProperties = { border: 'none', background: 'none', padding: 0, color: '#1D4ED8', fontWeight: 500, fontSize: 13, cursor: 'pointer', fontFamily: UI_FONT }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 100, fontFamily: UI_FONT }}>
      <button onClick={onClose} aria-label="Close job details" tabIndex={-1}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', padding: 0, border: 'none', background: 'rgba(24,24,27,0.25)', cursor: 'default' }} />
      <div role="dialog" aria-label="Job details"
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 460, maxWidth: '100%', background: '#FFF', boxShadow: '-8px 0 32px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', color: INK }}>
        <div style={{ padding: '22px 24px 18px', borderBottom: `1px solid ${SOFT}`, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.3 }}>{project.name}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap', fontSize: 13, color: MUTED }}>
              {status ? <span style={tagStyle(status.kind)}>{status.text}</span> : <span style={tagStyle('none')}>Needs an engineer</span>}
              {assignment?.firm_date && <span>Due {shortDay(assignment.firm_date)}</span>}
              {strip?.end && !strip.over && <span style={{ color: FAINT }}>Finishes {shortDay(strip.end)}</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ width: 40, height: 40, border: 'none', background: SOFT, borderRadius: 8, color: MUTED, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X width={18} height={18} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22, flex: 1, overflowY: 'auto' }}>
          {/* Hours */}
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <Box label={assignment?.board_hours != null ? 'Scheduled' : 'Estimate'} value={`${fmtH(assignment ? savedBudget : project.estHours)}h`} />
              <Box label="Logged" value={`${fmtH(trackedHours)}h`} />
              <Box label="Left" value={overBy > 0.05 ? `${fmtH(overBy)}h over` : `${fmtH(assignment ? Math.max(0, savedBudget - trackedHours) : estLeft)}h`} warn={overBy > 0.05} />
            </div>
            <div style={{ height: 6, background: SOFT, borderRadius: 999, overflow: 'hidden', marginTop: 12 }}>
              <div style={{ height: '100%', width: `${pct}%`, background: overBy > 0.05 || status?.kind === 'late' ? ORANGE : BLUE, borderRadius: 999 }} />
            </div>
          </div>

          {/* Timer — same clock as /me */}
          {canTime && timerEng && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!eng && engineers.length > 1 && (
                <select value={timerFor} onChange={(e) => setTimerFor(e.target.value)} aria-label="Track time for" style={{ ...input, height: 40 }}>
                  {engineers.map((e) => <option key={e.member.id} value={e.member.id}>Track time for {e.member.name}</option>)}
                </select>
              )}
              {subs.length > 0 && !timingHere && (
                <select value={subId} onChange={(e) => setSubId(e.target.value)} aria-label="Part of the job" style={{ ...input, height: 40 }}>
                  <option value="">Whole job</option>
                  {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
              {timingHere ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  <Clock big text={clockText(active!.started_at, clockMs)} />
                  <button disabled={busy} onClick={() => onTimer(timerEng.member.id, null)} style={{ ...btnStop, flex: 1, height: 48, fontSize: 15 }}>Stop timer</button>
                </div>
              ) : (
                <button disabled={!canRun || busy} onClick={() => onTimer(timerEng.member.id, subId || null)}
                  style={{ height: 48, border: 'none', borderRadius: 10, fontWeight: 600, fontSize: 15, color: '#FFF', background: canRun ? GREEN : '#D4D4D8', cursor: canRun ? 'pointer' : 'not-allowed', fontFamily: UI_FONT }}>
                  Start timer{eng ? '' : ` for ${timerEng.member.name.split(' ')[0]}`}
                </button>
              )}
              {!canRun && <div style={{ fontSize: 13, color: '#92400E', textAlign: 'center' }}>{timerEng.member.name} has no login, so the timer can’t run for them — link one on /team.</div>}
              {canRun && active && !timingHere && (
                <div style={{ fontSize: 13, color: MUTED, textAlign: 'center' }}>This stops the timer on {projectById.get(active.project_id)?.name || 'other work'}.</div>
              )}
            </div>
          )}

          {/* Engineer + due */}
          <div style={{ display: 'grid', gridTemplateColumns: assignment ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: 12 }}>
            <div>
              <label htmlFor="jp-eng" style={label}>Engineer</label>
              <select id="jp-eng" value={assignment?.member_id || ''} disabled={busy}
                onChange={(e) => e.target.value && onAssign(e.target.value, assignment ? null : boardTotal(hoursTyped))} style={input}>
                {!assignment && <option value="">Not assigned — pick someone</option>}
                {engineers.map((e) => <option key={e.member.id} value={e.member.id}>{e.member.name}</option>)}
              </select>
            </div>
            {assignment && (
              <div>
                <label htmlFor="jp-due" style={label}>Due date</label>
                <input id="jp-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} style={input} />
              </div>
            )}
          </div>
          {assignment && (
            <div style={{ marginTop: -12, fontSize: 13, color: FAINT, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {due ? <span>If the schedule can’t make this date, the job is flagged.</span> : <span>No due date.</span>}
              {due && <button onClick={() => setDue('')} style={link}>Clear</button>}
            </div>
          )}

          {/* Scheduled hours (break part of the estimate out) */}
          <div>
            <label htmlFor="jp-hours" style={label}>Hours to schedule</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <input id="jp-hours" type="number" min={0} step={0.5} value={hoursIn} onChange={(e) => setHoursIn(e.target.value)}
                style={{ ...input, width: 100, textAlign: 'right', fontFamily: MONO }} />
              <span style={{ fontSize: 13, color: FAINT }}>of {fmtH(estLeft)}h estimate left</span>
              {Math.abs(hoursTyped - estLeft) > 0.05 && <button onClick={() => setHoursIn(fmtH(estLeft))} style={link}>Use all of it</button>}
            </div>
            <div style={{ fontSize: 13, color: FAINT, marginTop: 6 }}>
              {hoursTyped < estLeft - 0.05
                ? `${fmtH(estLeft - hoursTyped)}h stays in “Needs an engineer” for later.`
                : 'Lower this to schedule only part of the job now.'}
            </div>
          </div>

          {/* When the hours happen */}
          {assignment && remaining > 0.05 && (
            <div>
              <div style={label}>When the hours happen</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, background: SOFT, padding: 4, borderRadius: 10 }}>
                <button onClick={() => setCustom(false)} style={seg(!custom)}>Automatic</button>
                <button onClick={() => { setCustom(true); if (!rows.length) setRows(initialRows) }} style={seg(custom)}>I’ll pick the days</button>
              </div>
              {!custom && <p style={{ margin: '10px 0 0', fontSize: 13, color: MUTED }}>Fills {first}’s open hours in list order. Skips holidays and time off.</p>}
              {custom && (
                <>
                  <p style={{ margin: '10px 0 8px', fontSize: 13, color: MUTED }}>These days are locked. Other jobs fit around them.</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {rows.map((r, i) => {
                      const open = openOn(r.date)
                      const overDay = open != null && open < -0.05
                      return (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input type="date" value={r.date} min={today} aria-label="Day" onChange={(e) => patchRow(i, { date: e.target.value })}
                            style={{ ...input, flex: 1, height: 40, width: 'auto' }} />
                          <input type="number" min={0} step={0.5} value={r.hours} aria-label="Hours" onChange={(e) => patchRow(i, { hours: e.target.value })}
                            style={{ ...input, width: 64, height: 40, textAlign: 'right', fontFamily: MONO }} />
                          <span style={{ width: 92, fontSize: 12, fontWeight: overDay ? 600 : 400, color: overDay ? '#C2410C' : FAINT }}>
                            {open == null ? '' : overDay ? `Over by ${fmtH(-open)}h` : open < 0.05 ? 'Day full' : `${fmtH(open)}h open`}
                          </span>
                          <button onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setRowsDirty(true) }} aria-label="Remove day"
                            style={{ border: 'none', background: 'none', color: '#A1A1AA', cursor: 'pointer', fontSize: 16, padding: 0, width: 16 }}>×</button>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <button onClick={addDay} style={link}>+ Add a day</button>
                    <button onClick={evenSplit} style={link}>Spread evenly</button>
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: rowsOk ? '#15803D' : '#C2410C' }}>
                      {dupDates ? 'One row per day' : `${fmtH(sum)} of ${fmtH(remaining)}h${rowsOk ? ' ✓' : ''}`}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: '16px 24px', borderTop: `1px solid ${SOFT}`, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {changed ? (
            <>
              <button disabled={!canSave || busy} onClick={save}
                style={{ height: 44, padding: '0 20px', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, fontFamily: UI_FONT, background: canSave ? INK : '#E4E4E7', color: canSave ? '#FFF' : '#A1A1AA', cursor: canSave ? 'pointer' : 'not-allowed' }}>
                Save
              </button>
              <button onClick={cancel} style={{ height: 44, padding: '0 16px', border: `1px solid ${LINE}`, background: '#FFF', borderRadius: 8, fontWeight: 500, fontSize: 14, cursor: 'pointer', fontFamily: UI_FONT }}>Undo changes</button>
            </>
          ) : assignment ? (
            <button disabled={busy} onClick={onDone}
              style={{ height: 44, padding: '0 18px', border: `1px solid ${GREEN}`, background: '#FFF', color: '#15803D', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: UI_FONT }}>
              Engineering done
            </button>
          ) : null}
          <span style={{ flex: 1 }} />
          {assignment && !changed && (
            <button disabled={busy} onClick={onRemove} style={{ height: 44, padding: '0 12px', border: 'none', background: 'none', color: '#B91C1C', fontWeight: 500, fontSize: 14, cursor: 'pointer', fontFamily: UI_FONT }}>
              Take off {first}’s list
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Box({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ background: PAGE, borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 12, color: FAINT }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, color: warn ? '#C2410C' : INK }}>{value}</div>
    </div>
  )
}
