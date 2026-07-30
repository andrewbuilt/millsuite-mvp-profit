'use client'

// ============================================================================
// /projects — post-sold projects dashboard
// ============================================================================
// Shop-facing dashboard for everything that's been sold and is moving through
// production. Pre-sold bids (new_lead / fifty_fifty / ninety_percent) and lost
// jobs stay on /sales + /sales/kanban; this page is the post-sold view the
// top-nav "Projects" click lands on.
//
// Five lifecycle buckets, derived (no new stage):
//   Pre-production       = sold AND not ready for production
//   Ready for production = sold AND ready (all subs approved + deposit in)
//   In production        = production
//   Installed            = installed
//   Complete             = complete
//
// Each project is enriched ONCE on load — estimated hours (lib/project-hours),
// tracked hours (lib/actual-hours), and (for sold projects) subproject
// readiness + the deposit signal (lib/subproject-status + lib/project-stage).
// The filter, search, and the three summary metrics then recompute purely from
// the in-memory maps — no refetch on interaction.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { Search, X } from 'lucide-react'
import { type ProjectStage } from '@/lib/types'
import { loadSubprojectStatusMap } from '@/lib/subproject-status'
import { isDepositReceived } from '@/lib/project-stage'
import { loadProjectDeptHours } from '@/lib/project-hours'
import { loadProjectActuals } from '@/lib/actual-hours'
import ImportedBadge from '@/components/imported-badge'

interface ProjectRow {
  id: string
  name: string
  client_name: string | null
  stage: ProjectStage
  bid_total: number
  due_date: string | null
  updated_at: string
  /** Non-null when the job came from Built OS (6c) — drives the badge. */
  imported_at?: string | null
}

// Derived lifecycle bucket. 'pre' / 'ready' both map to the 'sold' stage.
type Bucket = 'pre' | 'ready' | 'production' | 'installed' | 'complete'
type Filter = 'all' | Bucket

interface Enriched {
  bucket: Bucket
  estHours: number
  trackedHours: number
  readySubs: number
  totalSubs: number
}

const POSTSOLD: ProjectStage[] = ['sold', 'production', 'installed', 'complete']

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pre', label: 'Pre-production' },
  { key: 'ready', label: 'Ready for production' },
  { key: 'production', label: 'In production' },
  { key: 'installed', label: 'Installed' },
  { key: 'complete', label: 'Complete' },
]

const BUCKET_PILL: Record<
  Bucket,
  { label: string; bg: string; fg: string; border: string }
> = {
  pre:        { label: 'Pre-production', bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
  ready:      { label: 'Ready',          bg: '#D1FAE5', fg: '#065F46', border: '#A7F3D0' },
  production: { label: 'In production',   bg: '#EDE9FE', fg: '#5B21B6', border: '#DDD6FE' },
  installed:  { label: 'Installed',       bg: '#DBEAFE', fg: '#1E40AF', border: '#BFDBFE' },
  complete:   { label: 'Complete',        bg: '#E5E7EB', fg: '#374151', border: '#D1D5DB' },
}

function fmtMoney(n: number): string {
  if (!n) return '$0'
  return `$${Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function fmtHours(n: number): string {
  return `${Math.round(n).toLocaleString()}h`
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
  const { org } = useAuth()

  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [enriched, setEnriched] = useState<Record<string, Enriched>>({})
  const [coOpen, setCoOpen] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 150)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    if (!org?.id) return
    const orgId = org.id
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select('id, name, client_name, stage, bid_total, due_date, updated_at, imported_at')
        .eq('org_id', orgId)
        .in('stage', POSTSOLD)
        .order('updated_at', { ascending: false })
      const rows = (data || []) as ProjectRow[]
      if (cancelled) return
      setProjects(rows)

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

      // Enrich each project once. Hours for all; readiness only for sold
      // projects (the only ones that split into pre vs. ready). Per-project
      // loads run in parallel — fine at beta scale; revisit with bulk queries
      // if the post-sold list grows large.
      const entries = await Promise.all(
        rows.map(async (p): Promise<[string, Enriched]> => {
          const [hours, actuals] = await Promise.all([
            loadProjectDeptHours(orgId, p.id),
            loadProjectActuals(p.id),
          ])
          let bucket: Bucket
          let readySubs = 0
          let totalSubs = 0
          if (p.stage === 'sold') {
            const { data: subs } = await supabase
              .from('subprojects')
              .select('id')
              .eq('project_id', p.id)
            const subIds = ((subs || []) as { id: string }[]).map((s) => s.id)
            totalSubs = subIds.length
            const statusMap = await loadSubprojectStatusMap(subIds)
            readySubs = subIds.filter(
              (id) => statusMap[id]?.ready_for_scheduling === true,
            ).length
            const allReady = totalSubs > 0 && readySubs === totalSubs
            const ready = allReady && (await isDepositReceived(p.id))
            bucket = ready ? 'ready' : 'pre'
          } else {
            // production | installed | complete map 1:1 to a bucket.
            bucket = p.stage as Bucket
          }
          return [
            p.id,
            {
              bucket,
              estHours: hours.totalHours,
              trackedHours: actuals.totalMinutes / 60,
              readySubs,
              totalSubs,
            },
          ]
        }),
      )
      if (cancelled) return
      setEnriched(Object.fromEntries(entries))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

  // Filter (by bucket) + search (client + project name), client-side.
  const visible = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    return projects.filter((p) => {
      const e = enriched[p.id]
      if (filter !== 'all' && (!e || e.bucket !== filter)) return false
      if (q) {
        const hay = `${p.name || ''} ${p.client_name || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [projects, enriched, filter, debouncedQuery])

  // Summary metrics recompute over the visible (filtered + searched) set.
  const metrics = useMemo(() => {
    let value = 0
    let est = 0
    let tracked = 0
    for (const p of visible) {
      value += p.bid_total || 0
      const e = enriched[p.id]
      if (e) {
        est += e.estHours
        tracked += e.trackedHours
      }
    }
    return { value, est, tracked }
  }, [visible, enriched])

  // Counts per filter button (over the full loaded set, not the search).
  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: projects.length,
      pre: 0,
      ready: 0,
      production: 0,
      installed: 0,
      complete: 0,
    }
    for (const p of projects) {
      const e = enriched[p.id]
      if (e) c[e.bucket] += 1
    }
    return c
  }, [projects, enriched])

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#111]">Projects</h1>
        <p className="text-sm text-[#6B7280] mt-1">
          Everything sold and moving through the shop — pre-production through
          complete. Click any card to open the project.
        </p>
      </div>

      {/* Summary metrics — recompute with the active filter + search */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <MetricCard label="Value" value={fmtMoney(metrics.value)} />
        <MetricCard label="Estimated hours" value={fmtHours(metrics.est)} />
        <MetricCard label="Tracked hours" value={fmtHours(metrics.tracked)} />
      </div>

      {/* Filter buttons + search */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={
                  'inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg border transition-colors ' +
                  (active
                    ? 'bg-[#2563EB] text-white border-[#2563EB]'
                    : 'bg-white text-[#374151] border-[#E5E7EB] hover:border-[#9CA3AF]')
                }
              >
                {f.label}
                <span
                  className={
                    'text-[11px] font-mono ' +
                    (active ? 'text-white/80' : 'text-[#9CA3AF]')
                  }
                >
                  {counts[f.key]}
                </span>
              </button>
            )
          })}
        </div>

        <div className="relative flex-1 min-w-[220px] max-w-[360px] ml-auto">
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
      </div>

      {loading ? (
        <div className="text-sm text-[#9CA3AF]">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="text-sm text-[#9CA3AF]">
          No sold projects yet. Mark a bid as sold on the Sales dashboard to
          start one.
        </div>
      ) : visible.length === 0 ? (
        <div className="text-sm text-[#9CA3AF] text-center py-12">
          No projects match the current filter or search.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              enriched={enriched[p.id]}
              openCos={coOpen[p.id] || 0}
              onOpen={() => router.push(`/projects/${p.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
        {label}
      </div>
      <div className="mt-1 font-mono tabular-nums text-[22px] font-semibold text-[#111]">
        {value}
      </div>
    </div>
  )
}

function ProjectCard({
  project: p,
  enriched: e,
  openCos,
  onOpen,
}: {
  project: ProjectRow
  enriched: Enriched | undefined
  openCos: number
  onOpen: () => void
}) {
  const pill = e ? BUCKET_PILL[e.bucket] : null
  // A CO on an in-production job is the loud case.
  const coInProduction = p.stage === 'production' || p.stage === 'installed'
  return (
    <button
      onClick={onOpen}
      className="block text-left w-full bg-white border border-[#E5E7EB] rounded-xl p-4 space-y-2 hover:border-[#2563EB] hover:shadow-sm transition-all"
    >
      {/* Line 1: name + stage pill */}
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-[#111] text-[14px] leading-tight">
          {p.name}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <ImportedBadge importedAt={p.imported_at} />
          {openCos > 0 && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full border"
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
          {pill && (
            <span
              className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded-full border"
              style={{ background: pill.bg, color: pill.fg, borderColor: pill.border }}
            >
              {pill.label}
            </span>
          )}
        </div>
      </div>

      {/* Line 2: client */}
      {p.client_name && (
        <div className="text-[12px] text-[#6B7280] truncate">{p.client_name}</div>
      )}

      {/* Line 3: value */}
      <div className="font-mono tabular-nums text-[#111] text-[15px] font-semibold">
        {fmtMoney(p.bid_total)}
      </div>

      {/* Line 4: stage-specific context */}
      <CardContext project={p} enriched={e} />
    </button>
  )
}

function CardContext({
  project: p,
  enriched: e,
}: {
  project: ProjectRow
  enriched: Enriched | undefined
}) {
  if (!e) return null

  // Pre-production / Ready → approval progress.
  if (e.bucket === 'pre' || e.bucket === 'ready') {
    return (
      <div className="text-[12px] text-[#6B7280]">
        {e.totalSubs === 0
          ? 'No subprojects yet'
          : `${e.readySubs} of ${e.totalSubs} subproject${
              e.totalSubs === 1 ? '' : 's'
            } ready`}
      </div>
    )
  }

  // Complete → delivered.
  if (e.bucket === 'complete') {
    return <div className="text-[12px] text-[#6B7280]">Delivered</div>
  }

  // In production / Installed → tracked vs. estimated hours + a progress bar.
  const pct =
    e.estHours > 0 ? Math.min(100, (e.trackedHours / e.estHours) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="text-[12px] text-[#6B7280]">
        <span className="font-mono tabular-nums text-[#374151]">
          {fmtHours(e.trackedHours)}
        </span>{' '}
        tracked of{' '}
        <span className="font-mono tabular-nums text-[#374151]">
          {fmtHours(e.estHours)}
        </span>{' '}
        est.
      </div>
      <div className="h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden">
        <div
          className="h-full rounded-full bg-[#2563EB]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
