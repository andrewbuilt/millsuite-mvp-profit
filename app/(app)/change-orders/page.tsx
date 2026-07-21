'use client'

// ============================================================================
// /change-orders — cross-project change-order roster (next to Estimates /
// Invoices). Lists every CO with its project, delta, and status.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'

interface CoRow {
  id: string
  co_number: number | null
  title: string
  client_price: number | null
  state: string
  created_at: string
  project_id: string
  projects: { name: string; client_name: string | null } | null
}

type StatusFilter = 'all' | 'open' | 'accepted' | 'declined'
type SortKey = 'date_desc' | 'amount_desc'

const STATE_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: '#F3F4F6', fg: '#6B7280', label: 'Draft' },
  sent_to_client: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Sent' },
  approved: { bg: '#DCFCE7', fg: '#15803D', label: 'Accepted' },
  rejected: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Declined' },
  void: { bg: '#F3F4F6', fg: '#9CA3AF', label: 'Void' },
}

export default function ChangeOrdersPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.org_id

  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CoRow[]>([])
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date_desc')

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('change_orders')
        .select('id, co_number, title, client_price, state, created_at, project_id, projects!inner(name, client_name, org_id)')
        .eq('projects.org_id', orgId)
      if (cancelled) return
      setRows((data || []) as unknown as CoRow[])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (statusFilter === 'open' && !(r.state === 'draft' || r.state === 'sent_to_client')) return false
      if (statusFilter === 'accepted' && r.state !== 'approved') return false
      if (statusFilter === 'declined' && !(r.state === 'rejected' || r.state === 'void')) return false
      if (q) {
        const hay = [r.title, r.projects?.name ?? '', r.projects?.client_name ?? ''].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, query])

  const sorted = useMemo(() => {
    const arr = filtered.slice()
    if (sortKey === 'date_desc') arr.sort((a, b) => b.created_at.localeCompare(a.created_at))
    else arr.sort((a, b) => (b.client_price ?? 0) - (a.client_price ?? 0))
    return arr
  }, [filtered, sortKey])

  const openSummary = useMemo(() => {
    let count = 0
    let value = 0
    for (const r of rows) {
      if (r.state === 'draft' || r.state === 'sent_to_client') {
        count += 1
        value += r.client_price ?? 0
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
          <h1 className="text-[20px] font-semibold text-[#111]">Change orders</h1>
          {openSummary.count > 0 && (
            <div className="text-[12.5px] text-[#6B7280]">
              <span className="font-semibold text-[#111]">{openSummary.count}</span> open ·{' '}
              <span className="font-mono tabular-nums">${openSummary.value.toLocaleString()}</span>
            </div>
          )}
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-[420px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search CO, project, or client…"
              className="w-full pl-9 pr-9 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#111]">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]">
            <option value="all">All statuses</option>
            <option value="open">Open (draft / sent)</option>
            <option value="accepted">Accepted</option>
            <option value="declined">Declined / void</option>
          </select>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
            Sort
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="px-2 py-1 text-[11px] border border-[#E5E7EB] rounded bg-white focus:outline-none focus:border-[#2563EB]">
              <option value="date_desc">Newest</option>
              <option value="amount_desc">Amount (highest)</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="text-sm text-[#9CA3AF]">Loading change orders…</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-10 bg-white border border-dashed border-[#E5E7EB] rounded-xl text-center">
            <div className="text-sm text-[#374151] font-medium mb-1">No change orders yet.</div>
            <div className="text-[12.5px] text-[#9CA3AF]">Create one from a subproject on a sold project.</div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-[#9CA3AF]">No change orders match the current filters.</div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
            <div className="grid grid-cols-[70px_1fr_1fr_110px_110px_90px] px-4 py-2.5 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold border-b border-[#E5E7EB] bg-[#F9FAFB]">
              <div>CO #</div>
              <div>Change</div>
              <div>Project · Client</div>
              <div className="text-right">Date</div>
              <div className="text-right">Amount</div>
              <div className="text-right">Status</div>
            </div>
            {sorted.map((r) => {
              const tone = STATE_TONE[r.state] || STATE_TONE.draft
              const price = Number(r.client_price) || 0
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => router.push(`/projects/${r.project_id}`)}
                  className="w-full text-left grid grid-cols-[70px_1fr_1fr_110px_110px_90px] px-4 py-2.5 items-center border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] transition-colors"
                >
                  <div className="text-[12px] font-mono text-[#6B7280]">CO-{String(r.co_number ?? 0).padStart(2, '0')}</div>
                  <div className="text-[12.5px] text-[#374151] truncate pr-2">{r.title}</div>
                  <div className="text-[12.5px] text-[#6B7280] truncate pr-2">
                    {r.projects?.name ?? '—'}
                    {r.projects?.client_name ? ` · ${r.projects.client_name}` : ''}
                  </div>
                  <div className="text-[12px] font-mono tabular-nums text-right text-[#374151]">{fmtDate(r.created_at)}</div>
                  <div className="text-[12.5px] font-mono tabular-nums text-right text-[#111]">
                    {price === 0 ? '—' : `+$${price.toLocaleString()}`}
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full" style={{ backgroundColor: tone.bg, color: tone.fg }}>
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
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}
