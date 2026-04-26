'use client'

// ============================================================================
// /projects — all projects, grouped by stage
// ============================================================================
// Shop-facing overview across the full pipeline — one card per project,
// bucketed by stage. Pre-sold stages (new_lead / fifty_fifty / ninety_percent)
// also live on /sales + /sales/kanban; this page adds the post-sold buckets
// (sold / production / installed / complete) and a lost lane.
//
// No drag-drop here — stage transitions happen on the project cover action
// bar (or on the sales kanban for pre-sold drags). This page is a browse
// + jump-to surface, plus a delete action behind a confirm on each card.
// ============================================================================

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { deleteProject } from '@/lib/sales'
import { Search, Trash2, X } from 'lucide-react'
import {
  PROJECT_STAGE_LABEL,
  type ProjectStage,
} from '@/lib/types'

interface ProjectRow {
  id: string
  name: string
  client_name: string | null
  stage: ProjectStage
  bid_total: number
  actual_total: number
  due_date: string | null
  target_margin_pct: number | null
  updated_at: string
}

// Column order on the page. Lost sits at the end so it stays out of the main
// flow but is still reachable.
const COLUMNS: ProjectStage[] = [
  'new_lead',
  'fifty_fifty',
  'ninety_percent',
  'sold',
  'production',
  'installed',
  'complete',
  'lost',
]

const SOLD_STAGES: ProjectStage[] = ['sold', 'production', 'installed', 'complete']

type SortKey = 'updated' | 'due' | 'total' | 'name'

const SORT_LABELS: Record<SortKey, string> = {
  updated: 'Recently updated',
  due: 'Due date',
  total: 'Project total',
  name: 'Name (A–Z)',
}

function fmtMoney(n: number) {
  if (!n) return '—'
  return n < 0
    ? `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

/** Days until a due date. Negative = overdue. Null when no due date. */
function daysUntil(due: string | null): number | null {
  if (!due) return null
  const d = new Date(due + 'T12:00:00')
  if (isNaN(d.getTime())) return null
  const now = new Date()
  now.setHours(12, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function dueDatePillTone(days: number | null): {
  bg: string
  text: string
  border: string
  bold: boolean
} | null {
  if (days === null) return null
  if (days < 0) return { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5', bold: true }
  if (days < 7) return { bg: '#FEE2E2', text: '#991B1B', border: '#FECACA', bold: false }
  if (days <= 30) return { bg: '#FEF3C7', text: '#92400E', border: '#FDE68A', bold: false }
  return { bg: '#F3F4F6', text: '#6B7280', border: '#E5E7EB', bold: false }
}

function formatDueDate(due: string | null, days: number | null): string {
  if (!due || days === null) return ''
  const d = new Date(due + 'T12:00:00')
  const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (days < 0) return `${label} · ${Math.abs(days)}d overdue`
  if (days === 0) return `${label} · today`
  if (days <= 30) return `${label} · ${days}d`
  return label
}

// Debounce hook — small inline so a 6-line file change doesn't pull a new
// dep. 150ms matches the spec.
function useDebounced<T>(value: T, delay: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsPageBody />
    </Suspense>
  )
}

function ProjectsPageBody() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { org } = useAuth()
  const { confirm } = useConfirm()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [loading, setLoading] = useState(true)

  // ── Filters ──
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounced(query, 150)
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [showLostComplete, setShowLostComplete] = useState(false)

  // ── Per-column sort, persisted in URL search params ──
  // Stored as ?sort_production=total etc. Default 'updated'. Reading from
  // searchParams ensures deep-link sharing works.
  function getSort(stage: ProjectStage): SortKey {
    const v = searchParams?.get(`sort_${stage}`) as SortKey | null
    if (v && (v === 'updated' || v === 'due' || v === 'total' || v === 'name')) return v
    return 'updated'
  }
  function setSort(stage: ProjectStage, key: SortKey) {
    const params = new URLSearchParams(Array.from(searchParams?.entries() || []))
    if (key === 'updated') params.delete(`sort_${stage}`)
    else params.set(`sort_${stage}`, key)
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
  }

  useEffect(() => {
    if (!org?.id) return
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select(
          'id, name, client_name, stage, bid_total, actual_total, due_date, target_margin_pct, updated_at',
        )
        .eq('org_id', org.id)
        .order('updated_at', { ascending: false })
      setProjects((data || []) as ProjectRow[])
      setLoading(false)
    })()
  }, [org?.id])

  // Distinct clients with active projects, alphabetized.
  const clientOptions = useMemo(() => {
    const set = new Set<string>()
    for (const p of projects) {
      if (p.client_name && p.client_name.trim()) set.add(p.client_name.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [projects])

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    return projects.filter((p) => {
      if (q) {
        const haystack = `${p.name || ''} ${p.client_name || ''}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      if (clientFilter !== 'all') {
        if ((p.client_name || '').trim() !== clientFilter) return false
      }
      return true
    })
  }, [projects, debouncedQuery, clientFilter])

  const visibleColumns = useMemo(
    () =>
      showLostComplete
        ? COLUMNS
        : COLUMNS.filter((s) => s !== 'lost' && s !== 'complete'),
    [showLostComplete],
  )

  const grouped = useMemo(() => {
    const out = {} as Record<ProjectStage, ProjectRow[]>
    for (const c of COLUMNS) out[c] = []
    for (const p of filtered) out[p.stage]?.push(p)
    return out
  }, [filtered])

  function sortRows(rows: ProjectRow[], key: SortKey): ProjectRow[] {
    const copy = [...rows]
    switch (key) {
      case 'due':
        // null due dates sink to the bottom regardless of direction.
        return copy.sort((a, b) => {
          const ad = a.due_date
          const bd = b.due_date
          if (!ad && !bd) return 0
          if (!ad) return 1
          if (!bd) return -1
          return ad.localeCompare(bd)
        })
      case 'total':
        return copy.sort((a, b) => (b.bid_total || 0) - (a.bid_total || 0))
      case 'name':
        return copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      case 'updated':
      default:
        return copy.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    }
  }

  async function handleDelete(p: ProjectRow) {
    const ok = await confirm({
      title: 'Delete project?',
      message: `Delete "${p.name}"? This removes all subprojects, estimate lines, time entries, invoices, and milestones for the project. This can't be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteProject(p.id)
      setProjects((prev) => prev.filter((x) => x.id !== p.id))
    } catch (err: any) {
      alert(`Failed to delete: ${err?.message || 'unknown error'}`)
    }
  }

  const orgMargin = org?.profit_margin_pct ?? 35

  return (
    <>
      <Nav />
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#111]">Projects</h1>
          <p className="text-sm text-[#6B7280] mt-1">
            Every project your shop is touching, grouped by stage. Click any
            card to open the project cover.
          </p>
        </div>

        {/* Filter bar */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-[420px]">
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

          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
          >
            <option value="all">All clients</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <label className="inline-flex items-center gap-2 text-sm text-[#374151] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showLostComplete}
              onChange={(e) => setShowLostComplete(e.target.checked)}
              className="w-4 h-4 rounded border-[#D1D5DB] text-[#2563EB] focus:ring-[#2563EB] focus:ring-offset-0 cursor-pointer"
            />
            Show lost + complete
          </label>
        </div>

        {loading ? (
          <div className="text-sm text-[#9CA3AF]">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="text-sm text-[#9CA3AF]">
            No projects yet. Drop a PDF on the Sales dashboard to start one.
          </div>
        ) : (
          <div className="space-y-6">
            {visibleColumns.map((stage) => {
              const rows = grouped[stage]
              if (rows.length === 0) return null
              const sortKey = getSort(stage)
              const sorted = sortRows(rows, sortKey)
              return (
                <section key={stage}>
                  <div className="flex items-center gap-3 mb-3">
                    <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[#6B7280]">
                      {PROJECT_STAGE_LABEL[stage]}
                    </h2>
                    <span className="text-xs text-[#9CA3AF] font-mono">
                      {rows.length}
                    </span>
                    <div className="flex-1" />
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                      Sort
                      <select
                        value={sortKey}
                        onChange={(e) => setSort(stage, e.target.value as SortKey)}
                        className="px-2 py-1 text-[11px] border border-[#E5E7EB] rounded bg-white focus:outline-none focus:border-[#2563EB]"
                      >
                        {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                          <option key={k} value={k}>
                            {SORT_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {sorted.map((p) => {
                      const days = daysUntil(p.due_date)
                      const tone = dueDatePillTone(days)
                      const dueLabel = formatDueDate(p.due_date, days)
                      const margin = SOLD_STAGES.includes(p.stage)
                        ? p.target_margin_pct ?? orgMargin
                        : null
                      return (
                        <div
                          key={p.id}
                          className="relative group bg-white border border-[#E5E7EB] rounded-xl p-4 hover:border-[#2563EB] hover:shadow-sm transition-all"
                        >
                          <button
                            onClick={() => router.push(`/projects/${p.id}`)}
                            className="block text-left w-full pr-8 space-y-2"
                          >
                            {/* Line 1: name · client */}
                            <div className="flex items-baseline gap-1.5 flex-wrap">
                              <span className="font-semibold text-[#111] text-[14px]">
                                {p.name}
                              </span>
                              {p.client_name && (
                                <>
                                  <span className="text-[#D1D5DB] text-[12px]">·</span>
                                  <span className="text-[12px] text-[#6B7280] truncate">
                                    {p.client_name}
                                  </span>
                                </>
                              )}
                            </div>
                            {/* Line 2: total + margin badge */}
                            <div className="flex items-center gap-2">
                              <span className="font-mono tabular-nums text-[#111] text-[14px] font-semibold">
                                {fmtMoney(p.bid_total)}
                              </span>
                              {margin != null && (
                                <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#ECFDF5] text-[#065F46] border border-[#A7F3D0]">
                                  {Math.round(margin)}% margin
                                </span>
                              )}
                            </div>
                            {/* Line 3: due date pill (when set) */}
                            {tone && (
                              <div>
                                <span
                                  className={
                                    'inline-flex items-center px-2 py-0.5 text-[11px] rounded border ' +
                                    (tone.bold ? 'font-semibold ' : '')
                                  }
                                  style={{
                                    background: tone.bg,
                                    color: tone.text,
                                    borderColor: tone.border,
                                  }}
                                >
                                  {dueLabel}
                                </span>
                              </div>
                            )}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(p)
                            }}
                            title="Delete project"
                            aria-label="Delete project"
                            className="absolute top-3 right-3 p-1.5 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}

            {/* Empty-after-filter helper */}
            {visibleColumns.every((s) => grouped[s].length === 0) && (
              <div className="text-sm text-[#9CA3AF] text-center py-12">
                No projects match the current filters.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
