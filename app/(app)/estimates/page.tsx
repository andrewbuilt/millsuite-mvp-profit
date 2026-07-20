'use client'

// ============================================================================
// /estimates — roster of sent (open) estimates
// ============================================================================
// An estimate is "open" once it's been marked sent on the project page
// (projects.estimate_sent_at). This lists every sent estimate across projects,
// alongside the Invoices list. Status derives from the project's sales stage:
//   open  — still in the pipeline (pre-sold)
//   won   — the project sold (post-sold stages)
//   lost  — the project was marked lost
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { isPresold, type ProjectStage } from '@/lib/types'

interface EstimateRow {
  id: string
  name: string
  client_name: string | null
  stage: ProjectStage
  bid_total: number | null
  estimate_number: string | null
  estimate_sent_at: string
}

type EstimateStatus = 'open' | 'won' | 'lost'
type StatusFilter = EstimateStatus | 'all'
type SortKey = 'sent_desc' | 'amount_desc' | 'status'

const SORT_LABELS: Record<SortKey, string> = {
  sent_desc: 'Sent date (newest)',
  amount_desc: 'Amount (highest)',
  status: 'Status',
}

const STATUS_TONE: Record<EstimateStatus, { bg: string; fg: string; label: string }> = {
  open: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Open' },
  won: { bg: '#DCFCE7', fg: '#15803D', label: 'Won' },
  lost: { bg: '#F3F4F6', fg: '#6B7280', label: 'Lost' },
}

function estimateStatus(stage: ProjectStage): EstimateStatus {
  if (stage === 'lost') return 'lost'
  if (isPresold(stage)) return 'open'
  return 'won'
}

export default function EstimatesPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.org_id

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<EstimateRow[]>([])

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('sent_desc')

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select('id, name, client_name, stage, bid_total, estimate_number, estimate_sent_at')
        .eq('org_id', orgId)
        .not('estimate_sent_at', 'is', null)
      if (cancelled) return
      setRows((data || []) as EstimateRow[])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const clientNames = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.client_name) set.add(r.client_name)
    return Array.from(set).sort()
  }, [rows])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter !== 'all' && estimateStatus(r.stage) !== statusFilter) return false
      if (clientFilter !== 'all' && r.client_name !== clientFilter) return false
      if (q) {
        const hay = [r.estimate_number ?? '', r.name, r.client_name ?? ''].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, clientFilter, query])

  const sorted = useMemo(() => {
    const arr = filtered.slice()
    switch (sortKey) {
      case 'sent_desc':
        arr.sort((a, b) => b.estimate_sent_at.localeCompare(a.estimate_sent_at))
        break
      case 'amount_desc':
        arr.sort((a, b) => (b.bid_total ?? 0) - (a.bid_total ?? 0))
        break
      case 'status':
        arr.sort((a, b) => estimateStatus(a.stage).localeCompare(estimateStatus(b.stage)))
        break
    }
    return arr
  }, [filtered, sortKey])

  // Pre-filter summary — count + value of still-open estimates.
  const openSummary = useMemo(() => {
    let count = 0
    let value = 0
    for (const r of rows) {
      if (estimateStatus(r.stage) === 'open') {
        count += 1
        value += r.bid_total ?? 0
      }
    }
    return { count, value }
  }, [rows])

  if (!orgId) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-8 text-sm text-[#6B7280]">Loading account…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-[20px] font-semibold text-[#111]">Estimates</h1>
          {openSummary.count > 0 && (
            <div className="text-[12.5px] text-[#6B7280]">
              <span className="font-semibold text-[#111]">{openSummary.count}</span> open ·{' '}
              <span className="font-mono tabular-nums">${openSummary.value.toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-[420px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search estimate #, project, or client…"
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </select>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
          >
            <option value="all">All clients</option>
            {clientNames.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
            Sort
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
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

        {loading ? (
          <div className="text-sm text-[#9CA3AF]">Loading estimates…</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 bg-white border border-dashed border-[#E5E7EB] rounded-xl text-center">
            <div className="text-sm text-[#374151] font-medium mb-1">No sent estimates yet.</div>
            <div className="text-[12.5px] text-[#9CA3AF]">
              Open a project and use <span className="font-medium">Mark as sent</span> after you send
              the estimate — it'll show up here.
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-[#9CA3AF]">No estimates match the current filters.</div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
            <div className="grid grid-cols-[120px_1fr_1fr_120px_120px_90px] px-4 py-2.5 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold border-b border-[#E5E7EB] bg-[#F9FAFB]">
              <div>Estimate #</div>
              <div>Project</div>
              <div>Client</div>
              <div className="text-right">Sent</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Status</div>
            </div>
            {sorted.map((r) => {
              const status = estimateStatus(r.stage)
              const tone = STATUS_TONE[status]
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => router.push(`/projects/${r.id}`)}
                  className="w-full text-left grid grid-cols-[120px_1fr_1fr_120px_120px_90px] px-4 py-2.5 items-center border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] transition-colors"
                >
                  <div className="text-[12.5px] font-mono text-[#111]">
                    {r.estimate_number ?? '—'}
                  </div>
                  <div className="text-[12.5px] text-[#374151] truncate pr-2">{r.name}</div>
                  <div className="text-[12.5px] text-[#6B7280] truncate pr-2">
                    {r.client_name ?? '—'}
                  </div>
                  <div className="text-[12px] font-mono tabular-nums text-right text-[#374151]">
                    {fmtDate(r.estimate_sent_at)}
                  </div>
                  <div className="text-[12.5px] font-mono tabular-nums text-right text-[#111]">
                    ${(r.bid_total ?? 0).toLocaleString()}
                  </div>
                  <div className="text-right">
                    <span
                      className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
                      style={{ backgroundColor: tone.bg, color: tone.fg }}
                    >
                      {tone.label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
