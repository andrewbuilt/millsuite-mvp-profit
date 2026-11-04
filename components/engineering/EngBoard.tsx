'use client'

// ============================================================================
// components/engineering/EngBoard.tsx — the ENGINEERING BOARD (batch-2 item D, approved 2026-11-04)
// ============================================================================
// Lanes = engineers · columns = days. A strip = a project's REMAINING
// engineering hours, packed forward at the engineer's daily hours; the time
// clock eats it, nobody edits the board when reality interrupts. The divide
// modal is the only hand tool (plus the timer, which runs the SAME
// lib/worker-time clockIn/clockOut as /me).
//
// Structure: mockups/engineering-board-mockup.html (v5). Aesthetics: the
// /schedule swimlane (shared tokens in lib/schedule-style). Data: one layer —
// see lib/eng-board.ts. Math: lib/eng-board-math.ts (pure, verified).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { COLOR_PALETTE, MONO, UI_FONT, btnS, type PaletteColor } from '@/lib/schedule-style'
import {
  entryMinutes, entryDay,
  type BoardData, type BoardEntry, type EngAssignment, type BoardProject,
} from '@/lib/eng-board'
import {
  packLane, workdaysFrom, mondayOfKey, dateKey, parseKey, evenDivide, divisionsMatch,
  priorityBetween, fmtH, remainingHours, type PackedLane, type PackedStrip, type Division,
} from '@/lib/eng-board-math'

const DAY_W = 76
const LABEL_W = 170
const STRIP_H = 24
const STRIP_GAP = 6
const VIEW_DAYS = 15
const HORIZON_DAYS = 260

function dayLabel(k: string): { wd: string; md: string } {
  const d = parseKey(k)
  return {
    wd: d.toLocaleDateString('en-US', { weekday: 'short' }),
    md: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }
}
function shortDay(k: string | null): string {
  if (!k) return '—'
  return parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Everything the board reads and writes. The page wires Supabase
 *  (lib/eng-board + lib/worker-time); /dev/eng-board wires local fixtures. */
export interface BoardApi {
  load: (fromKey: string, horizonEndKey: string) => Promise<BoardData>
  assign: (projectId: string, memberId: string, priority: number) => Promise<void>
  update: (assignmentId: string, patch: Partial<Pick<EngAssignment, 'member_id' | 'priority' | 'divisions' | 'firm_date'>>) => Promise<void>
  unassign: (assignmentId: string) => Promise<void>
  /** Same clockIn as /me — closes whatever that person had running first. */
  startTimer: (userId: string, projectId: string, subprojectId: string | null, departmentId: string | null) => Promise<void>
  stopTimer: (entry: BoardEntry) => Promise<void>
  canTime: boolean
}

export default function EngBoard({ api }: { api: BoardApi }) {
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [modal, setModal] = useState<{ projectId: string } | null>(null)
  const [dragProject, setDragProject] = useState<string | null>(null)
  const [dropLane, setDropLane] = useState<string | null>(null)
  const [dropChip, setDropChip] = useState<string | null>(null)
  const loadSeq = useRef(0)

  const today = dateKey(new Date(nowMs))
  const windowStart = useMemo(() => {
    const d = parseKey(mondayOfKey(today))
    d.setDate(d.getDate() + weekOffset * 7)
    return dateKey(d)
  }, [today, weekOffset])
  const viewDays = useMemo(() => workdaysFrom(windowStart, VIEW_DAYS), [windowStart])
  const horizon = useMemo(() => workdaysFrom(today, HORIZON_DAYS), [today])
  // Tracked band + day headers need this week's past days even when paged forward.
  const loadFrom = useMemo(() => (windowStart < mondayOfKey(today) ? windowStart : mondayOfKey(today)), [windowStart, today])

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current
    try {
      const d = await api.load(loadFrom, horizon[horizon.length - 1])
      if (seq !== loadSeq.current) return
      setData(d)
      setError(null)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setError(e instanceof Error ? e.message : 'Couldn’t load the board.')
    }
  }, [api, loadFrom, horizon])

  useEffect(() => { reload() }, [reload])
  // A running timer burns the strip live; repack twice a minute.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])

  // ── Derived ──
  const projectById = useMemo(() => new Map((data?.projects || []).map((p) => [p.id, p])), [data])
  const colorOf = useMemo(() => {
    const ids = [...(data?.projects || [])].sort((a, b) => a.name.localeCompare(b.name)).map((p) => p.id)
    const m = new Map<string, PaletteColor>()
    ids.forEach((id, i) => m.set(id, COLOR_PALETTE[i % COLOR_PALETTE.length]))
    return (id: string) => m.get(id) || COLOR_PALETTE[0]
  }, [data])

  const engineerIds = useMemo(() => new Set((data?.engineers || []).map((e) => e.member.id)), [data])
  const userToMember = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of data?.engineers || []) if (e.member.user_id) m.set(e.member.user_id, e.member.id)
    return m
  }, [data])

  /** Tracked minutes per project INCLUDING running timers up to now. */
  const trackedMin = useCallback((p: BoardProject): number => {
    // loadEngBoard counted running entries to load time; top up to now.
    let extra = 0
    for (const e of data?.entries || []) {
      if (e.ended_at || e.project_id !== p.id || !e.department_id || !data!.engDeptIds.includes(e.department_id)) continue
      extra += Math.max(0, entryMinutes(e, nowMs) - entryMinutes(e, loadedAt.current))
    }
    return p.trackedMinutes + extra
  }, [data, nowMs])
  const loadedAt = useRef(Date.now())
  useEffect(() => { loadedAt.current = Date.now() }, [data])

  const liveAssignments = useMemo(
    () => (data?.assignments || []).filter((a) => engineerIds.has(a.member_id) && projectById.has(a.project_id)),
    [data, engineerIds, projectById],
  )
  const assignmentByProject = useMemo(() => new Map(liveAssignments.map((a) => [a.project_id, a])), [liveAssignments])

  /** member → date → eng hours tracked (all projects), running included. */
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

  const lanes: Array<{ eng: BoardData['engineers'][number]; packed: PackedLane }> = useMemo(() => {
    if (!data) return []
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

  const rail = useMemo(() => [...liveAssignments].sort((a, b) => a.priority - b.priority), [liveAssignments])

  const tray = useMemo(() => {
    return (data?.projects || [])
      .filter((p) => !assignmentByProject.has(p.id))
      .filter((p) => remainingHours(p.estHours, trackedMin(p) / 60) > 0.05)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [data, assignmentByProject, trackedMin])

  const runningByMember = useMemo(() => {
    const m = new Map<string, BoardEntry>()
    for (const e of data?.entries || []) {
      if (e.ended_at) continue
      const mid = userToMember.get(e.user_id)
      if (mid) m.set(mid, e)
    }
    return m
  }, [data, userToMember])

  // ── Writes ──
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<void>) {
    setBusy(true)
    try { await fn(); await reload() } catch (e) {
      setError(e instanceof Error ? e.message : 'That didn’t save.')
    } finally { setBusy(false) }
  }

  function nextPriority(): number {
    const ps = (data?.assignments || []).map((a) => a.priority)
    return ps.length ? Math.max(...ps) + 1 : 1
  }

  function dropOnLane(memberId: string) {
    const pid = dragProject
    setDragProject(null); setDropLane(null)
    if (!pid) return
    const a = (data?.assignments || []).find((x) => x.project_id === pid)
    if (a && a.member_id === memberId) return
    run(async () => {
      if (a) await api.update(a.id, { member_id: memberId })
      else await api.assign(pid, memberId, nextPriority())
    })
  }

  function dropOnChip(targetProjectId: string) {
    const pid = dragProject
    setDragProject(null); setDropChip(null)
    if (!pid || pid === targetProjectId) return
    const moving = rail.find((a) => a.project_id === pid)
    const idx = rail.findIndex((a) => a.project_id === targetProjectId)
    if (!moving || idx < 0) return
    const without = rail.filter((a) => a.project_id !== pid)
    const tIdx = without.findIndex((a) => a.project_id === targetProjectId)
    const before = tIdx > 0 ? without[tIdx - 1].priority : null
    const pri = priorityBetween(before, without[tIdx].priority)
    run(() => api.update(moving.id, { priority: pri }))
  }

  if (!data && !error) {
    return <div style={{ padding: 24, fontFamily: UI_FONT, fontSize: 12, color: '#9CA3AF' }}>Loading engineering…</div>
  }

  const gridW = LABEL_W + viewDays.length * DAY_W
  const modalProject = modal ? projectById.get(modal.projectId) || null : null

  return (
      <div style={{ fontFamily: UI_FONT, background: '#FFF', color: '#111', minHeight: '100vh' }}>
        {/* Header — the /schedule header treatment */}
        <div style={{ padding: '12px 20px 10px', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em', margin: 0 }}>Engineering</h1>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setWeekOffset((w) => w - 1)} style={btnS('#FFF', '#374151')} aria-label="Previous week">‹</button>
              <button onClick={() => setWeekOffset(0)} style={btnS(weekOffset === 0 ? '#111' : '#FFF', weekOffset === 0 ? '#FFF' : '#374151')}>Today</button>
              <button onClick={() => setWeekOffset((w) => w + 1)} style={btnS('#FFF', '#374151')} aria-label="Next week">›</button>
            </div>
            {busy && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Saving…</span>}
          </div>
          <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4, maxWidth: 900 }}>
            A strip is a project’s <b>remaining</b> engineering hours — tracked time eats it automatically. Drag a project onto an engineer to assign it, drag chips on the rail to reorder. Click a strip to divide what’s left, set a firm date, or run the timer.
          </div>
          {(error || data?.planError) && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '6px 10px' }}>
              {data?.planError || error}
            </div>
          )}
        </div>

        {/* Priority rail */}
        <div style={{ padding: '10px 20px 0' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', padding: '6px 8px', border: '1px solid #E5E7EB', borderRadius: 8, minHeight: 38 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 4 }}>Priority</span>
            {rail.length === 0 && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Nothing assigned yet — drag a project from the tray onto an engineer.</span>}
            {rail.map((a, i) => {
              const p = projectById.get(a.project_id)!
              const s = stripByProject.get(a.project_id)
              const c = colorOf(a.project_id)
              const done = !s || s.remaining <= 0.05
              const lane = data!.engineers.find((e) => e.member.id === a.member_id)
              return (
                <div key={a.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', a.project_id); setDragProject(a.project_id) }}
                  onDragEnd={() => { setDragProject(null); setDropChip(null) }}
                  onDragOver={(e) => { if (dragProject && rail.some((r) => r.project_id === dragProject)) { e.preventDefault(); setDropChip(a.project_id) } }}
                  onDragLeave={() => setDropChip((d) => (d === a.project_id ? null : d))}
                  onDrop={(e) => { e.preventDefault(); dropOnChip(a.project_id) }}
                  onClick={() => setModal({ projectId: a.project_id })}
                  title={`${p.name} — ${lane?.member.name || ''}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 999,
                    border: `1.5px solid ${c.border}`, background: dropChip === a.project_id ? c.light : '#FFF',
                    fontSize: 11, fontWeight: 600, color: c.text, cursor: 'grab', userSelect: 'none',
                    boxShadow: s?.atRisk ? '0 0 0 2px #FECACA' : 'none',
                  }}>
                  <span style={{ fontFamily: MONO, fontSize: 9, opacity: 0.65 }}>{i + 1}</span>
                  <span style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                  <span style={{ fontSize: 9, color: '#9CA3AF', fontWeight: 500 }}>{lane?.member.name.split(' ')[0]}</span>
                  {done
                    ? <span style={{ fontSize: 10, color: '#059669' }}>✓ done</span>
                    : s!.atRisk
                      ? <span style={{ fontSize: 10, color: '#DC2626' }}>at risk</span>
                      : <span style={{ fontSize: 10, color: '#059669', fontWeight: 500 }}>by {shortDay(s!.end)}</span>}
                  {a.firm_date && <span style={{ fontSize: 9, color: '#DC2626' }}>📌 {shortDay(a.firm_date)}</span>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Lanes */}
        <div style={{ padding: '12px 20px 0', overflowX: 'auto' }}>
          <div style={{ minWidth: gridW }}>
            {lanes.length === 0 && (
              <div style={{ fontSize: 12, color: '#6B7280', padding: '12px 0' }}>
                No engineers yet — put people in the Engineering department on /team and they get a lane here.
              </div>
            )}
            {lanes.map(({ eng, packed }) => (
              <Lane key={eng.member.id}
                name={eng.member.name}
                dailyHours={eng.dailyHours}
                packed={packed}
                viewDays={viewDays}
                today={today}
                projectById={projectById}
                colorOf={colorOf}
                firmDates={liveAssignments.filter((a) => a.member_id === eng.member.id && a.firm_date).map((a) => ({ projectId: a.project_id, date: a.firm_date! }))}
                entries={(data?.entries || []).filter((e) => userToMember.get(e.user_id) === eng.member.id && e.department_id && data!.engDeptIds.includes(e.department_id))}
                running={runningByMember.get(eng.member.id) || null}
                nowMs={nowMs}
                isDrop={dropLane === eng.member.id}
                onDragOver={() => { if (dragProject) setDropLane(eng.member.id) }}
                onDragLeave={() => setDropLane((d) => (d === eng.member.id ? null : d))}
                onDrop={() => dropOnLane(eng.member.id)}
                onStripDragStart={(pid) => setDragProject(pid)}
                onStripDragEnd={() => { setDragProject(null); setDropLane(null) }}
                onOpen={(pid) => setModal({ projectId: pid })}
              />
            ))}
          </div>
        </div>

        {/* Unassigned tray */}
        <div style={{ padding: '4px 20px 32px' }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '6px 0 6px' }}>
            Unassigned · {tray.length} {tray.length === 1 ? 'project' : 'projects'} with engineering left
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {tray.length === 0 && <span style={{ fontSize: 11, color: '#9CA3AF' }}>Every sold / production project with engineering hours is on a lane.</span>}
            {tray.map((p) => {
              const c = colorOf(p.id)
              const left = remainingHours(p.estHours, trackedMin(p) / 60)
              return (
                <div key={p.id}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setDragProject(p.id) }}
                  onDragEnd={() => { setDragProject(null); setDropLane(null) }}
                  onClick={() => setModal({ projectId: p.id })}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6, height: STRIP_H, padding: '0 8px', borderRadius: 4,
                    background: `${c.bg}20`, border: `1.5px solid ${c.bg}50`, cursor: 'grab', userSelect: 'none',
                  }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: c.text }}>{p.name}</span>
                  {p.isTemp && <span style={{ fontSize: 8, fontWeight: 700, color: '#92400E', background: '#FEF3C7', borderRadius: 3, padding: '1px 4px' }}>TEMP</span>}
                  <span style={{ fontSize: 9, fontWeight: 600, color: `${c.text}90`, fontFamily: MONO }}>{fmtH(left)}h left</span>
                </div>
              )
            })}
          </div>
        </div>

        {modal && modalProject && data && (
          <StripModal
            key={`${modal.projectId}:${assignmentByProject.get(modal.projectId)?.member_id || ''}`}
            project={modalProject}
            assignment={assignmentByProject.get(modal.projectId) || null}
            strip={stripByProject.get(modal.projectId) || null}
            lane={lanes.find((l) => l.packed.memberId === assignmentByProject.get(modal.projectId)?.member_id)?.packed || null}
            engineers={data.engineers}
            trackedHours={trackedMin(modalProject) / 60}
            subs={data.subsByProject[modal.projectId] || []}
            running={runningByMember}
            projectById={projectById}
            engDeptId={data.engDeptIds[0] || null}
            today={today}
            horizon={horizon}
            onClose={() => setModal(null)}
            onAssign={(memberId) => run(async () => {
              const a = assignmentByProject.get(modal.projectId)
              if (a) await api.update(a.id, { member_id: memberId })
              else await api.assign(modal.projectId, memberId, nextPriority())
            })}
            onSave={(patch) => run(async () => {
              const a = assignmentByProject.get(modal.projectId)
              if (a) await api.update(a.id, patch)
              setModal(null)
            })}
            onUnassign={() => run(async () => {
              const a = assignmentByProject.get(modal.projectId)
              if (a) await api.unassign(a.id)
              setModal(null)
            })}
            onTimer={(action, memberUserId, subId) => run(async () => {
              if (action === 'stop') {
                const active = [...runningByMember.values()].find((e) => e.user_id === memberUserId)
                if (active) await api.stopTimer(active)
              } else {
                await api.startTimer(memberUserId, modal.projectId, subId, data.engDeptIds[0] || null)
              }
            })}
            canTime={api.canTime}
          />
        )}
      </div>
  )
}

// =====================================================
// LANE — own day header, strip canvas, tracked band
// =====================================================
function Lane({
  name, dailyHours, packed, viewDays, today, projectById, colorOf, firmDates, entries, running, nowMs,
  isDrop, onDragOver, onDragLeave, onDrop, onStripDragStart, onStripDragEnd, onOpen,
}: {
  name: string
  dailyHours: number
  packed: PackedLane
  viewDays: string[]
  today: string
  projectById: Map<string, BoardProject>
  colorOf: (id: string) => PaletteColor
  firmDates: Array<{ projectId: string; date: string }>
  entries: BoardEntry[]
  running: BoardEntry | null
  nowMs: number
  isDrop: boolean
  onDragOver: () => void
  onDragLeave: () => void
  onDrop: () => void
  onStripDragStart: (pid: string) => void
  onStripDragEnd: () => void
  onOpen: (pid: string) => void
}) {
  const idx = new Map(viewDays.map((d, i) => [d, i]))
  const first = viewDays[0]
  const last = viewDays[viewDays.length - 1]
  const visible = packed.strips.filter((s) => s.start && s.end && s.end >= first && s.start <= last)
  const canvasH = Math.max(1, visible.length) * (STRIP_H + STRIP_GAP) + 12

  // Tracked: per day, chronological.
  const byDay: Record<string, BoardEntry[]> = {}
  for (const e of entries) (byDay[entryDay(e)] ||= []).push(e)
  for (const k of Object.keys(byDay)) byDay[k].sort((a, b) => (a.started_at || a.created_at).localeCompare(b.started_at || b.created_at))

  const runningProject = running ? projectById.get(running.project_id) : null
  /** column index of a date, clamped into the view (for strips that run off it) */
  const col = (k: string, edge: 'start' | 'end'): number => {
    if (idx.has(k)) return idx.get(k)!
    if (k < first) return 0
    if (k > last) return viewDays.length - 1
    // a weekend/holiday key inside the view: snap to the neighbouring workday
    const n = viewDays.findIndex((d) => d > k)
    return edge === 'start' ? n : n - 1
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver() }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop() }}
      style={{ border: `1px solid ${isDrop ? '#93C5FD' : '#E5E7EB'}`, borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: isDrop ? '#F8FAFF' : '#FFF' }}>
      {/* Day header — this lane's own load per day */}
      <div style={{ display: 'flex' }}>
        <div style={{
          width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', borderBottom: '1px solid #E5E7EB',
          padding: '6px 10px', background: '#FAFBFC', position: 'sticky', left: 0, zIndex: 5,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{name}</div>
          <div style={{ fontSize: 9, color: '#9CA3AF', fontFamily: MONO, marginTop: 1 }}>{fmtH(dailyHours)}h/day · {fmtH(packed.queued)}h queued</div>
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
              <span className="eng-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: '#059669' }} />
              <span style={{ fontSize: 9, color: '#047857', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>on {runningProject?.name || 'other work'}</span>
            </div>
          )}
        </div>
        {viewDays.map((d, i) => {
          const L = packed.load[d]
          const tracked = (L?.tracked) ?? sumDay(byDay[d], nowMs)
          const planned = L?.planned || 0
          const cap = L ? L.cap : (d < today ? dailyHours : 0)
          const loadH = d < today ? tracked : planned + (d === today ? tracked : 0)
          const over = loadH > cap + 0.05
          const full = !over && cap > 0 && loadH >= cap - 0.05
          const off = cap <= 0.01 && d >= today
          const { wd, md } = dayLabel(d)
          return (
            <div key={d} style={{
              width: DAY_W, minWidth: DAY_W, flexShrink: 0, borderBottom: '1px solid #E5E7EB', borderRight: '1px solid #F3F4F6',
              padding: '5px 0', textAlign: 'center', background: over ? '#FEF2F2' : i % 2 === 0 ? '#FFF' : '#FAFBFC',
            }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: d === today ? '#1E40AF' : '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{d === today ? 'Today' : wd}</div>
              <div style={{ fontSize: 11, fontWeight: 500, color: d < today ? '#9CA3AF' : '#6B7280', marginTop: 1 }}>{md}</div>
              <div style={{ fontSize: 9, fontFamily: MONO, marginTop: 2, fontWeight: over || full ? 700 : 500, color: over ? '#DC2626' : full ? '#B45309' : '#9CA3AF' }}>
                {off ? 'off' : `${fmtH(loadH)}/${fmtH(cap)}`}
              </div>
            </div>
          )
        })}
      </div>

      {/* Strip canvas */}
      <div style={{ display: 'flex' }}>
        <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: '#FAFBFC', position: 'sticky', left: 0, zIndex: 5 }} />
        <div style={{ position: 'relative', width: viewDays.length * DAY_W, height: canvasH }}>
          {viewDays.map((d, i) => (
            <div key={d} style={{ position: 'absolute', top: 0, bottom: 0, left: i * DAY_W, width: DAY_W, borderRight: '1px solid #F3F4F6', background: i % 2 === 0 ? '#FFF' : '#FAFBFC' }} />
          ))}
          {visible.length === 0 && (
            <div style={{ position: 'absolute', left: 10, top: 10, fontSize: 11, color: '#C4C4C4' }}>
              {packed.strips.length ? 'Nothing planned in these days' : 'Drop a project here'}
            </div>
          )}
          {firmDates.map((f) => {
            if (f.date < first || f.date > last) return null
            const c = idx.has(f.date) ? idx.get(f.date)! : col(f.date, 'end')
            return (
              <div key={f.projectId} style={{ position: 'absolute', top: 0, bottom: 0, left: (c + 1) * DAY_W - 2, width: 2, background: '#DC2626', zIndex: 3 }}>
                <span style={{ position: 'absolute', top: 1, right: 4, fontSize: 8, fontWeight: 700, color: '#DC2626', whiteSpace: 'nowrap', background: '#FFFFFFD0', padding: '0 2px' }}>
                  FIRM · {projectById.get(f.projectId)?.name.split(' ')[0]}
                </span>
              </div>
            )
          })}
          {visible.map((s, row) => {
            const p = projectById.get(s.projectId)
            const c = colorOf(s.projectId)
            const a = col(s.start!, 'start')
            const b = col(s.end!, 'end')
            const tracked = Math.max(0, (p?.estHours || 0) - s.remaining)
            const daysTip = Object.entries(s.days).sort(([x], [y]) => x.localeCompare(y)).map(([d, h]) => `${shortDay(d)}: ${fmtH(h)}h`).join('\n')
            const isLive = running?.project_id === s.projectId
            return (
              <div key={s.projectId}
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', s.projectId); onStripDragStart(s.projectId) }}
                onDragEnd={onStripDragEnd}
                onClick={() => onOpen(s.projectId)}
                title={`${p?.name}\n${daysTip}${s.overflow > 0 ? `\n${fmtH(s.overflow)}h past the horizon` : ''}`}
                style={{
                  position: 'absolute', top: 6 + row * (STRIP_H + STRIP_GAP), left: a * DAY_W + 2, width: (b - a + 1) * DAY_W - 4, height: STRIP_H,
                  borderRadius: 4, background: `${c.bg}20`, border: `1.5px solid ${c.bg}50`,
                  boxShadow: s.atRisk ? '0 0 0 2px #FECACA' : 'none',
                  display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', cursor: 'pointer', overflow: 'hidden', zIndex: 2,
                }}>
                {isLive && <span className="eng-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: '#059669', flexShrink: 0 }} />}
                {/* The name keeps its room; the hours line gives way first. */}
                <span style={{ fontSize: 10, fontWeight: 700, color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 30, flexShrink: 1 }}>{p?.name}</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: `${c.text}90`, fontFamily: MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flexShrink: 100 }}>
                  {fmtH(s.remaining)}h left of {fmtH(p?.estHours || 0)}{tracked > 0.05 ? ` · ${fmtH(tracked)}h in` : ''}{s.divided ? ' · divided' : ''}
                </span>
                {s.atRisk && <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, color: '#DC2626', flexShrink: 0 }}>at risk</span>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Tracked band — what actually happened, in order, scaled to duration */}
      <div style={{ display: 'flex', borderTop: '1px dashed #E5E7EB' }}>
        <div style={{ width: LABEL_W, minWidth: LABEL_W, flexShrink: 0, borderRight: '1px solid #E5E7EB', background: '#FAFBFC', position: 'sticky', left: 0, zIndex: 5, padding: '5px 10px', fontSize: 8, fontWeight: 700, color: '#C4C0B8', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Tracked
        </div>
        {viewDays.map((d, i) => {
          const list = byDay[d] || []
          const total = sumDay(list, nowMs)
          const denom = Math.max(dailyHours, total) || 1
          return (
            <div key={d} style={{ width: DAY_W, minWidth: DAY_W, flexShrink: 0, borderRight: '1px solid #F3F4F6', padding: '5px 3px', display: 'flex', gap: 1, alignItems: 'center', minHeight: 22, background: i % 2 === 0 ? '#FFF' : '#FAFBFC' }}>
              {list.map((e) => {
                const h = entryMinutes(e, nowMs) / 60
                const c = colorOf(e.project_id)
                const live = !e.ended_at
                return (
                  <span key={e.id}
                    className={live ? 'eng-pulse' : undefined}
                    title={`${projectById.get(e.project_id)?.name || 'Other project'} · ${fmtH(h)}h${live ? ' · timer running' : ''}`}
                    style={{
                      height: 10, borderRadius: 3, background: c.border, flexShrink: 0,
                      width: `${Math.max(3, (h / denom) * 100)}%`,
                      outline: live ? '2px solid #2563EB' : 'none', outlineOffset: 1,
                    }} />
                )
              })}
            </div>
          )
        })}
      </div>
      <style>{`@keyframes engPulse { 50% { opacity: .55 } } .eng-pulse { animation: engPulse 1.6s infinite }`}</style>
    </div>
  )
}

function sumDay(list: BoardEntry[] | undefined, nowMs: number): number {
  return (list || []).reduce((s, e) => s + entryMinutes(e, nowMs) / 60, 0)
}

// =====================================================
// STRIP MODAL — timer, divide, firm date, assign
// =====================================================
function StripModal({
  project, assignment, strip, lane, engineers, trackedHours, subs, running, projectById, engDeptId, today, horizon,
  onClose, onAssign, onSave, onUnassign, onTimer, canTime,
}: {
  project: BoardProject
  assignment: EngAssignment | null
  strip: PackedStrip | null
  lane: PackedLane | null
  engineers: BoardData['engineers']
  trackedHours: number
  subs: Array<{ id: string; name: string }>
  running: Map<string, BoardEntry>
  projectById: Map<string, BoardProject>
  engDeptId: string | null
  today: string
  horizon: string[]
  onClose: () => void
  onAssign: (memberId: string) => void
  onSave: (patch: Partial<Pick<EngAssignment, 'divisions' | 'firm_date'>>) => void
  onUnassign: () => void
  onTimer: (action: 'start' | 'stop', userId: string, subId: string | null) => void
  canTime: boolean
}) {
  const remaining = remainingHours(project.estHours, trackedHours)
  const eng = assignment ? engineers.find((e) => e.member.id === assignment.member_id) || null : null

  const initialRows = useMemo<Division[]>(() => {
    const days = strip ? Object.entries(strip.days).filter(([, h]) => h > 0.001).sort(([a], [b]) => a.localeCompare(b)) : []
    // One decimal, not half-hours: the rows must foot to what's left, or the
    // modal shows a phantom "0.1h over" on an untouched plan.
    return days.map(([date, hours]) => ({ date, hours: Math.round(hours * 10) / 10 }))
  }, [strip])
  const [rows, setRows] = useState<Array<{ date: string; hours: string }>>(() => initialRows.map((r) => ({ date: r.date, hours: String(r.hours) })))
  const [dirty, setDirty] = useState(false)
  const [firmOn, setFirmOn] = useState(!!assignment?.firm_date)
  const [firmDate, setFirmDate] = useState(assignment?.firm_date || strip?.end || today)
  const [subId, setSubId] = useState<string>('')

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])

  const parsed: Division[] = rows.map((r) => ({ date: r.date, hours: Number(r.hours) || 0 }))
  const sum = parsed.reduce((s, r) => s + r.hours, 0)
  const matches = divisionsMatch(parsed, remaining)
  const dupDates = new Set(parsed.map((r) => r.date)).size !== parsed.length

  /** Open hours on a day for OTHER work: cap − other strips − (today) tracked. */
  const openOn = (d: string): number | null => {
    if (!lane) return null
    const L = lane.load[d]
    if (!L) return null
    const mine = strip?.days[d] || 0
    const others = L.planned - mine
    const rowH = parsed.filter((r) => r.date === d).reduce((s, r) => s + r.hours, 0)
    return L.cap - others - rowH - (d === today ? L.tracked : 0)
  }

  function patchRow(i: number, patch: Partial<{ date: string; hours: string }>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  function addDay() {
    const lastDate = rows.length ? rows[rows.length - 1].date : null
    const next = lastDate ? workdaysFrom(lastDate, 2)[1] : horizon[0]
    setRows((rs) => [...rs, { date: next, hours: '0' }])
    setDirty(true)
  }
  function evenSplit() {
    const dates = rows.length ? rows.map((r) => r.date) : [horizon[0]]
    setRows(evenDivide(remaining, dates).map((r) => ({ date: r.date, hours: String(r.hours) })))
    setDirty(true)
  }

  const memberUserId = eng?.member.user_id || null
  const active = eng ? running.get(eng.member.id) || null : null
  const activeHere = active && active.project_id === project.id && (!active.department_id || active.department_id === engDeptId)

  const canSave = !dirty || (matches && !dupDates && parsed.every((r) => r.date >= today))
  function save() {
    const patch: Partial<Pick<EngAssignment, 'divisions' | 'firm_date'>> = { firm_date: firmOn ? firmDate : null }
    if (dirty) patch.divisions = parsed.filter((r) => r.hours > 0).sort((a, b) => a.date.localeCompare(b.date))
    onSave(patch)
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(17,17,17,0.25)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 70 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 100px)', overflowY: 'auto', background: '#FFF', borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,0.18)', border: '1px solid #E5E7EB' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #F3F4F6' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>{project.name}{eng ? ` — ${eng.member.name}` : ''}</div>
            <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2, fontFamily: MONO }}>
              {fmtH(project.estHours)}h estimated · {fmtH(trackedHours)}h tracked · <b style={{ color: '#111' }}>{fmtH(remaining)}h left</b>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF', padding: 4, borderRadius: 4 }}>
            <X width={16} height={16} />
          </button>
        </div>

        <div style={{ padding: 18 }}>
          {/* Engineer */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#374151', marginBottom: 12 }}>
            Engineer
            <select value={assignment?.member_id || ''} onChange={(e) => e.target.value && onAssign(e.target.value)}
              style={{ fontSize: 12, padding: '4px 6px', border: '1px solid #E5E7EB', borderRadius: 4, background: '#FFF', flex: 1 }}>
              {!assignment && <option value="">Unassigned — pick an engineer</option>}
              {engineers.map((e) => <option key={e.member.id} value={e.member.id}>{e.member.name}</option>)}
            </select>
          </label>

          {/* Timer — the same clock as /me */}
          {eng && canTime && (
            memberUserId ? (
              activeHere ? (
                <RunningTimer entry={active!} who={eng.member.name} name={project.name} onStop={() => onTimer('stop', memberUserId, null)} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 8, marginBottom: 14, background: '#F9FAFB' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#374151' }}>
                      {active
                        ? <>{eng.member.name} is on <b>{projectById.get(active.project_id)?.name || 'other work'}</b> — starting here stops that.</>
                        : <>Track {eng.member.name}’s engineering time on this job.</>}
                    </div>
                    {subs.length > 0 && (
                      <select value={subId} onChange={(e) => setSubId(e.target.value)} style={{ marginTop: 4, fontSize: 11, padding: '2px 4px', border: '1px solid #E5E7EB', borderRadius: 4, maxWidth: '100%' }}>
                        <option value="">Whole project (no subproject)</option>
                        {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    )}
                  </div>
                  <button onClick={() => onTimer('start', memberUserId, subId || null)} style={{ ...btnS('#059669', '#FFF'), border: '1px solid #059669', fontWeight: 600 }}>Start</button>
                </div>
              )
            ) : (
              <div style={{ fontSize: 11, color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 6, padding: '6px 9px', marginBottom: 14 }}>
                {eng.member.name} has no login, so the timer can’t run for them — link one on /team.
              </div>
            )
          )}

          {assignment && remaining > 0.05 && (
            <>
              <div style={{ fontSize: 9, fontWeight: 600, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Divide what’s left {strip?.divided && !dirty ? '· divided by hand' : !dirty ? '· auto-packed' : ''}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((r, i) => {
                  const open = openOn(r.date)
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 18px', alignItems: 'center', gap: 8 }}>
                      <input type="date" value={r.date} min={today} onChange={(e) => patchRow(i, { date: e.target.value })}
                        style={{ fontSize: 12, padding: '4px 6px', border: '1px solid #E5E7EB', borderRadius: 4 }} />
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="number" min={0} step={0.5} value={r.hours} onChange={(e) => patchRow(i, { hours: e.target.value })}
                          style={{ width: 58, fontSize: 12, padding: '4px 6px', border: '1px solid #E5E7EB', borderRadius: 4, textAlign: 'right', fontFamily: MONO }} />
                        <span style={{ fontSize: 11, color: '#9CA3AF' }}>h</span>
                      </div>
                      <span style={{ fontSize: 10.5, color: open != null && open < -0.05 ? '#DC2626' : '#9CA3AF' }}>
                        {open == null ? '' : open < -0.05 ? `${fmtH(-open)}h over` : `${fmtH(Math.max(0, open))}h open`}
                      </span>
                      <button onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); setDirty(true) }} aria-label="Remove day"
                        style={{ border: 'none', background: 'none', color: '#9CA3AF', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button onClick={addDay} style={{ border: 'none', background: 'none', padding: 0, fontSize: 11, color: '#2563EB', cursor: 'pointer' }}>+ Add day</button>
                <button onClick={evenSplit} style={{ border: 'none', background: 'none', padding: 0, fontSize: 11, color: '#2563EB', cursor: 'pointer' }}>Even split</button>
                {(strip?.divided || dirty) && (
                  <button onClick={() => onSave({ divisions: null, firm_date: firmOn ? firmDate : null })} style={{ border: 'none', background: 'none', padding: 0, fontSize: 11, color: '#6B7280', cursor: 'pointer', marginLeft: 'auto' }}>
                    Back to auto-pack
                  </button>
                )}
              </div>
              {dirty && (
                <div style={{ marginTop: 10, padding: '6px 10px', borderRadius: 6, background: matches && !dupDates ? '#ECFDF5' : '#FEF2F2', border: `1px solid ${matches && !dupDates ? '#A7F3D0' : '#FECACA'}`, fontSize: 12, fontFamily: MONO, color: matches && !dupDates ? '#065F46' : '#991B1B', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{parsed.map((r) => fmtH(r.hours)).join(' + ') || '0'} = {fmtH(sum)}h</span>
                  <span>{dupDates ? 'one row per day' : matches ? '✓' : `needs ${fmtH(remaining)}h`}</span>
                </div>
              )}
            </>
          )}

          {assignment && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, fontSize: 12, color: '#374151' }}>
              <button onClick={() => setFirmOn((f) => !f)} role="switch" aria-checked={firmOn}
                style={{ width: 34, height: 20, borderRadius: 999, border: 'none', background: firmOn ? '#DC2626' : '#E5E7EB', position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
                <span style={{ position: 'absolute', top: 2, left: firmOn ? 16 : 2, width: 16, height: 16, borderRadius: 999, background: '#FFF', transition: 'left 0.15s' }} />
              </button>
              Firm deadline
              {firmOn && (
                <input type="date" value={firmDate} onChange={(e) => setFirmDate(e.target.value)}
                  style={{ fontSize: 12, padding: '4px 6px', border: '1px solid #E5E7EB', borderRadius: 4 }} />
              )}
              {firmOn && strip?.end && strip.end > firmDate && <span style={{ fontSize: 11, color: '#DC2626', fontWeight: 600 }}>at risk — packs to {shortDay(strip.end)}</span>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center' }}>
            {assignment && (
              <button disabled={!canSave} onClick={save}
                style={{ ...btnS(canSave ? '#111' : '#E5E7EB', canSave ? '#FFF' : '#9CA3AF'), border: 'none', fontWeight: 600, cursor: canSave ? 'pointer' : 'not-allowed' }}>
                Save
              </button>
            )}
            <button onClick={onClose} style={btnS('#FFF', '#374151')}>{assignment ? 'Cancel' : 'Close'}</button>
            {assignment && (
              <button onClick={onUnassign} style={{ marginLeft: 'auto', border: 'none', background: 'none', fontSize: 11, color: '#DC2626', cursor: 'pointer' }}>
                Unassign
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function RunningTimer({ entry, who, name, onStop }: { entry: BoardEntry; who: string; name: string; onStop: () => void }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const started = entry.started_at ? new Date(entry.started_at) : new Date(now)
  const secs = Math.max(0, Math.floor((now - started.getTime()) / 1000))
  const hh = Math.floor(secs / 3600)
  const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 12px', marginBottom: 14 }}>
      <span className="eng-pulse" style={{ width: 10, height: 10, borderRadius: 999, background: '#059669', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: '#065F46' }}>{hh}:{mm}:{ss}</div>
        <div style={{ fontSize: 10.5, color: '#047857' }}>
          Tracking {name} · started {started.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · {who}
        </div>
      </div>
      <button onClick={onStop} style={{ fontSize: 12, fontWeight: 700, background: '#111', color: '#FFF', border: 'none', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>Stop</button>
      <style>{`@keyframes engPulse { 50% { opacity: .55 } } .eng-pulse { animation: engPulse 1.6s infinite }`}</style>
    </div>
  )
}
