'use client'

// ============================================================================
// CreateInvoiceModal — generate invoice from a milestone
// ============================================================================
// Loads the milestone seed via buildInvoiceFromMilestone, prefills every
// field, lets the operator edit any of them, and writes either a draft
// or a sent invoice.
//
// Number reservation is deferred until save — typing a custom number
// uses that, otherwise createInvoice atomically bumps orgs.next_invoice_number.
// Cancelling never burns a number.
//
// PR-3 will add ad-hoc creation (no milestone seed) by extending the
// `mode` prop with 'ad_hoc' and adding "From subproject" / "From change
// order" line item sources.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  buildInvoiceFromMilestone,
  createInvoice,
  recomputeInvoiceTotals,
  type Invoice,
  type InvoiceLineItem,
} from '@/lib/invoices'
import AddLineItemPicker, { type AdHocLineSeed } from './AddLineItemPicker'

interface DraftLine {
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  source_type: InvoiceLineItem['source_type']
  source_id: string | null
}

interface BillTo {
  name: string
  address: string | null
  email: string | null
  phone: string | null
}

type Props = {
  onClose: () => void
  onCreated: (invoice: Invoice, action: 'draft' | 'sent') => void
} & (
  | { mode: 'milestone'; milestoneId: string }
  | { mode: 'ad_hoc'; projectId: string; orgId: string }
)

export default function CreateInvoiceModal(props: Props) {
  const { onClose, onCreated } = props
  const isMilestone = props.mode === 'milestone'
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [orgId, setOrgId] = useState<string | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string>('')
  const [clientId, setClientId] = useState<string | null>(null)
  const [billTo, setBillTo] = useState<BillTo | null>(null)

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [lineItems, setLineItems] = useState<DraftLine[]>([])
  const [taxPct, setTaxPct] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [linkedMilestoneId, setLinkedMilestoneId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (props.mode === 'milestone') {
          const seed = await buildInvoiceFromMilestone(props.milestoneId)
          if (cancelled) return
          const inv = seed.invoice
          setOrgId(inv.org_id ?? null)
          setProjectId(inv.project_id ?? null)
          setClientId(inv.client_id ?? null)
          setInvoiceDate(inv.invoice_date ?? '')
          setDueDate(inv.due_date ?? '')
          setTaxPct(Number(inv.tax_pct) || 0)
          setNotes(inv.notes ?? '')
          setInternalNotes(inv.internal_notes ?? '')
          setLinkedMilestoneId(inv.linked_milestone_id ?? null)
          setLineItems(
            seed.lineItems.map((li) => ({
              description: li.description ?? '',
              quantity: Number(li.quantity ?? 1),
              unit: li.unit ?? null,
              unit_price: Number(li.unit_price ?? 0),
              source_type: li.source_type ?? null,
              source_id: li.source_id ?? null,
            })),
          )
          if (inv.project_id) {
            const { data: proj } = await supabase
              .from('projects')
              .select('name')
              .eq('id', inv.project_id)
              .single()
            if (!cancelled && proj?.name) setProjectName(proj.name)
          }
          if (inv.client_id) {
            const { data: c } = await supabase
              .from('clients')
              .select('name, address, email, phone')
              .eq('id', inv.client_id)
              .single()
            if (!cancelled && c) {
              setBillTo({
                name: c.name,
                address: c.address ?? null,
                email: c.email ?? null,
                phone: c.phone ?? null,
              })
            }
          }
        } else {
          // Ad-hoc — seed from project + org settings only. No
          // milestone link, no prefilled line items, today + default
          // payment terms for dates.
          setOrgId(props.orgId)
          setProjectId(props.projectId)
          setLineItems([])
          setLinkedMilestoneId(null)

          const [projRes, orgRes] = await Promise.all([
            supabase
              .from('projects')
              .select('name, client_id')
              .eq('id', props.projectId)
              .single(),
            supabase
              .from('orgs')
              .select(
                'default_tax_pct, default_payment_terms_days, invoice_footer_text',
              )
              .eq('id', props.orgId)
              .single(),
          ])
          if (cancelled) return
          if (projRes.data) {
            setProjectName((projRes.data as any).name)
            setClientId((projRes.data as any).client_id ?? null)
          }
          const today = new Date().toISOString().slice(0, 10)
          const termsDays =
            Number((orgRes.data as any)?.default_payment_terms_days) || 14
          const due = new Date()
          due.setUTCDate(due.getUTCDate() + termsDays)
          setInvoiceDate(today)
          setDueDate(due.toISOString().slice(0, 10))
          setTaxPct(Number((orgRes.data as any)?.default_tax_pct) || 0)
          setNotes(((orgRes.data as any)?.invoice_footer_text as string) ?? '')
          setInternalNotes('')

          if (projRes.data && (projRes.data as any).client_id) {
            const { data: c } = await supabase
              .from('clients')
              .select('name, address, email, phone')
              .eq('id', (projRes.data as any).client_id)
              .single()
            if (!cancelled && c) {
              setBillTo({
                name: c.name,
                address: c.address ?? null,
                email: c.email ?? null,
                phone: c.phone ?? null,
              })
            }
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to seed invoice')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode === 'milestone' ? props.milestoneId : `${props.mode === 'ad_hoc' ? props.projectId : ''}`])

  const totals = useMemo(
    () =>
      recomputeInvoiceTotals(
        lineItems.map((li) => ({
          quantity: li.quantity,
          unit_price: li.unit_price,
          amount: li.quantity * li.unit_price,
        })),
        taxPct,
      ),
    [lineItems, taxPct],
  )

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLineItems((prev) => {
      const next = prev.slice()
      next[i] = { ...next[i], ...patch }
      return next
    })
  }

  function removeLine(i: number) {
    setLineItems((prev) => prev.filter((_, idx) => idx !== i))
  }

  const [pickerOpen, setPickerOpen] = useState(false)

  function appendSeeds(seeds: AdHocLineSeed[]) {
    setLineItems((prev) => [
      ...prev,
      ...seeds.map((s) => ({
        description: s.description,
        quantity: s.quantity,
        unit: s.unit,
        unit_price: s.unit_price,
        source_type: s.source_type,
        source_id: s.source_id,
      })),
    ])
    setPickerOpen(false)
  }

  async function handleSave(markSent: boolean) {
    if (!orgId || !projectId) {
      setError('Missing project context')
      return
    }
    if (lineItems.length === 0) {
      setError('Add at least one line item')
      return
    }
    if (lineItems.some((li) => !li.description.trim())) {
      setError('Every line item needs a description')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await createInvoice({
        invoice: {
          org_id: orgId,
          project_id: projectId,
          client_id: clientId,
          invoice_number: invoiceNumber.trim() || undefined,
          invoice_date: invoiceDate,
          due_date: dueDate,
          tax_pct: taxPct,
          notes: notes || null,
          internal_notes: internalNotes || null,
          linked_milestone_id: linkedMilestoneId,
        },
        lineItems: lineItems.map((li, i) => ({
          sort_order: i,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          unit_price: li.unit_price,
          amount: +(li.quantity * li.unit_price).toFixed(2),
          source_type: li.source_type,
          source_id: li.source_id,
        })),
        markSent,
      })
      onCreated(created, markSent ? 'sent' : 'draft')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save invoice')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <h3 className="text-[15px] font-semibold text-[#111]">New invoice</h3>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#111] p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-12 text-sm text-[#6B7280] text-center">
            Loading milestone…
          </div>
        ) : (
          <div className="px-5 py-4 overflow-y-auto flex-1 space-y-5">
            {/* Header row — number, date, due date */}
            <div className="grid grid-cols-3 gap-3">
              <Field label="Invoice #">
                <input
                  type="text"
                  value={invoiceNumber}
                  onChange={(e) => setInvoiceNumber(e.target.value)}
                  placeholder="(auto-generated)"
                  className={inputClass}
                />
              </Field>
              <Field label="Invoice date">
                <input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            {/* Bill-to + project (read-only) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="px-3 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
                  Bill to
                </div>
                {billTo ? (
                  <div className="text-[12.5px] text-[#111] leading-relaxed">
                    <div className="font-medium">{billTo.name}</div>
                    {billTo.address && (
                      <div className="text-[#6B7280] whitespace-pre-line text-[11.5px]">
                        {billTo.address}
                      </div>
                    )}
                    {billTo.email && (
                      <div className="text-[#6B7280] text-[11.5px]">{billTo.email}</div>
                    )}
                  </div>
                ) : (
                  <div className="text-[12px] text-[#9CA3AF] italic">
                    No client linked to project
                  </div>
                )}
              </div>
              <div className="px-3 py-2.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg">
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
                  Project
                </div>
                <div className="text-[12.5px] text-[#111] font-medium">
                  {projectName || '—'}
                </div>
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                  Line items
                </div>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1 text-[11.5px] text-[#2563EB] hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" /> Add line item
                </button>
              </div>

              <div className="grid grid-cols-[1fr_60px_60px_90px_90px_24px] gap-2 px-2 py-1.5 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold border-b border-[#E5E7EB]">
                <div>Description</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Unit</div>
                <div className="text-right">Rate</div>
                <div className="text-right">Amount</div>
                <div></div>
              </div>
              {lineItems.length === 0 && (
                <div className="px-3 py-4 text-center text-[12px] text-[#9CA3AF] italic">
                  No line items.
                </div>
              )}
              {lineItems.map((li, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_60px_60px_90px_90px_24px] gap-2 px-2 py-1.5 items-center border-b border-[#F3F4F6]"
                >
                  <input
                    type="text"
                    value={li.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    placeholder="Description"
                    className="text-[12px] bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none"
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={li.quantity}
                    onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })}
                    className="text-[12px] font-mono tabular-nums text-right bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none"
                  />
                  <input
                    type="text"
                    value={li.unit ?? ''}
                    onChange={(e) =>
                      updateLine(i, { unit: e.target.value.trim() === '' ? null : e.target.value })
                    }
                    placeholder="—"
                    className="text-[12px] text-right bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none"
                  />
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={li.unit_price}
                    onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) || 0 })}
                    className="text-[12px] font-mono tabular-nums text-right bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none"
                  />
                  <div className="text-[12px] font-mono tabular-nums text-right text-[#111]">
                    ${(li.quantity * li.unit_price).toFixed(2)}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded"
                    title="Remove line"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Totals + tax */}
            <div className="ml-auto w-full max-w-[280px] text-[12.5px] space-y-1">
              <Row label="Subtotal" value={`$${totals.subtotal.toFixed(2)}`} />
              <div className="flex items-center justify-between">
                <div className="text-[#6B7280]">
                  Tax %{' '}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={taxPct}
                    onChange={(e) => setTaxPct(Number(e.target.value) || 0)}
                    className="ml-1 w-14 text-right px-1.5 py-0.5 text-[12px] font-mono border border-[#E5E7EB] rounded outline-none focus:border-[#2563EB]"
                  />
                </div>
                <div className="font-mono tabular-nums">
                  ${totals.tax_amount.toFixed(2)}
                </div>
              </div>
              <Row label="Total" value={`$${totals.total.toFixed(2)}`} bold />
            </div>

            {/* Notes */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Notes (visible to client)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
              </Field>
              <Field label="Internal notes">
                <textarea
                  value={internalNotes}
                  onChange={(e) => setInternalNotes(e.target.value)}
                  rows={3}
                  className={`${inputClass} resize-none`}
                />
              </Field>
            </div>

            {error && (
              <div className="px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="px-5 py-3 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSave(false)}
            disabled={saving || loading}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save as draft'}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving || loading}
            className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save & mark sent'}
          </button>
        </div>
      </div>

      {pickerOpen && projectId && (
        <AddLineItemPicker
          projectId={projectId}
          onClose={() => setPickerOpen(false)}
          onPick={appendSeeds}
        />
      )}
    </div>
  )
}

const inputClass =
  'w-full px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
        {label}
      </div>
      {children}
    </label>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className={bold ? 'text-[#111] font-semibold' : 'text-[#6B7280]'}>{label}</div>
      <div
        className={`font-mono tabular-nums ${
          bold ? 'text-[#111] font-semibold' : 'text-[#111]'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
