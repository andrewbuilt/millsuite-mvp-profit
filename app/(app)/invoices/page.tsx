'use client'

// ============================================================================
// /invoices — top-level invoice list
// ============================================================================
// Cross-project AR view. Filters live above a single sortable table.
//
// Overdue is computed client-side (status='sent' AND due_date < today)
// rather than stored — keeps the schema lean and lets us re-evaluate
// without a daily cron. The status filter exposes "overdue" as a
// pseudo-value that maps to the same predicate.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import {
  loadInvoices,
  isOverdue,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  type Invoice,
  type InvoiceStatus,
} from '@/lib/invoices'
import { loadClients, type Client } from '@/lib/clients'
import { supabase } from '@/lib/supabase'

interface ProjectLite {
  id: string
  name: string
  client_id: string | null
}

type StatusFilter = InvoiceStatus | 'all' | 'overdue'

type SortKey = 'invoice_date_desc' | 'due_date_asc' | 'total_desc' | 'status'

const SORT_LABELS: Record<SortKey, string> = {
  invoice_date_desc: 'Invoice date (newest)',
  due_date_asc: 'Due date (soonest)',
  total_desc: 'Total (highest)',
  status: 'Status',
}

export default function InvoicesPage() {
  const { user } = useAuth()
  const router = useRouter()
  const orgId = user?.org_id

  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [projects, setProjects] = useState<ProjectLite[]>([])
  const [clients, setClients] = useState<Client[]>([])

  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [clientFilter, setClientFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('invoice_date_desc')

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [invs, projRes, cls] = await Promise.all([
        loadInvoices(orgId),
        supabase.from('projects').select('id, name, client_id').eq('org_id', orgId),
        loadClients(orgId),
      ])
      if (cancelled) return
      setInvoices(invs)
      setProjects((projRes.data || []) as ProjectLite[])
      setClients(cls)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const projectById = useMemo(() => {
    const m = new Map<string, ProjectLite>()
    for (const p of projects) m.set(p.id, p)
    return m
  }, [projects])

  const clientById = useMemo(() => {
    const m = new Map<string, Client>()
    for (const c of clients) m.set(c.id, c)
    return m
  }, [clients])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return invoices.filter((inv) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'overdue') {
          if (!isOverdue(inv)) return false
        } else if (inv.status !== statusFilter) {
          return false
        }
      }
      if (clientFilter !== 'all' && inv.client_id !== clientFilter) return false
      if (q) {
        const proj = inv.project_id ? projectById.get(inv.project_id) : null
        const cli = inv.client_id ? clientById.get(inv.client_id) : null
        const hay = [
          inv.invoice_number,
          proj?.name ?? '',
          cli?.name ?? '',
        ]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [invoices, statusFilter, clientFilter, query, projectById, clientById])

  const sorted = useMemo(() => {
    const arr = filtered.slice()
    switch (sortKey) {
      case 'invoice_date_desc':
        arr.sort((a, b) => b.invoice_date.localeCompare(a.invoice_date))
        break
      case 'due_date_asc':
        arr.sort((a, b) => a.due_date.localeCompare(b.due_date))
        break
      case 'total_desc':
        arr.sort((a, b) => b.total - a.total)
        break
      case 'status':
        arr.sort((a, b) => a.status.localeCompare(b.status))
        break
    }
    return arr
  }, [filtered, sortKey])

  // AR-aging aggregates — computed from the loaded list (org-wide,
  // pre-filter). Outstanding = sent + partial + overdue balances.
  // Overdue = sent past due date. Paid this month = paid invoices
  // whose paid_at falls in the current calendar month.
  const aging = useMemo(() => {
    const now = new Date()
    const ymPrefix = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    let outstanding = 0
    let overdue = 0
    let overdueCount = 0
    let paidThisMonth = 0
    for (const inv of invoices) {
      if (inv.status === 'void' || inv.status === 'draft') continue
      const balance = +(inv.total - inv.amount_received).toFixed(2)
      if (inv.status === 'sent' || inv.status === 'partial') {
        outstanding += balance
        if (isOverdue(inv)) {
          overdue += balance
          overdueCount += 1
        }
      }
      if (inv.status === 'paid' && inv.paid_at?.startsWith(ymPrefix)) {
        paidThisMonth += inv.total
      }
    }
    return {
      outstanding: +outstanding.toFixed(2),
      overdue: +overdue.toFixed(2),
      overdueCount,
      paidThisMonth: +paidThisMonth.toFixed(2),
    }
  }, [invoices])

  if (!orgId) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <Nav />
        <div className="p-8 text-sm text-[#6B7280]">Loading account…</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Nav />
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-[20px] font-semibold text-[#111]">Invoices</h1>
        </div>

        {/* AR-aging summary — pre-filter aggregate so the numbers
            don't shift as the operator filters the list. */}
        {invoices.length > 0 && (
          <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="px-4 py-3 bg-white border border-[#E5E7EB] rounded-xl">
              <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                Outstanding
              </div>
              <div className="text-[18px] font-semibold text-[#111] font-mono tabular-nums mt-0.5">
                ${aging.outstanding.toFixed(2)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStatusFilter(aging.overdueCount > 0 ? 'overdue' : statusFilter)}
              disabled={aging.overdueCount === 0}
              className={`px-4 py-3 bg-white border border-[#E5E7EB] rounded-xl text-left transition-colors ${
                aging.overdueCount > 0
                  ? 'hover:border-[#FECACA] hover:bg-[#FEF2F2] cursor-pointer'
                  : 'cursor-default'
              }`}
            >
              <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                Overdue
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <div
                  className={`text-[18px] font-semibold font-mono tabular-nums ${
                    aging.overdueCount > 0 ? 'text-[#991B1B]' : 'text-[#9CA3AF]'
                  }`}
                >
                  ${aging.overdue.toFixed(2)}
                </div>
                {aging.overdueCount > 0 && (
                  <div className="text-[11.5px] text-[#9CA3AF]">
                    {aging.overdueCount} invoice{aging.overdueCount === 1 ? '' : 's'}
                  </div>
                )}
              </div>
            </button>
            <div className="px-4 py-3 bg-white border border-[#E5E7EB] rounded-xl">
              <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                Paid this month
              </div>
              <div className="text-[18px] font-semibold text-[#059669] font-mono tabular-nums mt-0.5">
                ${aging.paidThisMonth.toFixed(2)}
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-[420px]">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search invoice #, project, or client…"
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
            <option value="draft">Draft</option>
            <option value="sent">Sent</option>
            <option value="overdue">Overdue</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="void">Void</option>
          </select>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:outline-none focus:border-[#2563EB]"
          >
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
          <div className="text-sm text-[#9CA3AF]">Loading invoices…</div>
        ) : invoices.length === 0 ? (
          <div className="px-6 py-10 bg-white border border-dashed border-[#E5E7EB] rounded-xl text-center">
            <div className="text-sm text-[#374151] font-medium mb-1">No invoices yet.</div>
            <div className="text-[12.5px] text-[#9CA3AF]">
              Generate one from a project's payment milestone.
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-[#9CA3AF]">No invoices match the current filters.</div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
            <div className="grid grid-cols-[120px_1fr_1fr_110px_110px_110px_110px_90px] px-4 py-2.5 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold border-b border-[#E5E7EB] bg-[#F9FAFB]">
              <div>Invoice #</div>
              <div>Project</div>
              <div>Client</div>
              <div className="text-right">Date</div>
              <div className="text-right">Due</div>
              <div className="text-right">Total</div>
              <div className="text-right">Received</div>
              <div className="text-right">Status</div>
            </div>
            {sorted.map((inv) => {
              const proj = inv.project_id ? projectById.get(inv.project_id) : null
              const cli = inv.client_id ? clientById.get(inv.client_id) : null
              const overdue = isOverdue(inv)
              const displayStatus: InvoiceStatus = overdue ? 'overdue' : inv.status
              const tone = INVOICE_STATUS_TONE[displayStatus]
              const isVoid = inv.status === 'void'
              return (
                <button
                  key={inv.id}
                  type="button"
                  onClick={() => router.push(`/invoices/${inv.id}`)}
                  className={`w-full text-left grid grid-cols-[120px_1fr_1fr_110px_110px_110px_110px_90px] px-4 py-2.5 items-center border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] transition-colors ${
                    isVoid ? 'opacity-60' : ''
                  }`}
                >
                  <div className={`text-[12.5px] font-mono text-[#111] ${isVoid ? 'line-through' : ''}`}>
                    {inv.invoice_number}
                  </div>
                  <div className="text-[12.5px] text-[#374151] truncate pr-2">
                    {proj?.name ?? '—'}
                  </div>
                  <div className="text-[12.5px] text-[#6B7280] truncate pr-2">
                    {cli?.name ?? '—'}
                  </div>
                  <div className="text-[12px] font-mono tabular-nums text-right text-[#374151]">
                    {fmtDate(inv.invoice_date)}
                  </div>
                  <div className={`text-[12px] font-mono tabular-nums text-right ${overdue ? 'text-[#991B1B] font-semibold' : 'text-[#374151]'}`}>
                    {fmtDate(inv.due_date)}
                  </div>
                  <div className="text-[12.5px] font-mono tabular-nums text-right text-[#111]">
                    ${inv.total.toFixed(2)}
                  </div>
                  <div className="text-[12.5px] font-mono tabular-nums text-right text-[#6B7280]">
                    ${inv.amount_received.toFixed(2)}
                  </div>
                  <div className="text-right">
                    <span
                      className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
                      style={{ backgroundColor: tone.bg, color: tone.fg }}
                    >
                      {INVOICE_STATUS_LABEL[displayStatus]}
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
  const d = new Date(iso + 'T12:00:00Z')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
}

