'use client'

// ============================================================================
// SendInvoiceModal — preview, copy email, mark sent
// ============================================================================
// Two-step send flow on purpose: download / copy → paste into the
// operator's actual email client → return and click "Mark as sent."
// Friction is intentional. The status flip means the operator
// confirms the email actually went out.
//
// Email template substitution happens at modal open. Variables
// supported: ${invoice_number}, ${client_name}, ${project_name},
// ${total}, ${due_date}, ${org_name}. Edits to the textarea are
// per-instance — no per-invoice persistence. PR-2 doesn't ship
// in-app email send; that's V2.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Copy, Download, Send, X } from 'lucide-react'
import {
  markInvoiceSent,
  type Invoice,
  type InvoiceLineItem,
  type InvoicePayment,
} from '@/lib/invoices'
import { downloadInvoicePdf } from '@/lib/invoice-pdf'
import type { InvoicePdfProps } from './InvoicePdf'

// react-pdf's <PDFViewer> uses browser-only APIs (CanvasRenderingContext,
// PostMessage). Dynamic-import with ssr:false keeps the bundle off the
// server-rendered initial paint. Same trick the spec calls for.
const PdfViewerLazy = dynamic(
  () => import('./InvoicePdfViewer').then((m) => m.InvoicePdfViewer),
  { ssr: false, loading: () => <PreviewPlaceholder>Rendering preview…</PreviewPlaceholder> },
)

interface OrgHeader {
  name: string
  business_address: string | null
  business_city: string | null
  business_state: string | null
  business_zip: string | null
  business_phone: string | null
  business_email: string | null
}

interface ProjectInfo {
  name: string
}

interface ClientInfo {
  name: string
  address: string | null
  email: string | null
  phone: string | null
}

const DEFAULT_TEMPLATE =
  `Hi \${client_name},\n\n` +
  `Attached is invoice \${invoice_number} for \${project_name}, total \${total}, due \${due_date}.\n\n` +
  `Let me know if you have any questions.\n\n` +
  `Thanks,\n\${org_name}`

function fmt$(n: number): string {
  return `$${(n || 0).toFixed(2)}`
}
function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00Z')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function substitute(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\$\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}

export default function SendInvoiceModal({
  invoice,
  lineItems,
  payments,
  org,
  project,
  client,
  emailTemplateOverride,
  onClose,
  onSent,
}: {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  payments: InvoicePayment[]
  org: OrgHeader
  project: ProjectInfo | null
  client: ClientInfo | null
  /** Org-level template body from orgs.invoice_email_template. When
   *  null, the modal falls back to DEFAULT_TEMPLATE. */
  emailTemplateOverride: string | null
  onClose: () => void
  onSent: (invoice: Invoice) => void
}) {
  const baseTemplate = emailTemplateOverride && emailTemplateOverride.trim().length > 0
    ? emailTemplateOverride
    : DEFAULT_TEMPLATE

  const seedSubject = `Invoice ${invoice.invoice_number}${project ? ` — ${project.name}` : ''}`

  const seedBody = useMemo(() => {
    return substitute(baseTemplate, {
      invoice_number: invoice.invoice_number,
      client_name: client?.name || 'there',
      project_name: project?.name || 'your project',
      total: fmt$(invoice.total),
      due_date: fmtDate(invoice.due_date),
      org_name: org.name,
    })
  }, [baseTemplate, invoice.invoice_number, invoice.total, invoice.due_date, client?.name, project?.name, org.name])

  const [subject, setSubject] = useState(seedSubject)
  const [body, setBody] = useState(seedBody)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [downloading, setDownloading] = useState(false)
  const [marking, setMarking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (copyState === 'idle') return
    const t = setTimeout(() => setCopyState('idle'), 2400)
    return () => clearTimeout(t)
  }, [copyState])

  const pdfProps: InvoicePdfProps = {
    invoice,
    lineItems,
    payments,
    org,
    project,
    client,
  }

  async function handleDownload() {
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

  async function handleCopy() {
    const composed = `Subject: ${subject}\n\n${body}`
    try {
      await navigator.clipboard.writeText(composed)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  async function handleMarkSent() {
    setError(null)
    setMarking(true)
    try {
      const sent = await markInvoiceSent(invoice.id)
      if (sent) onSent(sent)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark sent')
    } finally {
      setMarking(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[#111]">
              Send invoice
            </h3>
            <p className="text-[11.5px] text-[#9CA3AF] mt-0.5">
              Download, paste the email into your client, then mark sent.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#9CA3AF] hover:text-[#111] p-1"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1 space-y-4">
          {/* PDF preview embed */}
          <div className="border border-[#E5E7EB] rounded-lg overflow-hidden bg-[#F3F4F6]">
            <PdfViewerLazy pdfProps={pdfProps} height={320} />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="px-3 py-1.5 text-[12.5px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              {downloading ? 'Generating…' : 'Download PDF'}
            </button>
            <span className="text-[11.5px] text-[#9CA3AF]">
              Opens in a new tab. Save and attach to the email below.
            </span>
          </div>

          {/* Email subject + body */}
          <div className="space-y-2">
            <label className="block">
              <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">
                Subject
              </div>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              />
            </label>
            <label className="block">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                  Email body
                </div>
                <span className="text-[10.5px] text-[#9CA3AF]">
                  Edits don't persist — set a default in Settings → Invoicing
                </span>
              </div>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="w-full px-2.5 py-1.5 text-[13px] bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] resize-none font-mono"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-[12.5px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                {copyState === 'copied'
                  ? 'Copied!'
                  : copyState === 'error'
                    ? 'Copy failed'
                    : 'Copy email + subject'}
              </button>
              {copyState === 'copied' && (
                <span className="text-[11.5px] text-[#059669]">
                  Paste into Gmail/Outlook/Mail.app and attach the PDF.
                </span>
              )}
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={marking}
            className="px-3 py-1.5 text-[12.5px] text-[#374151] hover:bg-[#F3F4F6] rounded-md disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleMarkSent}
            disabled={marking}
            className="px-3 py-1.5 text-[12.5px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Send className="w-3.5 h-3.5" />
            {marking ? 'Marking…' : 'Mark as sent'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PreviewPlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center h-[320px] text-[12px] text-[#9CA3AF] italic">
      {children}
    </div>
  )
}
