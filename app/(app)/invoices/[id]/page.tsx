'use client'

// ============================================================================
// /invoices/[id] — invoice detail
// ============================================================================
// Two view modes — Edit (default for any status, but inputs enabled
// only on draft) and Preview (renders the same layout that PR-2 will
// emit as PDF). Preview is throwaway scaffolding so operators can
// sanity-check the look-and-feel before PDF wiring lands.
//
// PR-1 actions: Mark as sent (draft → sent), Void (anything except
// void). PR-2 wires Download PDF; PR-3 wires Record payment.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, Eye, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import {
  getInvoice,
  isOverdue,
  markInvoiceSent,
  recomputeInvoiceTotals,
  updateInvoice,
  updateInvoiceLineItems,
  voidInvoice,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  type Invoice,
  type InvoiceLineItem,
  type InvoicePayment,
  type InvoiceStatus,
} from '@/lib/invoices'
import { supabase } from '@/lib/supabase'

interface DraftLine {
  id?: string
  description: string
  quantity: number
  unit: string | null
  unit_price: number
  source_type: InvoiceLineItem['source_type']
  source_id: string | null
}

interface OrgInvoiceHeader {
  name: string
  business_address: string | null
  business_city: string | null
  business_state: string | null
  business_zip: string | null
  business_phone: string | null
  business_email: string | null
}

interface ProjectInfo {
  id: string
  name: string
}

interface ClientInfo {
  name: string
  address: string | null
  email: string | null
  phone: string | null
}

export default function InvoiceDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { user } = useAuth()
  const { confirm } = useConfirm()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<InvoicePayment[]>([])
  const [orgHeader, setOrgHeader] = useState<OrgInvoiceHeader | null>(null)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [client, setClient] = useState<ClientInfo | null>(null)

  // Editable buffer — mirrors the persisted invoice when status='draft'
  // and bumps to dirty as the operator edits.
  const [lines, setLines] = useState<DraftLine[]>([])
  const [taxPct, setTaxPct] = useState(0)
  const [notes, setNotes] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [dirty, setDirty] = useState(false)

  const [view, setView] = useState<'edit' | 'preview'>('edit')

  useEffect(() => {
    if (!id || !user?.org_id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const data = await getInvoice(id)
        if (!data) {
          setError('Invoice not found.')
          return
        }
        if (cancelled) return
        setInvoice(data.invoice)
        setPayments(data.payments)
        setLines(
          data.lineItems.map((li) => ({
            id: li.id,
            description: li.description,
            quantity: li.quantity,
            unit: li.unit,
            unit_price: li.unit_price,
            source_type: li.source_type,
            source_id: li.source_id,
          })),
        )
        setTaxPct(data.invoice.tax_pct)
        setNotes(data.invoice.notes ?? '')
        setInternalNotes(data.invoice.internal_notes ?? '')
        setDueDate(data.invoice.due_date)
        setInvoiceDate(data.invoice.invoice_date)
        setDirty(false)

        // Org header for the bill-from block + preview.
        const { data: org } = await supabase
          .from('orgs')
          .select(
            'name, business_address, business_city, business_state, business_zip, business_phone, business_email',
          )
          .eq('id', user.org_id)
          .single()
        if (!cancelled && org) setOrgHeader(org as OrgInvoiceHeader)

        const { data: proj } = await supabase
          .from('projects')
          .select('id, name')
          .eq('id', data.invoice.project_id)
          .single()
        if (!cancelled && proj) setProject(proj as ProjectInfo)

        if (data.invoice.client_id) {
          const { data: cli } = await supabase
            .from('clients')
            .select('name, address, email, phone')
            .eq('id', data.invoice.client_id)
            .single()
          if (!cancelled && cli) setClient(cli as ClientInfo)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load invoice')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id, user?.org_id])

  const totals = useMemo(
    () =>
      recomputeInvoiceTotals(
        lines.map((li) => ({
          quantity: li.quantity,
          unit_price: li.unit_price,
          amount: li.quantity * li.unit_price,
        })),
        taxPct,
      ),
    [lines, taxPct],
  )

  const balance = useMemo(() => {
    const total = totals.total
    const received = invoice?.amount_received ?? 0
    return +(total - received).toFixed(2)
  }, [totals.total, invoice?.amount_received])

  const isDraft = invoice?.status === 'draft'
  const isVoid = invoice?.status === 'void'
  const displayStatus: InvoiceStatus | null = invoice
    ? isOverdue(invoice)
      ? 'overdue'
      : invoice.status
    : null

  function updateLine(i: number, patch: Partial<DraftLine>) {
    setLines((prev) => {
      const next = prev.slice()
      next[i] = { ...next[i], ...patch }
      return next
    })
    setDirty(true)
  }

  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
    setDirty(true)
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      {
        description: '',
        quantity: 1,
        unit: null,
        unit_price: 0,
        source_type: 'custom',
        source_id: null,
      },
    ])
    setDirty(true)
  }

  async function handleSaveDraft() {
    if (!invoice) return
    if (lines.some((li) => !li.description.trim())) {
      setError('Every line item needs a description')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updateInvoiceLineItems(
        invoice.id,
        lines.map((li, i) => ({
          sort_order: i,
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          unit_price: li.unit_price,
          amount: +(li.quantity * li.unit_price).toFixed(2),
          source_type: li.source_type,
          source_id: li.source_id,
        })),
        taxPct,
      )
      await updateInvoice(invoice.id, {
        invoice_date: invoiceDate,
        due_date: dueDate,
        notes: notes || null,
        internal_notes: internalNotes || null,
      })
      const refreshed = await getInvoice(invoice.id)
      if (refreshed) {
        setInvoice(refreshed.invoice)
        setLines(
          refreshed.lineItems.map((li) => ({
            id: li.id,
            description: li.description,
            quantity: li.quantity,
            unit: li.unit,
            unit_price: li.unit_price,
            source_type: li.source_type,
            source_id: li.source_id,
          })),
        )
      }
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkSent() {
    if (!invoice) return
    if (dirty) {
      const proceed = await confirm({
        title: 'Save changes first?',
        message: 'Save the current edits as part of the sent invoice?',
        confirmLabel: 'Save & send',
      })
      if (!proceed) return
      await handleSaveDraft()
    }
    setSaving(true)
    setError(null)
    try {
      const sent = await markInvoiceSent(invoice.id)
      if (sent) setInvoice(sent)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark sent')
    } finally {
      setSaving(false)
    }
  }

  async function handleVoid() {
    if (!invoice) return
    const ok = await confirm({
      title: 'Void this invoice?',
      message: `Voiding ${invoice.invoice_number} marks it cancelled. The record stays for audit; balance no longer counts toward AR. This can't be undone.`,
      confirmLabel: 'Void invoice',
      variant: 'danger',
    })
    if (!ok) return
    setSaving(true)
    try {
      await voidInvoice(invoice.id)
      const refreshed = await getInvoice(invoice.id)
      if (refreshed) setInvoice(refreshed.invoice)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to void')
    } finally {
      setSaving(false)
    }
  }

  if (!id) return null

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <Nav />
        <div className="p-8 text-sm text-[#6B7280]">Loading invoice…</div>
      </div>
    )
  }

  if (error && !invoice) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <Nav />
        <div className="p-8 text-sm text-[#DC2626]">{error}</div>
      </div>
    )
  }

  if (!invoice) return null

  const tone = displayStatus ? INVOICE_STATUS_TONE[displayStatus] : null

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Nav />
      <div className="p-6 max-w-[1100px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => router.push('/invoices')}
            className="text-[12px] text-[#6B7280] hover:text-[#111] inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Invoices
          </button>
        </div>
        <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold text-[#111] font-mono">
              {invoice.invoice_number}
            </h1>
            {tone && displayStatus && (
              <span
                className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
                style={{ backgroundColor: tone.bg, color: tone.fg }}
              >
                {INVOICE_STATUS_LABEL[displayStatus]}
              </span>
            )}
            {project && (
              <Link
                href={`/projects/${project.id}`}
                className="text-[13px] text-[#2563EB] hover:underline"
              >
                {project.name}
              </Link>
            )}
          </div>

          {/* Action bar */}
          <div className="flex items-center gap-2">
            <div className="inline-flex bg-white border border-[#E5E7EB] rounded-lg p-0.5">
              <button
                onClick={() => setView('edit')}
                className={`px-2.5 py-1 text-[12px] rounded-md inline-flex items-center gap-1 ${
                  view === 'edit'
                    ? 'bg-[#111] text-white'
                    : 'text-[#6B7280] hover:text-[#111]'
                }`}
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              <button
                onClick={() => setView('preview')}
                className={`px-2.5 py-1 text-[12px] rounded-md inline-flex items-center gap-1 ${
                  view === 'preview'
                    ? 'bg-[#111] text-white'
                    : 'text-[#6B7280] hover:text-[#111]'
                }`}
              >
                <Eye className="w-3 h-3" /> Preview
              </button>
            </div>
            {isDraft && dirty && (
              <button
                onClick={handleSaveDraft}
                disabled={saving}
                className="px-3 py-1.5 text-[12px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save draft'}
              </button>
            )}
            {isDraft && (
              <button
                onClick={handleMarkSent}
                disabled={saving}
                className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" /> Mark as sent
              </button>
            )}
            {!isVoid && (
              <button
                onClick={handleVoid}
                disabled={saving}
                className="px-3 py-1.5 text-[12px] text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <X className="w-3.5 h-3.5" /> Void
              </button>
            )}
            <button
              disabled
              title="PDF download lands in PR-2"
              className="px-3 py-1.5 text-[12px] text-[#9CA3AF] border border-[#E5E7EB] rounded-md inline-flex items-center gap-1.5 cursor-not-allowed"
            >
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
            {error}
          </div>
        )}

        {view === 'preview' ? (
          <InvoicePreview
            invoice={invoice}
            lines={lines}
            taxPct={taxPct}
            totals={totals}
            balance={balance}
            notes={notes}
            orgHeader={orgHeader}
            project={project}
            client={client}
          />
        ) : (
          <EditView
            invoice={invoice}
            isDraft={isDraft}
            client={client}
            project={project}
            invoiceDate={invoiceDate}
            setInvoiceDate={(v) => {
              setInvoiceDate(v)
              setDirty(true)
            }}
            dueDate={dueDate}
            setDueDate={(v) => {
              setDueDate(v)
              setDirty(true)
            }}
            lines={lines}
            updateLine={updateLine}
            removeLine={removeLine}
            addLine={addLine}
            taxPct={taxPct}
            setTaxPct={(v) => {
              setTaxPct(v)
              setDirty(true)
            }}
            totals={totals}
            balance={balance}
            payments={payments}
            notes={notes}
            setNotes={(v) => {
              setNotes(v)
              setDirty(true)
            }}
            internalNotes={internalNotes}
            setInternalNotes={(v) => {
              setInternalNotes(v)
              setDirty(true)
            }}
          />
        )}
      </div>
    </div>
  )
}

// ── Edit view ────────────────────────────────────────────────────────────

function EditView(props: {
  invoice: Invoice
  isDraft: boolean
  client: ClientInfo | null
  project: ProjectInfo | null
  invoiceDate: string
  setInvoiceDate: (v: string) => void
  dueDate: string
  setDueDate: (v: string) => void
  lines: DraftLine[]
  updateLine: (i: number, patch: Partial<DraftLine>) => void
  removeLine: (i: number) => void
  addLine: () => void
  taxPct: number
  setTaxPct: (v: number) => void
  totals: { subtotal: number; tax_amount: number; total: number }
  balance: number
  payments: InvoicePayment[]
  notes: string
  setNotes: (v: string) => void
  internalNotes: string
  setInternalNotes: (v: string) => void
}) {
  const {
    invoice,
    isDraft,
    client,
    project,
    invoiceDate,
    setInvoiceDate,
    dueDate,
    setDueDate,
    lines,
    updateLine,
    removeLine,
    addLine,
    taxPct,
    setTaxPct,
    totals,
    balance,
    payments,
    notes,
    setNotes,
    internalNotes,
    setInternalNotes,
  } = props
  return (
    <div className="space-y-5">
      {/* Header info */}
      <div className="grid grid-cols-3 gap-3">
        <Field label="Invoice date">
          <input
            type="date"
            value={invoiceDate}
            disabled={!isDraft}
            onChange={(e) => setInvoiceDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Due date">
          <input
            type="date"
            value={dueDate}
            disabled={!isDraft}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Created">
          <div className="px-2.5 py-1.5 text-[13px] text-[#6B7280]">
            {fmtDate(invoice.created_at.slice(0, 10))}
          </div>
        </Field>
      </div>

      {/* Bill to + Project */}
      <div className="grid grid-cols-2 gap-3">
        <div className="px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-lg">
          <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Bill to
          </div>
          {client ? (
            <div className="text-[12.5px] text-[#111] leading-relaxed">
              <div className="font-medium">{client.name}</div>
              {client.address && (
                <div className="text-[#6B7280] whitespace-pre-line text-[11.5px]">
                  {client.address}
                </div>
              )}
              {client.email && (
                <div className="text-[#6B7280] text-[11.5px]">{client.email}</div>
              )}
              {client.phone && (
                <div className="text-[#6B7280] text-[11.5px]">{client.phone}</div>
              )}
            </div>
          ) : (
            <div className="text-[12px] text-[#9CA3AF] italic">No client linked</div>
          )}
        </div>
        <div className="px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-lg">
          <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Project
          </div>
          <div className="text-[12.5px] text-[#111] font-medium">
            {project?.name ?? '—'}
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 flex items-center justify-between border-b border-[#E5E7EB]">
          <div className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
            Line items
          </div>
          {isDraft && (
            <button
              type="button"
              onClick={addLine}
              className="inline-flex items-center gap-1 text-[11.5px] text-[#2563EB] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Add line item
            </button>
          )}
        </div>
        <div className="grid grid-cols-[1fr_60px_60px_90px_90px_24px] gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold border-b border-[#F3F4F6] bg-[#F9FAFB]">
          <div>Description</div>
          <div className="text-right">Qty</div>
          <div className="text-right">Unit</div>
          <div className="text-right">Rate</div>
          <div className="text-right">Amount</div>
          <div></div>
        </div>
        {lines.length === 0 ? (
          <div className="px-4 py-6 text-center text-[12px] text-[#9CA3AF] italic">
            No line items.
          </div>
        ) : (
          lines.map((li, i) => (
            <div
              key={li.id ?? `new-${i}`}
              className="grid grid-cols-[1fr_60px_60px_90px_90px_24px] gap-2 px-4 py-1.5 items-center border-b border-[#F3F4F6] last:border-b-0"
            >
              <input
                type="text"
                value={li.description}
                disabled={!isDraft}
                onChange={(e) => updateLine(i, { description: e.target.value })}
                placeholder="Description"
                className="text-[12.5px] bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none disabled:cursor-default"
              />
              <input
                type="number"
                min={0}
                step="any"
                value={li.quantity}
                disabled={!isDraft}
                onChange={(e) => updateLine(i, { quantity: Number(e.target.value) || 0 })}
                className="text-[12px] font-mono tabular-nums text-right bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none disabled:cursor-default"
              />
              <input
                type="text"
                value={li.unit ?? ''}
                disabled={!isDraft}
                onChange={(e) =>
                  updateLine(i, { unit: e.target.value.trim() === '' ? null : e.target.value })
                }
                placeholder="—"
                className="text-[12px] text-right bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none disabled:cursor-default"
              />
              <input
                type="number"
                min={0}
                step="any"
                value={li.unit_price}
                disabled={!isDraft}
                onChange={(e) => updateLine(i, { unit_price: Number(e.target.value) || 0 })}
                className="text-[12px] font-mono tabular-nums text-right bg-transparent border border-transparent focus:border-[#2563EB] focus:bg-white hover:border-[#E5E7EB] rounded px-1.5 py-1 outline-none disabled:cursor-default"
              />
              <div className="text-[12.5px] font-mono tabular-nums text-right text-[#111]">
                ${(li.quantity * li.unit_price).toFixed(2)}
              </div>
              {isDraft ? (
                <button
                  type="button"
                  onClick={() => removeLine(i)}
                  className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded"
                  title="Remove line"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ) : (
                <div></div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Totals */}
      <div className="ml-auto w-full max-w-[320px] text-[13px] space-y-1 px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-xl">
        <Row label="Subtotal" value={`$${totals.subtotal.toFixed(2)}`} />
        <div className="flex items-center justify-between">
          <div className="text-[#6B7280]">
            Tax %{' '}
            <input
              type="number"
              min={0}
              step="any"
              value={taxPct}
              disabled={!isDraft}
              onChange={(e) => setTaxPct(Number(e.target.value) || 0)}
              className="ml-1 w-14 text-right px-1.5 py-0.5 text-[12px] font-mono border border-[#E5E7EB] rounded outline-none focus:border-[#2563EB] disabled:bg-transparent disabled:border-transparent"
            />
          </div>
          <div className="font-mono tabular-nums">${totals.tax_amount.toFixed(2)}</div>
        </div>
        <div className="border-t border-[#E5E7EB] my-1" />
        <Row label="Total" value={`$${totals.total.toFixed(2)}`} bold />
        <Row
          label="Received"
          value={`$${invoice.amount_received.toFixed(2)}`}
          dim
        />
        <Row label="Balance due" value={`$${balance.toFixed(2)}`} bold />
      </div>

      {/* Payments stub */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E5E7EB] text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
          Payments
        </div>
        <div className="px-4 py-4 text-[12px] text-[#9CA3AF] italic">
          {payments.length === 0
            ? 'No payments recorded — manual recording lands in the next release.'
            : `${payments.length} payment${payments.length === 1 ? '' : 's'} recorded (read-only until PR-3 wires the modal).`}
        </div>
      </div>

      {/* Notes */}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Notes (visible to client)">
          <textarea
            value={notes}
            disabled={!isDraft}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </Field>
        <Field label="Internal notes">
          <textarea
            value={internalNotes}
            disabled={!isDraft}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
          />
        </Field>
      </div>
    </div>
  )
}

// ── Preview view ─────────────────────────────────────────────────────────

function InvoicePreview({
  invoice,
  lines,
  taxPct,
  totals,
  balance,
  notes,
  orgHeader,
  project,
  client,
}: {
  invoice: Invoice
  lines: DraftLine[]
  taxPct: number
  totals: { subtotal: number; tax_amount: number; total: number }
  balance: number
  notes: string
  orgHeader: OrgInvoiceHeader | null
  project: ProjectInfo | null
  client: ClientInfo | null
}) {
  const cityLine = orgHeader
    ? [orgHeader.business_city, orgHeader.business_state, orgHeader.business_zip]
        .filter(Boolean)
        .join(orgHeader.business_state ? ', ' : ' ')
    : ''
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-sm p-10 max-w-[820px] mx-auto">
      <div className="flex items-start justify-between gap-6 mb-8">
        <div>
          <div className="text-[18px] font-semibold text-[#111]">
            {orgHeader?.name || 'Your Company'}
          </div>
          {orgHeader?.business_address && (
            <div className="text-[12px] text-[#6B7280]">{orgHeader.business_address}</div>
          )}
          {cityLine && <div className="text-[12px] text-[#6B7280]">{cityLine}</div>}
          {orgHeader?.business_phone && (
            <div className="text-[12px] text-[#6B7280]">{orgHeader.business_phone}</div>
          )}
          {orgHeader?.business_email && (
            <div className="text-[12px] text-[#6B7280]">{orgHeader.business_email}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-[24px] font-bold tracking-wider text-[#111]">INVOICE</div>
          <div className="text-[12.5px] text-[#374151] font-mono mt-1">
            {invoice.invoice_number}
          </div>
          <div className="text-[11.5px] text-[#6B7280] mt-2">
            <div>Date: {fmtDate(invoice.invoice_date)}</div>
            <div>Due: {fmtDate(invoice.due_date)}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-8">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Bill to
          </div>
          {client ? (
            <div className="text-[12.5px] text-[#111] leading-relaxed">
              <div className="font-medium">{client.name}</div>
              {client.address && (
                <div className="text-[#6B7280] whitespace-pre-line">{client.address}</div>
              )}
              {client.email && <div className="text-[#6B7280]">{client.email}</div>}
              {client.phone && <div className="text-[#6B7280]">{client.phone}</div>}
            </div>
          ) : (
            <div className="text-[12px] text-[#9CA3AF] italic">—</div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
            Project
          </div>
          <div className="text-[12.5px] text-[#111] font-medium">{project?.name ?? '—'}</div>
        </div>
      </div>

      <div className="border-t border-[#111] pt-2 mb-1">
        <div className="grid grid-cols-[1fr_60px_60px_90px_90px] gap-3 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold pb-2">
          <div>Description</div>
          <div className="text-right">Qty</div>
          <div className="text-right">Unit</div>
          <div className="text-right">Rate</div>
          <div className="text-right">Amount</div>
        </div>
      </div>
      {lines.map((li, i) => (
        <div
          key={i}
          className="grid grid-cols-[1fr_60px_60px_90px_90px] gap-3 py-1.5 text-[12.5px] text-[#111] border-b border-[#F3F4F6]"
        >
          <div>{li.description}</div>
          <div className="text-right font-mono tabular-nums">{li.quantity}</div>
          <div className="text-right">{li.unit ?? '—'}</div>
          <div className="text-right font-mono tabular-nums">${li.unit_price.toFixed(2)}</div>
          <div className="text-right font-mono tabular-nums">
            ${(li.quantity * li.unit_price).toFixed(2)}
          </div>
        </div>
      ))}

      <div className="ml-auto w-full max-w-[300px] mt-4 text-[13px] space-y-1">
        <Row label="Subtotal" value={`$${totals.subtotal.toFixed(2)}`} />
        <Row label={`Tax (${taxPct}%)`} value={`$${totals.tax_amount.toFixed(2)}`} />
        <div className="border-t border-[#111] my-1" />
        <Row label="Total" value={`$${totals.total.toFixed(2)}`} bold />
        <Row
          label="Received"
          value={`$${invoice.amount_received.toFixed(2)}`}
          dim
        />
        <Row label="Balance due" value={`$${balance.toFixed(2)}`} bold />
      </div>

      {notes && (
        <div className="mt-8 pt-4 border-t border-[#E5E7EB] text-[12px] text-[#374151] leading-relaxed whitespace-pre-line">
          {notes}
        </div>
      )}
    </div>
  )
}

// ── Tiny shared helpers ──────────────────────────────────────────────────

const inputClass =
  'w-full px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:bg-[#F9FAFB] disabled:text-[#6B7280]'

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

function Row({
  label,
  value,
  bold,
  dim,
}: {
  label: string
  value: string
  bold?: boolean
  dim?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <div className={bold ? 'text-[#111] font-semibold' : dim ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}>
        {label}
      </div>
      <div
        className={`font-mono tabular-nums ${
          bold ? 'text-[#111] font-semibold' : dim ? 'text-[#9CA3AF]' : 'text-[#111]'
        }`}
      >
        {value}
      </div>
    </div>
  )
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00Z')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
