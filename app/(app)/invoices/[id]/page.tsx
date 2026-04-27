'use client'

// ============================================================================
// /invoices/[id] — invoice detail
// ============================================================================
// Two view modes — Edit (inline editable line items + tax + notes when
// status='draft') and Preview (live react-pdf <PDFViewer> rendering of
// the same layout the API route compiles to a downloadable PDF).
//
// PR-2 actions: Send invoice (draft → opens SendInvoiceModal which
// flips status to 'sent'), Download PDF (regenerates + opens in new
// tab), Void (anything except void). PR-3 wires Record payment.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CreditCard,
  Download,
  Eye,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import {
  getInvoice,
  isOverdue,
  recomputeInvoiceTotals,
  updateInvoice,
  updateInvoiceLineItems,
  voidInvoice,
  voidInvoicePayment,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  type Invoice,
  type InvoiceLineItem,
  type InvoicePayment,
  type InvoiceStatus,
} from '@/lib/invoices'
import { downloadInvoicePdf } from '@/lib/invoice-pdf'
import SendInvoiceModal from '@/components/invoices/SendInvoiceModal'
import RecordPaymentModal from '@/components/invoices/RecordPaymentModal'
import { supabase } from '@/lib/supabase'

// react-pdf's <PDFViewer> needs to be client-only. The viewer file
// imports react-pdf's browser entry, which trips SSR if loaded
// directly. next/dynamic with ssr:false defers it to first paint.
const InvoicePdfViewerLazy = dynamic(
  () =>
    import('@/components/invoices/InvoicePdfViewer').then(
      (m) => m.InvoicePdfViewer,
    ),
  { ssr: false, loading: () => <PreviewLoading /> },
)

function PreviewLoading() {
  return (
    <div className="flex items-center justify-center h-[800px] text-[12.5px] text-[#9CA3AF] italic">
      Rendering preview…
    </div>
  )
}

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
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [emailTemplate, setEmailTemplate] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  // Record-payment modal: null = closed, an empty object = create
  // mode, an InvoicePayment row = edit mode for that row.
  const [paymentModal, setPaymentModal] = useState<
    { mode: 'create' } | { mode: 'edit'; payment: InvoicePayment } | null
  >(null)

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

        // Org header for the bill-from block + preview. Includes the
        // email template body so SendInvoiceModal can prefill without
        // a second round-trip.
        const { data: org } = await supabase
          .from('orgs')
          .select(
            'name, business_address, business_city, business_state, business_zip, business_phone, business_email, invoice_email_template',
          )
          .eq('id', user.org_id)
          .single()
        if (!cancelled && org) {
          setOrgHeader(org as OrgInvoiceHeader)
          setEmailTemplate((org as any).invoice_email_template ?? null)
        }

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

  async function openSendModal() {
    if (!invoice) return
    if (dirty) {
      const proceed = await confirm({
        title: 'Save changes first?',
        message: 'Save the current edits before sending?',
        confirmLabel: 'Save & continue',
      })
      if (!proceed) return
      await handleSaveDraft()
    }
    setSendModalOpen(true)
  }

  async function handleDownloadPdf() {
    if (!invoice) return
    setError(null)
    setDownloading(true)
    try {
      await downloadInvoicePdf(invoice.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate PDF')
    } finally {
      setDownloading(false)
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
                onClick={openSendModal}
                disabled={saving}
                className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" /> Send invoice
              </button>
            )}
            {(invoice.status === 'sent' ||
              invoice.status === 'partial' ||
              isOverdue(invoice)) && (
              <button
                onClick={() => setPaymentModal({ mode: 'create' })}
                className="px-3 py-1.5 text-[12px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5"
              >
                <CreditCard className="w-3.5 h-3.5" /> Record payment
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
              onClick={handleDownloadPdf}
              disabled={downloading}
              className="px-3 py-1.5 text-[12px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Generating…' : 'PDF'}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
            {error}
          </div>
        )}

        {view === 'preview' ? (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
            <InvoicePdfViewerLazy
              pdfProps={{
                invoice: {
                  ...invoice,
                  invoice_date: invoiceDate || invoice.invoice_date,
                  due_date: dueDate || invoice.due_date,
                  notes,
                  tax_pct: taxPct,
                  subtotal: totals.subtotal,
                  tax_amount: totals.tax_amount,
                  total: totals.total,
                },
                lineItems: lines.map((li, i) => ({
                  id: li.id ?? `draft-${i}`,
                  invoice_id: invoice.id,
                  sort_order: i,
                  description: li.description,
                  quantity: li.quantity,
                  unit: li.unit,
                  unit_price: li.unit_price,
                  amount: +(li.quantity * li.unit_price).toFixed(2),
                  source_type: li.source_type,
                  source_id: li.source_id,
                })),
                payments,
                org: orgHeader ?? { name: '' },
                project,
                client,
              }}
              height={800}
            />
          </div>
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
            onRecordPayment={() => setPaymentModal({ mode: 'create' })}
            onEditPayment={(p) => setPaymentModal({ mode: 'edit', payment: p })}
            onVoidPayment={async (p) => {
              const ok = await confirm({
                title: 'Void this payment?',
                message: `Removes the ${p.payment_method ?? 'payment'} of $${p.amount.toFixed(2)} on ${p.payment_date}. The invoice's balance and status recalc; if it was paid, the linked milestone reverts to invoiced.`,
                confirmLabel: 'Void payment',
                variant: 'danger',
              })
              if (!ok) return
              try {
                const updated = await voidInvoicePayment(p.id)
                setInvoice(updated)
                const refreshed = await getInvoice(updated.id)
                if (refreshed) setPayments(refreshed.payments)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Failed to void payment')
              }
            }}
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

      {sendModalOpen && orgHeader && (
        <SendInvoiceModal
          invoice={invoice}
          lineItems={lines.map((li, i) => ({
            id: li.id ?? `draft-${i}`,
            invoice_id: invoice.id,
            sort_order: i,
            description: li.description,
            quantity: li.quantity,
            unit: li.unit,
            unit_price: li.unit_price,
            amount: +(li.quantity * li.unit_price).toFixed(2),
            source_type: li.source_type,
            source_id: li.source_id,
          }))}
          payments={payments}
          org={orgHeader}
          project={project}
          client={client}
          emailTemplateOverride={emailTemplate}
          onClose={() => setSendModalOpen(false)}
          onSent={(updated) => {
            setSendModalOpen(false)
            setInvoice(updated)
          }}
        />
      )}

      {paymentModal && (
        <RecordPaymentModal
          invoice={invoice}
          payment={paymentModal.mode === 'edit' ? paymentModal.payment : null}
          onClose={() => setPaymentModal(null)}
          onSaved={async (updated) => {
            setPaymentModal(null)
            setInvoice(updated)
            // Refresh payments list — recordInvoicePayment / updateInvoicePayment
            // / voidInvoicePayment all return the invoice; payments come
            // from a separate read.
            const refreshed = await getInvoice(updated.id)
            if (refreshed) setPayments(refreshed.payments)
          }}
        />
      )}
    </div>
  )
}

// ── Payments table row ──────────────────────────────────────────────────

function PaymentRow({
  payment,
  onEdit,
  onVoid,
}: {
  payment: InvoicePayment
  onEdit: () => void
  onVoid: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isQbMatched = !!payment.qb_event_id
  return (
    <div
      className="grid grid-cols-[100px_100px_80px_1fr_120px_36px] gap-2 px-4 py-1.5 items-center border-b border-[#F3F4F6] last:border-b-0 text-[12.5px]"
    >
      <div className="font-mono tabular-nums text-[#374151]">
        {fmtDate(payment.payment_date)}
      </div>
      <div className="font-mono tabular-nums text-[#111] text-right">
        ${payment.amount.toFixed(2)}
      </div>
      <div className="text-[#6B7280] capitalize">
        {payment.payment_method ?? '—'}
      </div>
      <div className="text-[#374151] truncate">
        {payment.reference ? (
          <span className="font-mono text-[12px] mr-2">{payment.reference}</span>
        ) : null}
        {payment.notes && (
          <span className="text-[#6B7280] text-[11.5px]">{payment.notes}</span>
        )}
        {!payment.reference && !payment.notes && (
          <span className="text-[#9CA3AF] italic">—</span>
        )}
      </div>
      <div>
        {isQbMatched ? (
          <span className="inline-flex items-center px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider rounded bg-[#DCFCE7] text-[#15803D]">
            QB
          </span>
        ) : (
          <span className="inline-flex items-center px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider rounded bg-[#F3F4F6] text-[#6B7280]">
            Manual
          </span>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
          aria-label="Row actions"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 top-full mt-1 z-10 min-w-[120px] bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1 text-[12.5px]"
            onMouseLeave={() => setMenuOpen(false)}
          >
            {!isQbMatched && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  onEdit()
                }}
                className="w-full px-3 py-1.5 text-left text-[#374151] hover:bg-[#F9FAFB]"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onVoid()
              }}
              className="w-full px-3 py-1.5 text-left text-[#DC2626] hover:bg-[#FEF2F2]"
            >
              Void
            </button>
          </div>
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
  onRecordPayment: () => void
  onEditPayment: (payment: InvoicePayment) => void
  onVoidPayment: (payment: InvoicePayment) => void | Promise<void>
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
    onRecordPayment,
    onEditPayment,
    onVoidPayment,
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

      {/* Payments */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
            Payments
          </div>
          {(invoice.status === 'sent' ||
            invoice.status === 'partial' ||
            isOverdue(invoice)) && (
            <button
              type="button"
              onClick={onRecordPayment}
              className="inline-flex items-center gap-1 text-[11.5px] text-[#2563EB] hover:underline"
            >
              <Plus className="w-3.5 h-3.5" /> Record payment
            </button>
          )}
        </div>
        {payments.length === 0 ? (
          <div className="px-4 py-4 text-[12px] text-[#9CA3AF] italic">
            No payments recorded yet.{' '}
            {invoice.status === 'draft'
              ? 'Send the invoice first.'
              : invoice.status === 'paid'
                ? 'Marked paid without per-payment detail.'
                : 'Click Record payment when one comes in.'}
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[100px_100px_80px_1fr_120px_36px] gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold border-b border-[#F3F4F6] bg-[#F9FAFB]">
              <div>Date</div>
              <div className="text-right">Amount</div>
              <div>Method</div>
              <div>Reference / notes</div>
              <div>Source</div>
              <div></div>
            </div>
            {payments.map((p) => (
              <PaymentRow
                key={p.id}
                payment={p}
                onEdit={() => onEditPayment(p)}
                onVoid={() => onVoidPayment(p)}
              />
            ))}
          </div>
        )}
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
