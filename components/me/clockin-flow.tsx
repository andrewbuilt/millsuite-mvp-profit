'use client'

// ============================================================================
// components/me/clockin-flow.tsx — the /me clock-in redesign (Andrew's
// sketches, 2026-09-15): project select → subproject cards → timer modal.
// ============================================================================
// Three screens, all living inside the Today tab so the /me shell (header
// week bar + bottom tab nav) never changes around them:
//
//   1. ProjectSelectScreen — ONE list, project NAMES ONLY, big tap targets.
//   2. SubCardsScreen — the project's subprojects as large scrollable cards,
//      each with per-department used/total hour bars, red when over.
//   3. TimerSheet — the timer as a modal on an OPAQUE background (Andrew's
//      explicit callout: opaque, not translucent). The bottom tab bar stays
//      visible above it (footer z-40 > sheet z-30).
//
// Clock-ins through this flow TAG THE SUBPROJECT — the production fill bar
// and est-vs-actual read subproject_id, and untagged time was their blind
// spot (45dec92). "Other work" stays reachable as the no-subproject card at
// the bottom of screen 2.
//
// The three screens are PURE views over props, exported individually, for the
// same reason tabs.tsx exists at all: /me is the phone app, layout has to be
// LOOKED AT at 375px and 320px, and only a component with no data access can
// be mounted against fixtures (see app/dev/me-clockin). ClockInFlow at the
// bottom is the only stateful piece.
// ============================================================================

import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Play, Square, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadSubClockCards, type SubClockCard } from '@/lib/worker-clockin'
import { LABOR_DEPTS, LABOR_DEPT_LABEL, type LaborDept } from '@/lib/rate-book-seed'
import { fmtActualHours } from '@/lib/actual-hours'
import type { TimeEntry } from '@/lib/worker-time'

// ── Formatting ──────────────────────────────────────────────────────────────

/** Estimated hours are judgements, so they stay decimal ("87h", "12.5h") —
 *  the deliberate visual contrast with measured "2h 34m" (see fmtActualHours). */
function fmtEstHours(hours: number): string {
  const h = Math.round(hours * 10) / 10
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

function elapsedLabel(startedAt: string | null, now: number): string {
  const start = startedAt ? new Date(startedAt).getTime() : now
  const totalSec = Math.max(0, Math.floor((now - start) / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// ── Screen 1: project select ────────────────────────────────────────────────

export function ProjectSelectScreen({
  projects,
  activeLabel,
  onPick,
  onOpenTimer,
}: {
  projects: Array<{ id: string; name: string }>
  /** "Project · Sub" for the running entry, or null when clocked out. */
  activeLabel: string | null
  onPick: (p: { id: string; name: string }) => void
  onOpenTimer: () => void
}) {
  return (
    <div className="space-y-4">
      {activeLabel ? (
        <button
          onClick={onOpenTimer}
          className="w-full rounded-2xl bg-[#111] text-white p-4 text-left flex items-center justify-between"
        >
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-white/50">Clocked in</div>
            <div className="text-sm font-semibold truncate">{activeLabel}</div>
          </div>
          <span className="flex-shrink-0 ml-3 inline-flex items-center gap-1 text-xs font-semibold text-[#34D399]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34D399] animate-pulse" />
            Open timer
          </span>
        </button>
      ) : (
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] p-4 text-center text-sm text-[#6B7280]">
          Not clocked in. Pick a project to start.
        </div>
      )}

      <div>
        <div className="text-xs font-semibold text-[#6B7280] uppercase tracking-wide mb-2">
          Clock in on
        </div>
        {projects.length === 0 ? (
          <div className="text-xs text-[#9CA3AF] py-1">No active projects right now.</div>
        ) : (
          <div className="space-y-2">
            {/* Project NAMES ONLY — no client, no meta. Big targets ("larger
                so it's easy to select"): py-4 ≈ 56px tall rows. */}
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p)}
                className="w-full flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-white px-4 py-4 text-left hover:border-[#D1D5DB] active:bg-[#F9FAFB]"
              >
                <span className="text-base font-medium text-[#111] truncate">{p.name}</span>
                <ChevronRight className="w-5 h-5 flex-shrink-0 ml-2 text-[#9CA3AF]" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Screen 2: subproject cards ──────────────────────────────────────────────

function DeptBar({ dept, estHours, actualMinutes }: { dept: LaborDept; estHours: number; actualMinutes: number }) {
  const estMinutes = Math.round(estHours * 60)
  const over = actualMinutes > estMinutes
  const pct = estMinutes > 0 ? Math.min(100, (actualMinutes / estMinutes) * 100) : actualMinutes > 0 ? 100 : 0
  return (
    <div className="flex items-center gap-2">
      <span className="w-[64px] flex-shrink-0 text-[10.5px] font-medium text-[#6B7280] truncate">
        {LABOR_DEPT_LABEL[dept]}
      </span>
      <div className="flex-1 min-w-0 h-2 rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${pct}%`, background: over ? '#DC2626' : '#2563EB' }}
        />
      </div>
      {/* "87/100": measured on the left of the slash, estimated on the right —
          the two formats differing (2h 34m vs 87h) is deliberate. */}
      <span
        className={`w-[92px] flex-shrink-0 text-right font-mono tabular-nums text-[10.5px] ${
          over ? 'text-[#DC2626] font-semibold' : 'text-[#6B7280]'
        }`}
      >
        {fmtActualHours(actualMinutes)} / {fmtEstHours(estHours)}
      </span>
    </div>
  )
}

export function SubCardsScreen({
  projectName,
  cards,
  loading,
  onBack,
  onPickSub,
  onOtherWork,
}: {
  projectName: string
  cards: SubClockCard[]
  loading: boolean
  onBack: () => void
  onPickSub: (c: SubClockCard) => void
  onOtherWork: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <button
          onClick={onBack}
          aria-label="Back to projects"
          className="min-h-[44px] min-w-[44px] -ml-3 inline-flex items-center justify-center text-[#6B7280]"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="text-base font-semibold text-[#111] truncate">{projectName}</div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center text-sm text-[#9CA3AF]">
          Loading…
        </div>
      ) : (
        <>
          {cards.map((c) => {
            const rows = LABOR_DEPTS.filter(
              (d) => c.estHoursByDept[d] > 0 || c.actualMinutesByDept[d] > 0,
            )
            return (
              <button
                key={c.subprojectId}
                onClick={() => onPickSub(c)}
                className="w-full rounded-2xl border border-[#E5E7EB] bg-white p-4 text-left hover:border-[#D1D5DB] active:bg-[#F9FAFB]"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[15px] font-semibold text-[#111] truncate">{c.name}</span>
                  <span className="flex-shrink-0 ml-2 inline-flex items-center gap-1 text-xs font-semibold text-[#2563EB]">
                    <Play className="w-3.5 h-3.5" /> Start
                  </span>
                </div>
                {rows.length === 0 ? (
                  <div className="text-[11px] text-[#9CA3AF]">No hours estimated yet</div>
                ) : (
                  <div className="space-y-1.5">
                    {rows.map((d) => (
                      <DeptBar
                        key={d}
                        dept={d}
                        estHours={c.estHoursByDept[d]}
                        actualMinutes={c.actualMinutesByDept[d]}
                      />
                    ))}
                  </div>
                )}
                {c.unmappedActualMinutes > 0 && (
                  <div className="mt-1.5 text-[10.5px] text-[#9CA3AF]">
                    + {fmtActualHours(c.unmappedActualMinutes)} in other departments
                  </div>
                )}
              </button>
            )
          })}
          {cards.length === 0 && (
            <div className="rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center text-sm text-[#9CA3AF]">
              No subprojects on this job yet.
            </div>
          )}

          {/* Non-subproject time stays reachable — shop-floor hours that belong
              to no sub must not get stranded (or worse, mis-tagged). */}
          <button
            onClick={onOtherWork}
            className="w-full rounded-2xl border border-dashed border-[#D1D5DB] bg-[#F9FAFB] p-4 text-left"
          >
            <div className="text-[15px] font-semibold text-[#374151]">Other work</div>
            <div className="text-[11px] text-[#9CA3AF] mt-0.5">
              Time on this project that isn&apos;t one subproject
            </div>
          </button>
        </>
      )}
    </div>
  )
}

// ── Screen 3: the timer, as a modal on an OPAQUE background ─────────────────

export function TimerSheet({
  projectName,
  subName,
  running,
  timerLabel,
  busy,
  onStart,
  onStop,
  onClose,
}: {
  projectName: string
  subName: string | null
  running: boolean
  timerLabel: string
  busy: boolean
  onStart: () => void
  onStop: () => void
  onClose: () => void
}) {
  return (
    // z-30 keeps the bottom tab bar (z-40) visible and tappable above the
    // sheet — "same footer everywhere". bg is SOLID per the sketch callout.
    <div className="fixed inset-0 z-30 bg-[#F9FAFB] flex flex-col">
      <div className="max-w-md w-full mx-auto flex-1 flex flex-col px-4 pt-4 pb-28">
        <div className="flex justify-end">
          <button
            onClick={onClose}
            aria-label="Close timer"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[#6B7280]"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center">
          <div className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
            {running ? 'Clocked in' : 'Ready to start'}
          </div>
          <div className="mt-2 text-xl font-semibold text-[#111] leading-snug">{projectName}</div>
          <div className="mt-1 text-sm text-[#6B7280]">{subName || 'Other work'}</div>

          <div className="mt-8 text-6xl font-mono tabular-nums text-[#111] tracking-tight">
            {timerLabel}
          </div>

          <div className="mt-10 w-full">
            {running ? (
              <button
                disabled={busy}
                onClick={onStop}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#111] text-white text-base font-semibold py-4 disabled:opacity-60"
              >
                <Square className="w-5 h-5" /> Clock out
              </button>
            ) : (
              <button
                disabled={busy}
                onClick={onStart}
                className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-white text-base font-semibold py-4 disabled:opacity-60"
              >
                <Play className="w-5 h-5" /> Clock in
              </button>
            )}
          </div>
          {running && (
            <div className="mt-3 text-[11px] text-[#9CA3AF]">
              Closing this keeps the clock running.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── The stateful flow ───────────────────────────────────────────────────────

export function ClockInFlow({
  orgId,
  projects,
  active,
  now,
  myDeptIds,
  onClockIn,
  onClockOut,
}: {
  orgId: string
  projects: Array<{ id: string; name: string }>
  active: TimeEntry | null
  now: number
  /** The worker's dept assignments — a single dept tags the entry, several
   *  tag nothing (a wrong guess is worse than an untagged one). */
  myDeptIds: string[]
  onClockIn: (projectId: string, subprojectId: string | null, departmentId: string | null) => Promise<void>
  onClockOut: () => Promise<void>
}) {
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null)
  const [cards, setCards] = useState<SubClockCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(false)
  const [timer, setTimer] = useState<{
    projectId: string
    projectName: string
    subprojectId: string | null
    subName: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)
  // Names for entries whose sub we didn't pick this session (e.g. a running
  // entry started before the page loaded).
  const [subNames, setSubNames] = useState<Record<string, string>>({})

  const projName = (id: string | null) => projects.find((p) => p.id === id)?.name || 'Job'

  useEffect(() => {
    if (!picked) return
    let cancelled = false
    setCardsLoading(true)
    ;(async () => {
      const data = await loadSubClockCards(orgId, picked.id)
      if (cancelled) return
      setCards(data)
      setSubNames((prev) => ({
        ...prev,
        ...Object.fromEntries(data.map((c) => [c.subprojectId, c.name])),
      }))
      setCardsLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [picked, orgId])

  // Resolve the running entry's sub name for the banner/timer if we don't
  // already know it.
  const activeSubId = active?.subproject_id ?? null
  useEffect(() => {
    if (!activeSubId || subNames[activeSubId]) return
    let cancelled = false
    ;(async () => {
      const { data } = await supabase.from('subprojects').select('name').eq('id', activeSubId).maybeSingle()
      if (!cancelled && data?.name) setSubNames((prev) => ({ ...prev, [activeSubId]: data.name }))
    })()
    return () => {
      cancelled = true
    }
  }, [activeSubId, subNames])

  const timerMatchesActive =
    !!active &&
    !!timer &&
    active.project_id === timer.projectId &&
    (active.subproject_id ?? null) === (timer.subprojectId ?? null)

  async function start() {
    if (!timer) return
    setBusy(true)
    try {
      // Tag the dept only when it's unambiguous — one assigned department.
      const departmentId = myDeptIds.length === 1 ? myDeptIds[0] : null
      await onClockIn(timer.projectId, timer.subprojectId, timer.subprojectId ? departmentId : null)
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    setBusy(true)
    try {
      await onClockOut()
      setTimer(null)
      setPicked(null)
    } finally {
      setBusy(false)
    }
  }

  const activeLabel = active
    ? `${projName(active.project_id)}${
        active.subproject_id ? ` · ${subNames[active.subproject_id] || 'Subproject'}` : ''
      }`
    : null

  return (
    <>
      {picked ? (
        <SubCardsScreen
          projectName={picked.name}
          cards={cards}
          loading={cardsLoading}
          onBack={() => setPicked(null)}
          onPickSub={(c) =>
            setTimer({
              projectId: picked.id,
              projectName: picked.name,
              subprojectId: c.subprojectId,
              subName: c.name,
            })
          }
          onOtherWork={() =>
            setTimer({ projectId: picked.id, projectName: picked.name, subprojectId: null, subName: null })
          }
        />
      ) : (
        <ProjectSelectScreen
          projects={projects}
          activeLabel={activeLabel}
          onPick={setPicked}
          onOpenTimer={() => {
            if (!active) return
            setTimer({
              projectId: active.project_id,
              projectName: projName(active.project_id),
              subprojectId: active.subproject_id ?? null,
              subName: active.subproject_id ? subNames[active.subproject_id] || 'Subproject' : null,
            })
          }}
        />
      )}

      {timer && (
        <TimerSheet
          projectName={timer.projectName}
          subName={timer.subName}
          running={timerMatchesActive}
          timerLabel={timerMatchesActive ? elapsedLabel(active!.started_at, now) : '00:00:00'}
          busy={busy}
          onStart={start}
          onStop={stop}
          onClose={() => setTimer(null)}
        />
      )}
    </>
  )
}
