'use client'

// ============================================================================
// AddLineItemPicker — three-tab modal for invoice line items
// ============================================================================
// Tabs:
//   - Custom: hands back a blank row for free entry. Closes immediately.
//   - From subproject: pick one or more subs, each becomes a line at its
//     estimated_price (already post-markup).
//   - From change order: pick approved COs not yet invoiced on the
//     project; net_change feeds the unit price. Already-invoiced COs
//     are hidden to prevent double-billing.
//
// Subprojects DON'T filter out previously-invoiced ones — common to bill
// a sub across deposit/progress/final invoices. COs are one-time.
// ============================================================================

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  loadChangeOrdersForProject,
  type ChangeOrder,
} from '@/lib/change-orders'
import type { InvoiceLineItem } from '@/lib/invoices'

export type AdHocLineSeed = {
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  source_type: InvoiceLineItem['source_type']
  source_id: string | null
}

interface SubprojectRow {
  id: string
  name: string
  estimated_price: number | null
}

type Tab = 'custom' | 'subproject' | 'change_order'

export default function AddLineItemPicker({
  projectId,
  onPick,
  onClose,
}: {
  projectId: string
  /** Caller appends the seeds to its line-items state. */
  onPick: (seeds: AdHocLineSeed[]) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('custom')
  const [loading, setLoading] = useState(true)
  const [subprojects, setSubprojects] = useState<SubprojectRow[]>([])
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([])
  /** Set of CO ids already referenced by a non-void invoice line on
   *  this project. Used to hide them from the picker. */
  const [invoicedCoIds, setInvoicedCoIds] = useState<Set<string>>(new Set())
  const [pickedSubs, setPickedSubs] = useState<Set<string>>(new Set())
  const [pickedCos, setPickedCos] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const [subRes, cos, alreadyInvoiced] = await Promise.all([
        supabase
          .from('subprojects')
          .select('id, name, estimated_price')
          .eq('project_id', projectId)
          .order('created_at'),
        loadChangeOrdersForProject(projectId),
        loadInvoicedCoIdsForProject(projectId),
      ])
      if (cancelled) return
      setSubprojects((subRes.data || []) as SubprojectRow[])
      setChangeOrders(cos)
      setInvoicedCoIds(alreadyInvoiced)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const visibleCos = changeOrders.filter(
    (c) => c.state === 'approved' && !invoicedCoIds.has(c.id),
  )

  function toggleSub(id: string) {
    setPickedSubs((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }
  function toggleCo(id: string) {
    setPickedCos((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function handleAddCustom() {
    onPick([
      {
        description: '',
        quantity: 1,
        unit: null,
        unit_price: 0,
        source_type: 'custom',
        source_id: null,
      },
    ])
  }

  function handleAddPicked() {
    const seeds: AdHocLineSeed[] = []
    Array.from(pickedSubs).forEach((id) => {
      const s = subprojects.find((x) => x.id === id)
      if (!s) return
      seeds.push({
        description: s.name,
        quantity: 1,
        unit: null,
        unit_price: Number(s.estimated_price) || 0,
        source_type: 'subproject',
        source_id: s.id,
      })
    })
    Array.from(pickedCos).forEach((id) => {
      const c = changeOrders.find((x) => x.id === id)
      if (!c) return
      seeds.push({
        description: c.title,
        quantity: 1,
        unit: null,
        unit_price: Number(c.net_change) || 0,
        source_type: 'change_order',
        source_id: c.id,
      })
    })
    if (seeds.length > 0) onPick(seeds)
  }

  const pickedCount = pickedSubs.size + pickedCos.size

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#111]">Add line item</h3>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#111] p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-[#E5E7EB]">
          {(
            [
              { key: 'custom', label: 'Custom' },
              { key: 'subproject', label: 'From subproject' },
              { key: 'change_order', label: 'From change order' },
            ] as { key: Tab; label: string }[]
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[12.5px] font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-[#2563EB] text-[#111]'
                  : 'border-transparent text-[#6B7280] hover:text-[#111]'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-[200px]">
          {tab === 'custom' && (
            <div className="text-[12.5px] text-[#374151] leading-relaxed">
              Adds a blank line. Fill in description, quantity, unit, and rate
              on the invoice itself. Use this for one-off charges (site visits,
              materials reimbursements, etc.) that don't trace back to a
              subproject or change order.
            </div>
          )}

          {tab === 'subproject' && (
            <div>
              {loading ? (
                <div className="text-[12px] text-[#9CA3AF] italic">Loading subprojects…</div>
              ) : subprojects.length === 0 ? (
                <div className="text-[12px] text-[#9CA3AF] italic">
                  No subprojects on this project.
                </div>
              ) : (
                <div className="space-y-1">
                  {subprojects.map((s) => {
                    const picked = pickedSubs.has(s.id)
                    const price = Number(s.estimated_price) || 0
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleSub(s.id)}
                        className={`w-full px-3 py-2 text-left rounded-lg border flex items-center justify-between gap-3 transition-colors ${
                          picked
                            ? 'border-[#2563EB] bg-[#EFF6FF]'
                            : 'border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => {}}
                            className="w-4 h-4 rounded border-[#D1D5DB] text-[#2563EB] flex-shrink-0"
                          />
                          <span className="text-[13px] text-[#111] truncate">{s.name}</span>
                        </div>
                        <span className="text-[12px] font-mono tabular-nums text-[#374151] flex-shrink-0">
                          ${price.toFixed(2)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'change_order' && (
            <div>
              {loading ? (
                <div className="text-[12px] text-[#9CA3AF] italic">Loading change orders…</div>
              ) : visibleCos.length === 0 ? (
                <div className="text-[12px] text-[#9CA3AF] italic">
                  {changeOrders.filter((c) => c.state === 'approved').length === 0
                    ? 'No approved change orders on this project.'
                    : 'All approved change orders have already been invoiced.'}
                </div>
              ) : (
                <div className="space-y-1">
                  {visibleCos.map((c) => {
                    const picked = pickedCos.has(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => toggleCo(c.id)}
                        className={`w-full px-3 py-2 text-left rounded-lg border flex items-center justify-between gap-3 transition-colors ${
                          picked
                            ? 'border-[#2563EB] bg-[#EFF6FF]'
                            : 'border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={picked}
                            onChange={() => {}}
                            className="w-4 h-4 rounded border-[#D1D5DB] text-[#2563EB] flex-shrink-0"
                          />
                          <span className="text-[13px] text-[#111] truncate">{c.title}</span>
                        </div>
                        <span className="text-[12px] font-mono tabular-nums text-[#374151] flex-shrink-0">
                          ${(Number(c.net_change) || 0).toFixed(2)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded-md"
          >
            Cancel
          </button>
          {tab === 'custom' ? (
            <button
              onClick={handleAddCustom}
              className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md"
            >
              Add blank line
            </button>
          ) : (
            <button
              onClick={handleAddPicked}
              disabled={pickedCount === 0}
              className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md disabled:opacity-50"
            >
              Add {pickedCount > 0 ? `${pickedCount} line${pickedCount === 1 ? '' : 's'}` : 'selected'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Set of change-order ids that already appear on a non-void invoice
 *  line item for this project. Used to gate the picker. */
async function loadInvoicedCoIdsForProject(projectId: string): Promise<Set<string>> {
  // Two-step: get all invoice ids for the project (excluding void),
  // then look up CO references in their line items.
  const { data: invs } = await supabase
    .from('client_invoices')
    .select('id, status')
    .eq('project_id', projectId)
  const okIds = (invs || [])
    .filter((i) => (i as any).status !== 'void')
    .map((i) => (i as any).id as string)
  if (okIds.length === 0) return new Set()
  const { data: lines } = await supabase
    .from('client_invoice_line_items')
    .select('source_id')
    .eq('source_type', 'change_order')
    .in('invoice_id', okIds)
  return new Set(
    ((lines || []) as { source_id: string | null }[])
      .map((r) => r.source_id)
      .filter((v): v is string => !!v),
  )
}
