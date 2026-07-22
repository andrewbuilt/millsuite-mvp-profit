'use client'

// ============================================================================
// /change-orders/[id] — change order detail (like the invoice/estimate detail)
// ============================================================================
// Opens from the CO dashboard. Shows the change (spec original→proposed or
// custom materials), price, drawing flag, and the lifecycle actions (PDF /
// Send / Accept / Decline / Delete) + a link to the rolling CO invoice.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  loadChangeOrder,
  sendCoToClient,
  approveCo,
  rejectCo,
  voidCo,
  type ChangeOrder,
} from '@/lib/change-orders'
import { downloadChangeOrderPdf } from '@/lib/change-order-pdf'

interface Ctx {
  projectName: string | null
  clientName: string | null
  subprojectName: string | null
  coInvoiceNumber: string | null
}

const STATE_TONE: Record<string, { bg: string; fg: string; label: string }> = {
  draft: { bg: '#F3F4F6', fg: '#6B7280', label: 'Draft' },
  sent_to_client: { bg: '#DBEAFE', fg: '#1D4ED8', label: 'Sent' },
  approved: { bg: '#DCFCE7', fg: '#15803D', label: 'Accepted' },
  rejected: { bg: '#FEE2E2', fg: '#B91C1C', label: 'Declined' },
  void: { bg: '#F3F4F6', fg: '#9CA3AF', label: 'Void' },
}

function money(n: number): string {
  const v = Math.round(Math.abs(n || 0)).toLocaleString('en-US')
  return `${n < 0 ? '−' : ''}$${v}`
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ChangeOrderDetailPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [loading, setLoading] = useState(true)
  const [co, setCo] = useState<ChangeOrder | null>(null)
  const [ctx, setCtx] = useState<Ctx>({ projectName: null, clientName: null, subprojectName: null, coInvoiceNumber: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    if (!id) return
    setLoading(true)
    const c = await loadChangeOrder(id)
    setCo(c)
    if (c) {
      const [projRes, subRes, invRes] = await Promise.all([
        supabase.from('projects').select('name, client_name').eq('id', c.project_id).maybeSingle(),
        c.subproject_id
          ? supabase.from('subprojects').select('name').eq('id', c.subproject_id).maybeSingle()
          : Promise.resolve({ data: null }),
        c.co_invoice_id
          ? supabase.from('client_invoices').select('invoice_number').eq('id', c.co_invoice_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      setCtx({
        projectName: (projRes.data as any)?.name ?? null,
        clientName: (projRes.data as any)?.client_name ?? null,
        subprojectName: (subRes.data as any)?.name ?? null,
        coInvoiceNumber: (invRes.data as any)?.invoice_number ?? null,
      })
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const materials = useMemo(() => {
    const notes = (co?.proposed_line as any)?.notes
    if (typeof notes === 'string') {
      try {
        const parsed = JSON.parse(notes)
        if (Array.isArray(parsed?.materials)) return parsed.materials as { desc: string; qty: number; unit_cost: number; vendor?: boolean }[]
      } catch {
        /* spec-mode */
      }
    }
    return null
  }, [co])

  async function act(action: 'pdf' | 'send' | 'accept' | 'decline' | 'delete') {
    if (!co || busy) return
    setBusy(true)
    setError(null)
    try {
      if (action === 'pdf') {
        await downloadChangeOrderPdf(co.id)
      } else if (action === 'send') {
        await sendCoToClient(co.id)
        await load()
      } else if (action === 'accept') {
        await approveCo(co.id)
        await load()
      } else if (action === 'decline') {
        await rejectCo(co.id)
        await load()
      } else if (action === 'delete') {
        await voidCo(co.id)
        await load()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Change order action failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!id) return null
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-8 text-sm text-[#6B7280]">Loading change order…</div>
      </div>
    )
  }
  if (!co) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-8 text-sm text-[#DC2626]">Change order not found.</div>
      </div>
    )
  }

  const tone = STATE_TONE[co.state] || STATE_TONE.draft
  const price = Number(co.client_price) || 0
  const originalLabel = (co.original_line_snapshot as any)?.material || (co.original_line_snapshot as any)?.label || null
  const proposedLabel = (co.proposed_line as any)?.material || null
  const btn = 'px-3 py-1.5 text-[12px] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50'

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="p-6 max-w-[1000px] mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => router.push('/change-orders')}
            className="text-[12px] text-[#6B7280] hover:text-[#111] inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Change orders
          </button>
        </div>
        <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold text-[#111] font-mono">
              CO-{String(co.co_number ?? 0).padStart(2, '0')}
            </h1>
            <span
              className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
              style={{ backgroundColor: tone.bg, color: tone.fg }}
            >
              {tone.label}
            </span>
            <Link href={`/projects/${co.project_id}`} className="text-[13px] text-[#2563EB] hover:underline">
              {ctx.projectName ?? 'Project'}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => act('pdf')} disabled={busy} className={`${btn} text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB]`}>
              <Download className="w-3.5 h-3.5" /> PDF
            </button>
            {co.state === 'draft' && (
              <>
                <button onClick={() => act('send')} disabled={busy} className={`${btn} border border-[#BFDBFE] bg-[#EFF6FF] text-[#1D4ED8]`}>Send</button>
                <button onClick={() => act('delete')} disabled={busy} className={`${btn} border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]`}>Delete</button>
              </>
            )}
            {co.state === 'sent_to_client' && (
              <>
                <button onClick={() => act('accept')} disabled={busy} className={`${btn} border border-[#BBF7D0] bg-[#DCFCE7] text-[#15803D]`}>Accept</button>
                <button onClick={() => act('decline')} disabled={busy} className={`${btn} border border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]`}>Decline</button>
              </>
            )}
            <Link href={`/projects/${co.project_id}`} className={`${btn} text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB]`}>
              <ExternalLink className="w-3.5 h-3.5" /> Open project
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">{error}</div>
        )}

        <div className="space-y-5">
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-lg">
              <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">For</div>
              <div className="text-[12.5px] text-[#111] font-medium">{ctx.clientName ?? '—'}</div>
            </div>
            <div className="px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-lg">
              <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">Subproject</div>
              <div className="text-[12.5px] text-[#111] font-medium">{ctx.subprojectName ?? '—'}</div>
              <div className="text-[11.5px] text-[#6B7280] mt-0.5">Created {fmtDate(co.created_at)}</div>
            </div>
          </div>

          {/* The change */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-4">
            <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-2">Change</div>
            <div className="text-[15px] font-semibold text-[#111] mb-3">{co.title}</div>

            {materials ? (
              <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
                {materials.map((m, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 border-b border-[#F3F4F6] last:border-b-0 text-[12.5px]">
                    <span className="text-[#111]">{m.desc}{m.vendor ? <span className="text-[#9CA3AF]"> · vendor</span> : null}</span>
                    <span className="font-mono tabular-nums text-[#374151]">{m.qty} × {money(m.unit_cost)} = {money(m.qty * m.unit_cost)}</span>
                  </div>
                ))}
              </div>
            ) : originalLabel || proposedLabel ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[12.5px] px-2 py-1 rounded-md bg-[#F9FAFB] border border-[#E5E7EB]">{originalLabel || '—'}</span>
                <span className="text-[#9CA3AF]">→</span>
                <span className="text-[12.5px] px-2 py-1 rounded-md bg-[#F9FAFB] border border-[#E5E7EB]">{proposedLabel || '—'}</span>
              </div>
            ) : null}

            {co.drawing_revision_required && (
              <div className="mt-3 inline-flex items-center px-2 py-1 rounded-md bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] text-[11px]">
                Drawing revision required
              </div>
            )}
          </div>

          {/* Price */}
          <div className="ml-auto w-full max-w-[320px] text-[13px] px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-xl">
            <div className="flex items-center justify-between">
              <span className="text-[#111] font-semibold">{price === 0 ? 'No charge' : 'Change order total'}</span>
              <span className="font-mono tabular-nums text-[#111] font-semibold">{price === 0 ? '$0' : money(price)}</span>
            </div>
            {ctx.coInvoiceNumber && (
              <Link href={`/invoices/${co.co_invoice_id}`} className="mt-2 flex items-center justify-between text-[12px] text-[#2563EB] hover:underline">
                <span>On CO invoice</span>
                <span className="font-mono">{ctx.coInvoiceNumber} →</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
