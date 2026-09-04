'use client'

// ============================================================================
// /estimates/[projectId] — estimate detail (mirrors the invoice detail page)
// ============================================================================
// Estimates aren't a stored entity like invoices — they're derived from the
// project. The estimate PDF route stashes a snapshot on the project
// (projects.estimate_snapshot_json: lineItems / schedule / totals / terms) each
// time the PDF is generated. This page renders that snapshot read-only, with
// Send / Download / Mark-sent / Open-project actions. When no snapshot exists
// yet (marked sent but never generated), it routes the user to the project.
// ============================================================================

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Download, Check, Send, ExternalLink } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
import { isPresold, type ProjectStage } from '@/lib/types'
import { downloadEstimatePdf, type EstimatePdfPayload } from '@/lib/estimate-pdf'
import SendEstimateModal from '@/components/estimates/SendEstimateModal'

interface Snapshot {
  estimateNumber?: string
  estimateDate?: string
  lineItems?: EstimatePdfPayload['lineItems']
  schedule?: EstimatePdfPayload['schedule']
  totals?: EstimatePdfPayload['totals']
  terms?: string | null
}

interface ProjectRow {
  id: string
  name: string
  client_id: string | null
  client_name: string | null
  stage: ProjectStage
  estimate_number: string | null
  estimate_sent_at: string | null
  estimate_snapshot_json: Snapshot | null
  bid_total: number | null
}

interface ClientInfo {
  name: string
  address: string | null
  email: string | null
  phone: string | null
}

function money(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('en-US')
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length <= 10 ? iso + 'T12:00:00Z' : iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type EstimateStatus = 'open' | 'won' | 'lost'
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

export default function EstimateDetailPage() {
  const router = useRouter()
  const params = useParams<{ projectId: string }>()
  const projectId = params?.projectId
  const { org } = useAuth()

  const [loading, setLoading] = useState(true)
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [client, setClient] = useState<ClientInfo | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('projects')
        .select('id, name, client_id, client_name, stage, estimate_number, estimate_sent_at, estimate_snapshot_json, bid_total')
        .eq('id', projectId)
        .single()
      if (cancelled) return
      const p = (data as ProjectRow) || null
      setProject(p)
      if (p?.client_id) {
        const { data: cli } = await supabase
          .from('clients')
          .select('name, address, email, phone')
          .eq('id', p.client_id)
          .single()
        if (!cancelled && cli) setClient(cli as ClientInfo)
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  const snapshot = project?.estimate_snapshot_json ?? null
  const payload: EstimatePdfPayload | null = useMemo(() => {
    if (!snapshot?.lineItems || !snapshot.totals) return null
    return {
      lineItems: snapshot.lineItems,
      schedule: snapshot.schedule ?? [],
      totals: snapshot.totals,
      terms: snapshot.terms ?? null,
    }
  }, [snapshot])

  async function handleDownload() {
    if (!projectId || !payload) return
    setDownloading(true)
    setError(null)
    try {
      await downloadEstimatePdf(projectId, payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate PDF')
    } finally {
      setDownloading(false)
    }
  }

  async function handleMarkSent() {
    if (!projectId) return
    const now = new Date().toISOString()
    await supabase.from('projects').update({ estimate_sent_at: now }).eq('id', projectId)
    setProject((p) => (p ? { ...p, estimate_sent_at: now } : p))
  }

  if (!projectId) return null
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-8 text-sm text-[#6B7280]">Loading estimate…</div>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="min-h-screen bg-[#FAFAFA]">
        <div className="p-8 text-sm text-[#DC2626]">Estimate not found.</div>
      </div>
    )
  }

  const status = estimateStatus(project.stage)
  const tone = STATUS_TONE[status]

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="p-6 max-w-[1100px] mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => router.push('/estimates')}
            className="text-[12px] text-[#6B7280] hover:text-[#111] inline-flex items-center gap-1"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Estimates
          </button>
        </div>
        <div className="flex items-center justify-between mb-5 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold text-[#111] font-mono">
              {project.estimate_number ?? 'Estimate'}
            </h1>
            <span
              className="inline-flex items-center px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
              style={{ backgroundColor: tone.bg, color: tone.fg }}
            >
              {tone.label}
            </span>
            <Link href={`/projects/${project.id}`} className="text-[13px] text-[#2563EB] hover:underline">
              {project.name}
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {payload && (
              <button
                onClick={() => setEmailOpen(true)}
                className="px-3 py-1.5 text-[12px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5"
              >
                <Send className="w-3.5 h-3.5" /> Send estimate
              </button>
            )}
            {payload && (
              <button
                onClick={handleDownload}
                disabled={downloading}
                className="px-3 py-1.5 text-[12px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" /> {downloading ? 'Generating…' : 'PDF'}
              </button>
            )}
            {project.estimate_sent_at ? (
              <button
                onClick={handleMarkSent}
                title="Update the sent date"
                className="px-3 py-1.5 text-[12px] font-medium text-[#15803D] bg-[#DCFCE7] border border-[#BBF7D0] hover:bg-[#BBF7D0] rounded-md inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" /> Sent {fmtDate(project.estimate_sent_at)}
              </button>
            ) : (
              <button
                onClick={handleMarkSent}
                className="px-3 py-1.5 text-[12px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" /> Mark as sent
              </button>
            )}
            <Link
              href={`/projects/${project.id}`}
              className="px-3 py-1.5 text-[12px] text-[#374151] border border-[#E5E7EB] hover:bg-[#F9FAFB] rounded-md inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open project
            </Link>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 bg-[#FEE2E2] border border-[#FECACA] rounded-lg text-[12px] text-[#991B1B]">
            {error}
          </div>
        )}

        {!payload ? (
          <div className="px-6 py-10 bg-white border border-dashed border-[#E5E7EB] rounded-xl text-center">
            <div className="text-sm text-[#374151] font-medium mb-1">No estimate snapshot yet.</div>
            <div className="text-[12.5px] text-[#9CA3AF] mb-4">
              Open the project and download or email the estimate once — it&apos;ll show here.
            </div>
            <Link
              href={`/projects/${project.id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-white bg-[#111] hover:bg-[#1F2937] rounded-md"
            >
              Open project →
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Bill to + Project */}
            <div className="grid grid-cols-2 gap-3">
              <div className="px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-lg">
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">Prepared for</div>
                {client ? (
                  <div className="text-[12.5px] text-[#111] leading-relaxed">
                    <div className="font-medium">{client.name}</div>
                    {client.address && <div className="text-[#6B7280] whitespace-pre-line text-[11.5px]">{client.address}</div>}
                    {client.email && <div className="text-[#6B7280] text-[11.5px]">{client.email}</div>}
                    {client.phone && <div className="text-[#6B7280] text-[11.5px]">{client.phone}</div>}
                  </div>
                ) : (
                  <div className="text-[12.5px] text-[#111]">{project.client_name ?? '—'}</div>
                )}
              </div>
              <div className="px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-lg">
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">Project</div>
                <div className="text-[12.5px] text-[#111] font-medium">{project.name}</div>
                {snapshot?.estimateDate && (
                  <div className="text-[11.5px] text-[#6B7280] mt-0.5">Dated {fmtDate(snapshot.estimateDate)}</div>
                )}
              </div>
            </div>

            {/* Line items */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#E5E7EB] text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                Line items
              </div>
              <div className="grid grid-cols-[1fr_60px_60px_90px_90px] gap-2 px-4 py-1.5 text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold border-b border-[#F3F4F6] bg-[#F9FAFB]">
                <div>Description</div>
                <div className="text-right">Qty</div>
                <div className="text-right">Unit</div>
                <div className="text-right">Rate</div>
                <div className="text-right">Amount</div>
              </div>
              {payload.lineItems.map((li, i) => {
                const nl = li.description.indexOf('\n')
                const titleLine = nl >= 0 ? li.description.slice(0, nl) : li.description
                const body = nl >= 0 ? li.description.slice(nl + 1).replace(/^\n+/, '') : ''
                return (
                  <div key={i} className="grid grid-cols-[1fr_60px_60px_90px_90px] gap-2 px-4 py-2 items-start border-b border-[#F3F4F6] last:border-b-0">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-[#111]">{titleLine}</div>
                      {body && <div className="text-[11.5px] text-[#6B7280] whitespace-pre-line mt-1">{body}</div>}
                    </div>
                    <div className="text-[12px] font-mono tabular-nums text-right text-[#374151]">{li.quantity}</div>
                    <div className="text-[12px] text-right text-[#6B7280]">{li.unit ?? '—'}</div>
                    <div className="text-[12px] font-mono tabular-nums text-right text-[#374151]">{money(li.unit_price)}</div>
                    <div className="text-[12.5px] font-mono tabular-nums text-right text-[#111]">
                      {money(li.amount > 0 ? li.amount : li.quantity * li.unit_price)}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Totals */}
            <div className="ml-auto w-full max-w-[320px] text-[13px] space-y-1 px-3 py-2.5 bg-white border border-[#E5E7EB] rounded-xl">
              <div className="flex items-center justify-between">
                <span className="text-[#6B7280]">Subtotal</span>
                <span className="font-mono tabular-nums">{money(payload.totals.subtotal)}</span>
              </div>
              {payload.totals.taxPct > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[#6B7280]">Tax ({payload.totals.taxPct}%)</span>
                  <span className="font-mono tabular-nums">{money(payload.totals.taxAmount)}</span>
                </div>
              )}
              <div className="border-t border-[#E5E7EB] my-1" />
              <div className="flex items-center justify-between">
                <span className="text-[#111] font-semibold">Estimate total</span>
                <span className="font-mono tabular-nums text-[#111] font-semibold">{money(payload.totals.total)}</span>
              </div>
            </div>

            {/* Payment schedule */}
            {payload.schedule && payload.schedule.length > 0 && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#E5E7EB] text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                  Payment schedule
                </div>
                {payload.schedule.map((m, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2 border-b border-[#F3F4F6] last:border-b-0">
                    <div className="text-[12.5px] text-[#111]">
                      {m.label} ({m.pct.toFixed(0)}%)
                      {m.trigger ? <span className="text-[#9CA3AF]"> · {m.trigger}</span> : null}
                    </div>
                    <div className="text-[12.5px] font-mono tabular-nums text-[#111]">{money(m.amount)}</div>
                  </div>
                ))}
              </div>
            )}

            {payload.terms && (
              <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 py-3">
                <div className="text-[10px] uppercase tracking-wider text-[#9CA3AF] font-semibold mb-1">Terms</div>
                <div className="text-[12px] text-[#374151] whitespace-pre-line leading-relaxed">{payload.terms}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {emailOpen && payload && (
        <SendEstimateModal
          projectId={project.id}
          payload={payload}
          clientName={project.client_name}
          projectName={project.name}
          orgId={org?.id ?? null}
          defaultTemplate={(project as { estimate_template?: string | null }).estimate_template ?? null}
          onClose={() => setEmailOpen(false)}
        />
      )}
    </div>
  )
}
