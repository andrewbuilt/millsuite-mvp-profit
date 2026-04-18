'use client'

// Lead detail — edit lead header + subprojects before sold handoff.
// Parser-first: Pro+AI gets a "Parse drawings" button (wire to /api/parse-drawings
// in a later sprint). Pro tier uses manual entry. Starter tier doesn't see this page.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { supabase } from '@/lib/supabase'
import type { Lead, LeadStatus, LeadSubproject, PaymentTerms } from '@/lib/types'
import {
  ArrowLeft,
  Plus,
  Trash2,
  Upload,
  Sparkles,
  Check,
  X,
  Copy,
  ExternalLink,
} from 'lucide-react'

const STATUS_OPTS: { value: LeadStatus; label: string }[] = [
  { value: 'new_lead',       label: 'New Lead'  },
  { value: 'fifty_fifty',    label: '50 / 50'   },
  { value: 'ninety_percent', label: '90%'       },
  { value: 'sold',           label: 'Sold'      },
  { value: 'lost',           label: 'Lost'      },
]

function fmtMoney(n: number | null | undefined) {
  if (n == null) return '—'
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// ── Inline number input ──
function NumField({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: number | null
  onChange: (n: number | null) => void
  placeholder?: string
  className?: string
}) {
  const [raw, setRaw] = useState(value == null ? '' : String(value))
  useEffect(() => { setRaw(value == null ? '' : String(value)) }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      placeholder={placeholder}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        const n = raw === '' ? null : Number(raw)
        onChange(isNaN(n as number) ? null : n)
      }}
      className={`px-2 py-1.5 text-sm font-mono tabular-nums text-right bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors ${className}`}
    />
  )
}

function TextField({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string | null
  onChange: (s: string) => void
  placeholder?: string
  className?: string
}) {
  const [raw, setRaw] = useState(value || '')
  useEffect(() => { setRaw(value || '') }, [value])
  return (
    <input
      type="text"
      value={raw}
      placeholder={placeholder}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => onChange(raw)}
      className={`px-2 py-1.5 text-sm bg-white border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors ${className}`}
    />
  )
}

// ── Page wrapper ──

export default function LeadDetailPage() {
  return (
    <PlanGate requires="leads">
      <LeadDetailInner />
    </PlanGate>
  )
}

function LeadDetailInner() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { org } = useAuth()
  const leadId = params.id

  const hasAI = hasAccess(org?.plan, 'ai-estimating')

  const [lead, setLead] = useState<Lead | null>(null)
  const [subs, setSubs] = useState<LeadSubproject[]>([])
  const [loading, setLoading] = useState(true)
  const [converting, setConverting] = useState(false)
  const [soldModal, setSoldModal] = useState<{
    projectId: string
    projectName: string
    portalSlug: string | null
  } | null>(null)
  const [aiWaitlist, setAiWaitlist] = useState<'idle' | 'saving' | 'joined'>('idle')

  async function joinAIWaitlist() {
    if (!org || aiWaitlist !== 'idle') return
    setAiWaitlist('saving')
    // Best-effort: pull the owner's email off the org, fall back to a generic tag.
    const email = (org as any).business_email || `${org.slug}@millsuite-waitlist.internal`
    try {
      await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tier: 'ai-drawing-parser' }),
      })
      setAiWaitlist('joined')
    } catch {
      setAiWaitlist('idle')
      alert('Could not join waitlist — please try again')
    }
  }

  // ── Load ──

  const load = useCallback(async () => {
    if (!leadId) return
    setLoading(true)
    const { data: leadData } = await supabase
      .from('leads')
      .select(`*, client:clients(*), contact:contacts(*)`)
      .eq('id', leadId)
      .single()

    const { data: subsData } = await supabase
      .from('lead_subprojects')
      .select('*')
      .eq('lead_id', leadId)
      .order('sequence_order', { ascending: true })

    setLead((leadData as unknown as Lead) || null)
    setSubs((subsData as LeadSubproject[]) || [])
    setLoading(false)
  }, [leadId])

  useEffect(() => { load() }, [load])

  // ── Totals ──

  const totals = useMemo(() => {
    const hrs = subs.reduce((a, s) => a + (s.estimated_hours || 0), 0)
    const price = subs.reduce((a, s) => a + (s.estimated_price || 0), 0)
    return { hrs, price }
  }, [subs])

  // ── Lead-level updates ──

  async function patchLead(patch: Partial<Lead>) {
    if (!lead) return
    setLead(prev => (prev ? { ...prev, ...patch } : prev))
    await supabase
      .from('leads')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', lead.id)
  }

  // ── Subproject CRUD ──

  async function addSub() {
    if (!lead) return
    const { data } = await supabase
      .from('lead_subprojects')
      .insert({
        lead_id: lead.id,
        name: 'New line item',
        sequence_order: subs.length,
        estimated_hours: 0,
        estimated_price: 0,
      })
      .select()
      .single()
    if (data) setSubs(prev => [...prev, data as LeadSubproject])
  }

  async function patchSub(id: string, patch: Partial<LeadSubproject>) {
    setSubs(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)))
    await supabase.from('lead_subprojects').update(patch).eq('id', id)
  }

  async function deleteSub(id: string) {
    if (!confirm('Delete this line item?')) return
    setSubs(prev => prev.filter(s => s.id !== id))
    await supabase.from('lead_subprojects').delete().eq('id', id)
  }

  // ── Sold handoff ──

  async function convertToSold() {
    if (!lead) return
    if (subs.length === 0) {
      if (!confirm('No line items on this lead. Convert anyway?')) return
    }

    setConverting(true)
    try {
      const res = await fetch(`/api/leads/${lead.id}/convert`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error || 'Failed to convert lead')
        return
      }
      setSoldModal({
        projectId: json.project_id,
        projectName: json.project_name,
        portalSlug: json.portal_slug,
      })
    } catch (err: any) {
      alert(err?.message || 'Failed to convert lead')
    } finally {
      setConverting(false)
    }
  }

  // ── Already converted? Show link ──
  const alreadyConverted = lead?.converted_to_project_id

  // ── Render ──

  if (loading) {
    return (
      <>
        <Nav />
        <div className="max-w-5xl mx-auto px-6 py-8 text-sm text-[#9CA3AF]">Loading…</div>
      </>
    )
  }

  if (!lead) {
    return (
      <>
        <Nav />
        <div className="max-w-5xl mx-auto px-6 py-8">
          <Link href="/leads" className="text-sm text-[#2563EB] hover:underline">
            ← Back to leads
          </Link>
          <div className="mt-6 text-sm text-[#6B7280]">Lead not found.</div>
        </div>
      </>
    )
  }

  return (
    <>
      <Nav />

      <div className="max-w-5xl mx-auto px-6 py-6">
        {/* Breadcrumb */}
        <Link
          href="/leads"
          className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[#111] transition-colors mb-4"
        >
          <ArrowLeft className="w-3 h-3" /> Back to leads
        </Link>

        {/* Header */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5 mb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <select
                  value={lead.status}
                  onChange={e => patchLead({ status: e.target.value as LeadStatus })}
                  className="text-[11px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#DBEAFE] outline-none cursor-pointer"
                >
                  {STATUS_OPTS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                {alreadyConverted && (
                  <Link
                    href={`/projects/${alreadyConverted}`}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#065F46] bg-[#D1FAE5] px-2 py-1 rounded-full hover:bg-[#A7F3D0] transition-colors"
                  >
                    <Check className="w-2.5 h-2.5" /> Converted
                  </Link>
                )}
              </div>
              <input
                value={lead.lead_name}
                onChange={e => setLead({ ...lead, lead_name: e.target.value })}
                onBlur={e => patchLead({ lead_name: e.target.value })}
                className="text-xl font-semibold text-[#111] w-full outline-none bg-transparent hover:bg-[#F9FAFB] focus:bg-[#F9FAFB] rounded px-1 -mx-1 transition-colors"
              />
              <input
                value={lead.client_name || ''}
                onChange={e => setLead({ ...lead, client_name: e.target.value })}
                onBlur={e => patchLead({ client_name: e.target.value || null })}
                placeholder="Client name"
                className="text-sm text-[#6B7280] w-full outline-none bg-transparent hover:bg-[#F9FAFB] focus:bg-[#F9FAFB] rounded px-1 -mx-1 mt-0.5 transition-colors"
              />
            </div>

            <div className="flex flex-col items-end gap-2">
              <div className="text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                  Estimated
                </div>
                <div className="text-xl font-semibold font-mono tabular-nums text-[#111]">
                  {fmtMoney(totals.price || lead.estimated_price)}
                </div>
                <div className="text-[11px] text-[#6B7280] tabular-nums">
                  {totals.hrs.toFixed(0)} hrs
                </div>
              </div>
              {!alreadyConverted && (
                <button
                  onClick={convertToSold}
                  disabled={converting}
                  className="px-4 py-2 bg-[#10B981] text-white text-sm font-medium rounded-lg hover:bg-[#059669] transition-colors disabled:opacity-50"
                >
                  {converting ? 'Converting…' : 'Mark as Sold →'}
                </button>
              )}
            </div>
          </div>

          {/* Scope */}
          <div className="mt-4 pt-4 border-t border-[#F3F4F6]">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Scope
            </label>
            <textarea
              value={lead.scope_description || ''}
              onChange={e => setLead({ ...lead, scope_description: e.target.value })}
              onBlur={e => patchLead({ scope_description: e.target.value || null })}
              placeholder="What is this project? Rooms, materials, special notes…"
              rows={2}
              className="mt-1 w-full px-2 py-1.5 text-sm bg-[#F9FAFB] border border-[#E5E7EB] rounded-md outline-none focus:border-[#2563EB] focus:bg-white transition-colors resize-none"
            />
          </div>
        </div>

        {/* Subprojects */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-[#111]">Line items</h2>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {subs.length === 0
                  ? 'Add the rooms, cabinets, or assemblies you\u2019re quoting.'
                  : `${subs.length} ${subs.length === 1 ? 'item' : 'items'} · ${totals.hrs.toFixed(0)} hrs · ${fmtMoney(totals.price)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {hasAI && (
                <button
                  onClick={joinAIWaitlist}
                  disabled={aiWaitlist !== 'idle'}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    aiWaitlist === 'joined'
                      ? 'bg-[#ECFDF5] text-[#059669] border border-[#A7F3D0]'
                      : 'bg-[#F5F3FF] border border-[#DDD6FE] text-[#7C3AED] hover:bg-[#EDE9FE] disabled:opacity-60'
                  }`}
                  title="AI drawing parser — join the early access list"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {aiWaitlist === 'joined'
                    ? "You're on the list"
                    : aiWaitlist === 'saving'
                    ? 'Adding...'
                    : 'Parse drawings (early access)'}
                </button>
              )}
              <button
                onClick={addSub}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF] rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add line
              </button>
            </div>
          </div>

          {subs.length === 0 ? (
            <div className="border-2 border-dashed border-[#E5E7EB] rounded-lg py-12 text-center">
              <Upload className="w-6 h-6 text-[#9CA3AF] mx-auto mb-2" />
              <p className="text-sm text-[#6B7280] mb-3">
                No line items yet.
              </p>
              <button
                onClick={addSub}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF] rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add first line item
              </button>
            </div>
          ) : (
            <div className="border border-[#E5E7EB] rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-[11px] uppercase tracking-wide text-[#6B7280]">
                    <th className="text-left font-medium py-2 px-3">Name</th>
                    <th className="text-right font-medium py-2 px-2">LF</th>
                    <th className="text-right font-medium py-2 px-2">Hours</th>
                    <th className="text-right font-medium py-2 px-2">Price</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map(sub => (
                    <tr key={sub.id} className="border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#FAFAFA] group">
                      <td className="px-2 py-1.5">
                        <TextField
                          value={sub.name}
                          onChange={v => patchSub(sub.id, { name: v })}
                          className="w-full"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <NumField
                          value={sub.linear_feet}
                          onChange={v => patchSub(sub.id, { linear_feet: v })}
                          className="w-20"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <NumField
                          value={sub.estimated_hours}
                          onChange={v => patchSub(sub.id, { estimated_hours: v })}
                          className="w-24"
                        />
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <NumField
                          value={sub.estimated_price}
                          onChange={v => patchSub(sub.id, { estimated_price: v })}
                          className="w-28"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => deleteSub(sub.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[#FEE2E2] text-[#9CA3AF] hover:text-[#EF4444] transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#F9FAFB] font-semibold text-[#111]">
                    <td className="px-3 py-2 text-xs uppercase tracking-wide text-[#6B7280]">Total</td>
                    <td></td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {totals.hrs.toFixed(0)}
                    </td>
                    <td className="px-2 py-2 text-right font-mono tabular-nums">
                      {fmtMoney(totals.price)}
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Sold handoff modal (same as Kanban) */}
      {soldModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-[#D1FAE5] flex items-center justify-center">
                  <Check className="w-4 h-4 text-[#065F46]" />
                </div>
                <h2 className="text-base font-semibold text-[#111]">Sold!</h2>
              </div>
              <button
                onClick={() => setSoldModal(null)}
                className="p-1 text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-[#374151] leading-relaxed mb-4">
              <span className="font-medium">{soldModal.projectName}</span> is now a project. Line items
              copied, selections seeded, and the client portal is live.
            </p>

            {soldModal.portalSlug && (
              <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3 mb-4">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] mb-1">
                  Client portal
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs font-mono text-[#111] truncate">
                    /portal/{soldModal.portalSlug}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(
                        `${window.location.origin}/portal/${soldModal.portalSlug}`
                      )
                    }}
                    className="p-1.5 text-[#6B7280] hover:text-[#111] hover:bg-white rounded transition-colors"
                    title="Copy link"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => {
                  setSoldModal(null)
                  router.push(`/projects/${soldModal.projectId}`)
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors"
              >
                Open project
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => router.push('/leads')}
                className="px-4 py-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
              >
                Back to leads
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
