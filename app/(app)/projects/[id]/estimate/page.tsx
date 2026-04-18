'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { computeSubprojectPrice } from '@/lib/pricing'
import { ArrowLeft, Printer } from 'lucide-react'
import { MLogo } from '@/components/logo'

interface Project {
  id: string
  name: string
  client_name: string | null
  client_email: string | null
  client_phone: string | null
  status: string
  bid_total: number
  notes: string | null
  created_at: string
}

interface Subproject {
  id: string
  name: string
  sort_order: number
  material_cost: number
  labor_hours: number
  consumable_markup_pct: number | null
  profit_margin_pct: number | null
  price: number
  manual_price: number | null
  activity_type: string | null
  material_finish: string | null
  dimensions: string | null
}

function fmtMoney(n: number) {
  if (!n && n !== 0) return '$0'
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function formatDate(d: string | Date) {
  const dt = typeof d === 'string' ? new Date(d) : d
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default function EstimatePage() {
  const { id: projectId } = useParams() as { id: string }
  const router = useRouter()
  const { org } = useAuth()
  const shopRate = org?.shop_rate || 75
  const orgDefaults = {
    consumable_markup_pct: org?.consumable_markup_pct ?? 15,
    profit_margin_pct: org?.profit_margin_pct ?? 35,
  }

  const [project, setProject] = useState<Project | null>(null)
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    async function load() {
      const [projRes, subsRes] = await Promise.all([
        supabase.from('projects').select('*').eq('id', projectId).single(),
        supabase.from('subprojects').select('*').eq('project_id', projectId).order('sort_order'),
      ])
      setProject(projRes.data)
      setSubprojects(subsRes.data || [])
      setLoading(false)
    }
    load()
  }, [projectId])

  if (loading || !project || !org) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-[#9CA3AF]">
        Loading estimate…
      </div>
    )
  }

  // Compute per-line prices with the shared engine so the estimate matches the detail page
  const lines = subprojects.map(sub => {
    const result = computeSubprojectPrice({
      materialCost: sub.material_cost,
      consumableMarkupPct: sub.consumable_markup_pct ?? orgDefaults.consumable_markup_pct,
      laborHours: sub.labor_hours,
      shopRate,
      profitMarginPct: sub.profit_margin_pct ?? orgDefaults.profit_margin_pct,
      manualPrice: sub.manual_price,
    })
    return { sub, price: result.price }
  })

  const subtotal = lines.reduce((s, l) => s + (l.price || 0), 0)
  const businessName = org.name || 'Your Shop'
  const address = (org as any).business_address || ''
  const city = (org as any).business_city || ''
  const state = (org as any).business_state || ''
  const zip = (org as any).business_zip || ''
  const phone = (org as any).business_phone || ''
  const email = (org as any).business_email || ''
  const today = new Date()
  const estimateNumber = `EST-${project.id.slice(0, 8).toUpperCase()}`

  return (
    <>
      {/* Print-only styles + screen action bar */}
      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          .print-page { box-shadow: none !important; margin: 0 !important; max-width: none !important; }
        }
        @page { margin: 0.6in; }
      `}</style>

      {/* Action bar (screen only) */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-[#E5E7EB] px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => router.push(`/projects/${projectId}`)}
          className="flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to project
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#9CA3AF] hidden sm:inline">
            Use your browser's print dialog to save as PDF
          </span>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* Estimate document */}
      <div className="min-h-screen bg-[#F9FAFB] py-8 px-4">
        <div className="print-page max-w-3xl mx-auto bg-white shadow-sm rounded-xl overflow-hidden">
          <div className="p-10">
            {/* Header */}
            <div className="flex items-start justify-between pb-6 border-b border-[#E5E7EB]">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MLogo size={20} color="#111" />
                  <span className="text-lg font-semibold text-[#111]">{businessName}</span>
                </div>
                <div className="text-[11px] text-[#6B7280] leading-relaxed">
                  {address && <div>{address}</div>}
                  {(city || state || zip) && <div>{[city, state, zip].filter(Boolean).join(', ')}</div>}
                  {phone && <div>{phone}</div>}
                  {email && <div>{email}</div>}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Estimate</div>
                <div className="text-2xl font-semibold text-[#111] mt-1">{estimateNumber}</div>
                <div className="text-[11px] text-[#6B7280] mt-2">
                  Date: {formatDate(today)}
                </div>
                <div className="text-[11px] text-[#6B7280]">
                  Valid for 30 days
                </div>
              </div>
            </div>

            {/* Client + Project blocks */}
            <div className="grid grid-cols-2 gap-8 py-6 border-b border-[#E5E7EB]">
              <div>
                <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Prepared For</div>
                <div className="text-sm font-medium text-[#111]">{project.client_name || '—'}</div>
                {project.client_email && <div className="text-xs text-[#6B7280]">{project.client_email}</div>}
                {project.client_phone && <div className="text-xs text-[#6B7280]">{project.client_phone}</div>}
              </div>
              <div>
                <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Project</div>
                <div className="text-sm font-medium text-[#111]">{project.name}</div>
              </div>
            </div>

            {/* Line items */}
            <div className="py-6">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#E5E7EB]">
                    <th className="text-left text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider pb-2">Description</th>
                    <th className="text-right text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider pb-2 w-32">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-8 text-center text-sm text-[#9CA3AF] italic">
                        No line items yet
                      </td>
                    </tr>
                  ) : (
                    lines.map(({ sub, price }) => {
                      const detailBits = [sub.activity_type, sub.material_finish, sub.dimensions].filter(Boolean)
                      return (
                        <tr key={sub.id} className="border-b border-[#F3F4F6]">
                          <td className="py-3 pr-4">
                            <div className="text-sm font-medium text-[#111]">{sub.name}</div>
                            {detailBits.length > 0 && (
                              <div className="text-[11px] text-[#6B7280] mt-0.5">
                                {detailBits.join(' · ')}
                              </div>
                            )}
                          </td>
                          <td className="py-3 text-right text-sm font-mono tabular-nums font-medium text-[#111]">
                            {fmtMoney(price)}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="pt-4 text-right text-sm font-semibold text-[#111]">Total</td>
                    <td className="pt-4 text-right text-xl font-mono tabular-nums font-semibold text-[#111]">
                      {fmtMoney(subtotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Notes */}
            {project.notes && (
              <div className="py-4 border-t border-[#E5E7EB]">
                <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Notes</div>
                <div className="text-[12px] text-[#374151] whitespace-pre-wrap">{project.notes}</div>
              </div>
            )}

            {/* Terms */}
            <div className="py-6 border-t border-[#E5E7EB]">
              <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">Terms</div>
              <div className="text-[11px] text-[#6B7280] leading-relaxed space-y-1">
                <p>· Estimate valid for 30 days from the date above.</p>
                <p>· Pricing assumes standard materials and finishes as described. Changes in scope, material selections, or site conditions may affect final price.</p>
                <p>· A deposit is required to schedule production. Balance is due on delivery or installation unless otherwise agreed.</p>
                <p>· Lead times confirmed after deposit and final drawing approval.</p>
              </div>
            </div>

            {/* Acceptance */}
            <div className="pt-8 grid grid-cols-2 gap-8">
              <div>
                <div className="border-b border-[#111] h-10" />
                <div className="text-[10px] text-[#9CA3AF] mt-1">Client Signature</div>
              </div>
              <div>
                <div className="border-b border-[#111] h-10" />
                <div className="text-[10px] text-[#9CA3AF] mt-1">Date</div>
              </div>
            </div>
          </div>

          {/* Footer — thin band */}
          <div className="bg-[#F9FAFB] px-10 py-3 text-center text-[10px] text-[#9CA3AF] border-t border-[#E5E7EB]">
            Thank you for the opportunity. Questions? Contact {email || phone || businessName}.
          </div>
        </div>
      </div>
    </>
  )
}
