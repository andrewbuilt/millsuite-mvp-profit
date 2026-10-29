'use client'

// ============================================================================
// /projects — post-sold projects KANBAN (2026-10-29, Andrew)
// ============================================================================
// One board language across the site: same column + card shells as the sales
// kanban (components/kanban), header count + $ sum per column. The old card
// grid, the VALUE / EST HOURS / TRACKED HOURS boxes and the filter buttons are
// gone — the columns replace them. Search stays.
//
// Columns (derived — no new stage):
//   Brand-new sale = sold within 7 days AND no approval activity yet
//   Pre-production = sold otherwise (a READY job keeps its green Ready chip)
//   Production / Installed / Complete = the stage, 1:1
// Brand-new graduates to Pre-production at 7 days or on the first approval
// activity, whichever comes first (judgment call, veto-able). A null sold_at
// (imported / pre-094) is never "brand new" — unknown isn't recent.
//
// DRAG RESPECTS THE REAL GATES:
//   · Brand-new / Pre-production aren't drop targets (they're derived).
//   · → Production only through lib/project-stage.startProduction (the sole
//     writer; it re-checks readiness). An unready drag bounces with WHY.
//   · Production → Installed → Complete: one step forward at a time, via
//     updateProjectStage — the same writer as the project page's buttons.
//
// Every column is NEWEST AT TOP, keyed on the attention clock (lib/attention):
// pre-production by its clock start (sold / last touch), the rest by when the
// card entered its column. With the rings, a column darkens downward.
// Rings: pre-production wears the age ring; production the FILL ring
// (tracked ÷ estimated hours); installed / complete none. Temp and archived
// projects stay off the board.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { Search, X, ArrowRight, Archive, Handshake } from 'lucide-react'
import { type ProjectStage } from '@/lib/types'
import { loadSubprojectStatusMap } from '@/lib/subproject-status'
import { isDepositReceived, startProduction } from '@/lib/project-stage'
import { updateProjectStage } from '@/lib/sales'
import { STAGE_COLORS } from '@/components/project/StagePill'
import { loadProjectsTotalHours } from '@/lib/project-hours'
import PracticeBadge from '@/components/practice-badge'
import { usePracticeProjects } from '@/hooks/usePracticeProjects'
import TempProjectModal from '@/components/projects/TempProjectModal'
import { loadTempProjectIds } from '@/lib/temp-projects'
import { matchesProjectSearch, normalizeQuery } from '@/lib/project-search'
import { canArchive, confirmAndArchive, loadArchivedProjectIds } from '@/lib/project-archive'
import { announce } from '@/lib/tour-events'
import KanbanColumn from '@/components/kanban/KanbanColumn'
import KanbanCard from '@/components/kanban/KanbanCard'
import TouchedBaseModal from '@/components/kanban/TouchedBaseModal'
import { ageAttention, boardOrder, fillAttention, newestFirst, type Attention } from '@/lib/attention'
import { loadProjectTouches, type ProjectTouches } from '@/lib/attention-data'

interface ProjectRow {
  id: string
  name: string
  client_name: string | null
  stage: ProjectStage
  bid_total: number
  due_date: string | null
  updated_at: string
  created_at?: string | null
  /** Non-null when the job came from Built OS (6c) — drives the badge. */
  imported_at?: string | null
  /** Stamped on the transition into 'sold' (094). Null on anything sold
   *  before that migration — no backfill, so those cards say nothing. */
  sold_at?: string | null
}

type Column = 'new' | 'pre' | 'production' | 'installed' | 'complete'

const COLUMNS: { key: Column; label: string; hint: string }[] = [
  { key: 'new', label: 'Brand-new sale', hint: 'Sold this week' },
  { key: 'pre', label: 'Pre-production', hint: 'Approvals + deposit' },
  { key: 'production', label: 'Production', hint: 'In the shop' },
  { key: 'installed', label: 'Installed', hint: 'On site, wrapping up' },
  { key: 'complete', label: 'Complete', hint: 'Delivered' },
]
const ORDER: Column[] = COLUMNS.map((c) => c.key)

interface Enriched {
  estHours: number
  trackedHours: number
  readySubs: number
  totalSubs: number
  depositIn: boolean
  /** Sold job that clears every production gate. */
  ready: boolean
  /** Any approval card past 'pending' — graduates a brand-new sale. */
  approvalActivity: boolean
}

const POSTSOLD: ProjectStage[] = ['sold', 'production', 'installed', 'complete']
const WEEK_MS = 7 * 86400000

function fmtMoney(n: number): string {
  if (!n) return '$0'
  return `$${Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtHours(n: number): string {
  return `${Math.round(n).toLocaleString()}h`
}

function columnOf(p: ProjectRow, e: Enriched | undefined, now: number): Column {
  if (p.stage !== 'sold') return p.stage as Column
  const sold = p.sold_at ? new Date(p.sold_at).getTime() : NaN
  const fresh = Number.isFinite(sold) && now - sold < WEEK_MS
  return fresh && !e?.approvalActivity ? 'new' : 'pre'
}

/** Why an unready job can't go to production, in the shop's words. */
function notReadyReason(e: Enriched | undefined): string {
  if (!e) return 'Still checking this job — try again in a moment.'
  const parts: string[] = []
  if (e.totalSubs === 0) parts.push('it has no subprojects yet')
  else if (e.readySubs < e.totalSubs) parts.push(`${e.readySubs} of ${e.totalSubs} subprojects are approved`)
  if (!e.depositIn) parts.push('the deposit isn’t recorded')
  return parts.length
    ? `Not ready for production: ${parts.join(' and ')}. Finish pre-production on the project page.`
    : 'Not ready for production yet — check approvals and deposit on the project page.'
}

// Small inline debounce so a search keystroke doesn't refilter on every char.
function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export default function ProjectsPage() {
  const router = useRouter()
  const { org, user } = useAuth()
  const practiceIds = usePracticeProjects(org?.id)
  const [tempOpen, setTempOpen] = useState(false)

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [enriched, setEnriched] = useState<Record<string, Enriched>>({})
  const [touches, setTouches] = useState<Record<string, ProjectTouches>>({})
  const [coOpen, setCoOpen] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 150)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<Column | null>(null)
  const [touchFor, setTouchFor] = useState<ProjectRow | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!org?.id) return
    const orgId = org.id
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const BASE_COLS = 'id, name, client_name, stage, bid_total, due_date, created_at, updated_at, imported_at'
      const load = (cols: string) =>
        supabase
          .from('projects')
          .select(cols)
          .eq('org_id', orgId)
          .in('stage', POSTSOLD)
          .order('updated_at', { ascending: false })

      // ⛔ Retry without sold_at rather than assuming migration 094 has run.
      // PostgREST fails the WHOLE select on one unknown column (42703).
      let { data, error } = await load(`${BASE_COLS}, sold_at`)
      if (error && String((error as { code?: string } | null)?.code) === '42703') {
        console.warn('/projects: sold_at missing — run migration 094')
        ;({ data, error } = await load(BASE_COLS))
      }
      // Archived (119) and temp (117) projects stay off the board — separate
      // id sets, never a column filter (see lib/project-archive).
      const [archived, temp, t] = await Promise.all([
        loadArchivedProjectIds(orgId),
        loadTempProjectIds(orgId),
        loadProjectTouches(orgId),
      ])
      const rows = ((data || []) as unknown as ProjectRow[]).filter((r) => !archived.has(r.id) && !temp.has(r.id))
      if (cancelled) return
      setProjects(rows)
      setTouches(t)

      // Open change orders (draft / sent) per project — for the card badge.
      supabase
        .from('change_orders')
        .select('project_id, projects!inner(org_id)')
        .eq('projects.org_id', orgId)
        .in('state', ['draft', 'sent_to_client'])
        .then(({ data: cos }) => {
          if (cancelled) return
          const counts: Record<string, number> = {}
          for (const c of (cos || []) as { project_id: string }[]) {
            counts[c.project_id] = (counts[c.project_id] || 0) + 1
          }
          setCoOpen(counts)
        })

      // Enrich in BULK (2026-10-29 — Andrew: "the projects dash always
      // takes a long time to load"). The old per-card loop ran ~10 queries
      // per project and re-loaded the whole RATE BOOK for each one. Now each
      // table is read once for the whole board, and estimated hours are only
      // rolled up for the cards that show them (production / installed).
      const ids = (stages: ProjectStage[]) => rows.filter((r) => stages.includes(r.stage)).map((r) => r.id)
      const soldIds = ids(['sold'])
      const hoursIds = ids(['production', 'installed'])
      const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))

      const trackedMinutes: Record<string, number> = {}
      const loadTracked = async () => {
        for (const chunk of chunks(hoursIds)) {
          for (let from = 0; ; from += 1000) {
            const { data: te } = await supabase
              .from('time_entries')
              .select('project_id, duration_minutes')
              .in('project_id', chunk)
              .order('id', { ascending: true })
              .range(from, from + 999)
            for (const r of (te || []) as { project_id: string; duration_minutes: number | null }[])
              trackedMinutes[r.project_id] = (trackedMinutes[r.project_id] || 0) + (Number(r.duration_minutes) || 0)
            if (!te || te.length < 1000) break
          }
        }
      }

      const [estHours, , subsRes, overrideRes, paymentsRes] = await Promise.all([
        loadProjectsTotalHours(orgId, hoursIds),
        loadTracked(),
        soldIds.length
          ? supabase.from('subprojects').select('id, project_id').in('project_id', soldIds)
          : Promise.resolve({ data: [] }),
        soldIds.length
          ? supabase.from('projects').select('id, deposit_override').in('id', soldIds)
          : Promise.resolve({ data: [] }),
        soldIds.length
          ? supabase.from('project_payments').select('project_id, amount').in('project_id', soldIds)
          : Promise.resolve({ data: [] }),
      ])
      const subs = (subsRes.data || []) as { id: string; project_id: string }[]
      const subIds = subs.map((s) => s.id)
      const [statusMap, approvalRows] = await Promise.all([
        loadSubprojectStatusMap(subIds),
        Promise.all(
          chunks(subIds).map((chunk) =>
            supabase
              .from('approval_items')
              .select('subproject_id')
              .in('subproject_id', chunk)
              .is('dismissed_at', null) // 122
              .neq('state', 'pending'),
          ),
        ),
      ])
      const activeSubs = new Set(
        approvalRows.flatMap((r) => ((r.data || []) as { subproject_id: string }[]).map((x) => x.subproject_id)),
      )
      // Deposit: the same three signals as isDepositReceived, two of them read
      // in bulk. Only a job with neither an override nor ledger money falls
      // through to the per-project contract-invoice check.
      const depositIn = new Set<string>()
      for (const r of (overrideRes.data || []) as { id: string; deposit_override?: boolean }[])
        if (r.deposit_override) depositIn.add(r.id)
      const received: Record<string, number> = {}
      for (const r of (paymentsRes.data || []) as { project_id: string; amount: number | null }[])
        received[r.project_id] = (received[r.project_id] || 0) + (Number(r.amount) || 0)
      for (const [id, amt] of Object.entries(received)) if (Math.round(amt * 100) > 0) depositIn.add(id)
      await Promise.all(
        soldIds
          .filter((id) => !depositIn.has(id))
          .map(async (id) => {
            if (await isDepositReceived(id)) depositIn.add(id)
          }),
      )

      const entries = rows.map((p): [string, Enriched] => {
        const mine = subs.filter((s) => s.project_id === p.id)
        const readySubs = mine.filter((s) => statusMap[s.id]?.ready_for_scheduling === true).length
        const totalSubs = mine.length
        const dep = depositIn.has(p.id)
        return [
          p.id,
          {
            estHours: estHours[p.id] || 0,
            trackedHours: (trackedMinutes[p.id] || 0) / 60,
            readySubs,
            totalSubs,
            depositIn: dep,
            ready: p.stage === 'sold' && totalSubs > 0 && readySubs === totalSubs && dep,
            approvalActivity: mine.some((s) => activeSubs.has(s.id)),
          },
        ]
      })
      if (cancelled) return
      setEnriched(Object.fromEntries(entries))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  const attention = useMemo(() => {
    const out: Record<string, Attention | null> = {}
    const now = Date.now()
    for (const p of projects) {
      if (p.stage === 'sold') {
        out[p.id] = ageAttention({ stage: p.stage, sold_at: p.sold_at, lastTouch: touches[p.id]?.touch }, now)
      } else if (p.stage === 'production') {
        const e = enriched[p.id]
        out[p.id] = e ? fillAttention(e.estHours, e.trackedHours) : null
      }
    }
    return out
  }, [projects, enriched, touches])

  // Search (client + project name, shared with the sales kanban) → columns →
  // newest at top.
  const columns = useMemo(() => {
    const out: Record<Column, ProjectRow[]> = { new: [], pre: [], production: [], installed: [], complete: [] }
    const q = normalizeQuery(debouncedQuery)
    const now = Date.now()
    for (const p of projects) {
      if (!matchesProjectSearch(p, q)) continue
      out[columnOf(p, enriched[p.id], now)].push(p)
    }
    const key = (p: ProjectRow): string | null => {
      const a = attention[p.id]
      if (p.stage === 'sold') return a && a.kind === 'age' ? a.since : p.sold_at ?? null
      return touches[p.id]?.stageAt ?? p.updated_at
    }
    for (const c of ORDER) {
      // PRODUCTION sorts by PROJECT AGE alone — newest job on top, oldest at
      // the bottom (Andrew 2026-10-29: "org by project age"). Age = sold date,
      // falling back to created for imports with no sold_at. The fill ring
      // doesn't reorder it; the other columns keep level-then-newest.
      if (c === 'production') {
        out[c].sort((a, b) => newestFirst(a.sold_at ?? a.created_at, b.sold_at ?? b.created_at))
        continue
      }
      out[c].sort((a, b) => boardOrder({ attention: attention[a.id], key: key(a) }, { attention: attention[b.id], key: key(b) }))
    }
    return out
  }, [projects, enriched, debouncedQuery, attention, touches])

  const matchCount = ORDER.reduce((n, c) => n + columns[c].length, 0)

  async function handleDrop(target: Column) {
    const project = projects.find((p) => p.id === dragId)
    setDragId(null)
    setDragOver(null)
    if (!project) return
    const from = columnOf(project, enriched[project.id], Date.now())
    if (from === target) return
    const fromIdx = ORDER.indexOf(from)
    const toIdx = ORDER.indexOf(target)

    if (target === 'production') {
      if (from !== 'new' && from !== 'pre') {
        setNotice('Stages only move forward from the board.')
        return
      }
      const e = enriched[project.id]
      if (!e?.ready) {
        setNotice(notReadyReason(e))
        return
      }
      // startProduction re-checks the gate itself — the board's enrichment
      // could be stale, and it's the sole writer of sold → production.
      const ok = await startProduction(project.id)
      if (!ok) {
        setNotice(notReadyReason(e))
        return
      }
      const at = new Date().toISOString()
      setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, stage: 'production' } : p)))
      setTouches((prev) => ({ ...prev, [project.id]: { touch: { at, label: 'Production started' }, stageAt: at } }))
      announce('ms:production-started')
      setNotice(`${project.name} is in production — schedule allocations seeded.`)
      return
    }

    if (toIdx < fromIdx) {
      setNotice('Stages only move forward from the board.')
      return
    }
    if (from === 'new' || from === 'pre') {
      setNotice('Start production first — drag it into Production.')
      return
    }
    if (toIdx !== fromIdx + 1) {
      setNotice(`One step at a time — move it to ${COLUMNS[fromIdx + 1].label} first.`)
      return
    }
    const stage = target as ProjectStage
    const prevStage = project.stage
    const at = new Date().toISOString()
    setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, stage } : p)))
    setTouches((prev) => ({ ...prev, [project.id]: { touch: { at, label: `Stage changed to ${stage}` }, stageAt: at } }))
    try {
      await updateProjectStage(project.id, stage)
    } catch (err) {
      console.error('updateProjectStage', err)
      setProjects((prev) => prev.map((p) => (p.id === project.id ? { ...p, stage: prevStage } : p)))
      setNotice('Could not move it — try again.')
    }
  }

  async function archive(p: ProjectRow) {
    try {
      if (await confirmAndArchive(p)) setProjects((prev) => prev.filter((x) => x.id !== p.id))
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not archive.')
    }
  }

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[#111]">Projects</h1>
          <p className="text-xs text-[#6B7280] mt-0.5">
            Everything sold, newest at the top of each column. Drag a ready job into Production; click a card to open it.
          </p>
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-[320px] ml-auto">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects or clients…"
            className="w-full pl-9 pr-9 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#111]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        {/* TEMP-PROJECT-BUTTON — temporary (October batch item 9): hours-only
            jobs so the crew can track time on old work. Delete this button
            (and the modal mount below) once the shop has cycled through the
            old jobs; existing temp projects keep working without it. */}
        {org?.id && user?.role !== 'member' && (
          <button
            onClick={() => setTempOpen(true)}
            className="px-3 py-2 text-[13px] rounded-lg border border-dashed border-[#D1D5DB] text-[#4B5563] hover:border-[#2563EB] hover:text-[#2563EB] whitespace-nowrap"
          >
            + Temp project
          </button>
        )}
      </div>

      {query && matchCount === 0 && !loading && (
        <div className="mb-3 text-sm text-[#6B7280]">No projects match “{query}”.</div>
      )}

      {loading ? (
        <div className="text-sm text-[#9CA3AF] py-16 text-center">Loading projects…</div>
      ) : (
        <div className="grid grid-cols-5 gap-3">
          {COLUMNS.map((c) => {
            const cards = columns[c.key]
            const derived = c.key === 'new' || c.key === 'pre'
            return (
              <KanbanColumn
                key={c.key}
                title={c.label}
                count={cards.length}
                sum={cards.reduce((s, p) => s + (p.bid_total || 0), 0)}
                hint={c.hint}
                droppable={!derived}
                emptyText={derived ? 'Nothing here' : 'Drop here'}
                isOver={dragOver === c.key}
                onDragOver={() => setDragOver(c.key)}
                onDragLeave={() => setDragOver((s) => (s === c.key ? null : s))}
                onDrop={() => handleDrop(c.key)}
              >
                {cards.map((p) => (
                  <ProjectCard
                    key={p.id}
                    project={p}
                    column={c.key}
                    attention={attention[p.id] ?? null}
                    isPractice={practiceIds.has(p.id)}
                    enriched={enriched[p.id]}
                    openCos={coOpen[p.id] || 0}
                    onOpen={() => router.push(`/projects/${p.id}`)}
                    onTouchedBase={() => setTouchFor(p)}
                    onArchive={() => archive(p)}
                    onDragStart={() => setDragId(p.id)}
                    onDragEnd={() => {
                      setDragId(null)
                      setDragOver(null)
                    }}
                    isDragging={dragId === p.id}
                  />
                ))}
              </KanbanColumn>
            )
          })}
        </div>
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-lg bg-[#111] text-white text-sm px-4 py-2.5 rounded-lg shadow-lg flex items-start gap-3">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss" className="text-white/60 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {touchFor && org?.id && (
        <TouchedBaseModal
          orgId={org.id}
          userId={user?.id}
          project={touchFor}
          onClose={() => setTouchFor(null)}
          onDone={(touch) => {
            const id = touchFor.id
            setTouchFor(null)
            setTouches((prev) => ({ ...prev, [id]: { touch, stageAt: prev[id]?.stageAt ?? null } }))
          }}
        />
      )}

      {tempOpen && org?.id && (
        <TempProjectModal
          orgId={org.id}
          onClose={() => setTempOpen(false)}
          onCreated={(id) => router.push(`/projects/${id}`)}
        />
      )}
    </div>
  )
}

function ProjectCard({
  project: p,
  column,
  attention,
  isPractice,
  enriched: e,
  openCos,
  onOpen,
  onTouchedBase,
  onArchive,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  project: ProjectRow
  column: Column
  attention: Attention | null
  isPractice: boolean
  enriched: Enriched | undefined
  openCos: number
  onOpen: () => void
  onTouchedBase: () => void
  onArchive: () => void
  onDragStart: () => void
  onDragEnd: () => void
  isDragging: boolean
}) {
  // A CO on an in-production job is the loud case.
  const coInProduction = p.stage === 'production' || p.stage === 'installed'
  const icon = 'w-3.5 h-3.5 text-[#9CA3AF]'
  const ready = STAGE_COLORS.ready
  return (
    <KanbanCard
      title={p.name}
      titleBadges={
        <>
          {isPractice && <PracticeBadge />}
        </>
      }
      // Bottom row: subs-ready / the hours bar / Archive — the attention chip
      // shares it, in the right corner (Andrew 2026-10-29 layout pass).
      footer={
        <>
          <CardContext column={column} enriched={e} />
          {/* Archive button on completed cards — kept from the old grid
              (Andrew 2026-10-22: "keep the buttons on the project cards"). */}
          {canArchive(p.stage) && (
            <div className="flex justify-end">
              <button
                data-kebab
                onClick={(ev) => {
                  ev.stopPropagation()
                  onArchive()
                }}
                className="text-[11px] font-medium text-[#6B7280] hover:text-[#111] px-1.5 py-0.5 rounded hover:bg-[#F3F4F6]"
              >
                Archive
              </button>
            </div>
          )}
        </>
      }
      attention={attention}
      onOpen={onOpen}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      isDragging={isDragging}
      menu={[
        ...(p.stage === 'sold'
          ? [{ label: 'Touched base', icon: <Handshake className={icon} />, onClick: onTouchedBase }]
          : []),
        { label: 'Open project', icon: <ArrowRight className={icon} />, onClick: onOpen },
        // Every card can be archived (Andrew 2026-10-22); sold work warns
        // with what's unpaid.
        { label: 'Archive', icon: <Archive className={icon} />, onClick: onArchive },
      ]}
    >
      <div className="flex items-center justify-between gap-2 mt-1.5">
        <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF]">{fmtMoney(p.bid_total)}</div>
        <div className="flex items-center gap-1">
          {openCos > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border"
              style={
                coInProduction
                  ? { background: '#FEE2E2', color: '#B91C1C', borderColor: '#FCA5A5' }
                  : { background: '#FFFBEB', color: '#92400E', borderColor: '#FDE68A' }
              }
              title={`${openCos} open change order${openCos === 1 ? '' : 's'}`}
            >
              {coInProduction ? '⚠ ' : ''}
              {openCos} CO
            </span>
          )}
          {e?.ready && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded border"
              style={{ background: ready.bg, color: ready.fg, borderColor: ready.border }}
              title="Every subproject approved and the deposit is in — drag it into Production"
            >
              Ready
            </span>
          )}
        </div>
      </div>

    </KanbanCard>
  )
}

function CardContext({ column, enriched: e }: { column: Column; enriched: Enriched | undefined }) {
  if (!e) return null

  if (column === 'new' || column === 'pre') {
    return (
      <div className="text-[11px] text-[#6B7280]">
        {e.totalSubs === 0
          ? 'No subprojects yet'
          : `${e.readySubs} of ${e.totalSubs} subproject${e.totalSubs === 1 ? '' : 's'} ready`}
      </div>
    )
  }
  if (column === 'complete') return null

  // Production / Installed → tracked vs. estimated hours + a progress bar. The
  // production card's FILL RING reads the same two numbers.
  const pct = e.estHours > 0 ? Math.min(100, (e.trackedHours / e.estHours) * 100) : 0
  const over = e.estHours > 0 && e.trackedHours > e.estHours
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-[#6B7280]">
        <span className="font-mono tabular-nums text-[#374151]">{fmtHours(e.trackedHours)}</span> of{' '}
        <span className="font-mono tabular-nums text-[#374151]">{fmtHours(e.estHours)}</span> est.
      </div>
      <div className="h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden">
        <div className={`h-full rounded-full ${over ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
