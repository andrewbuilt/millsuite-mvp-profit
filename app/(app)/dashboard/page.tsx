'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { computeProjectPL } from '@/lib/pricing'
import { useAuth } from '@/lib/auth-context'
import { DollarSign, FolderKanban, FileText, TrendingUp, Plus, Clock, Settings, AlertTriangle, CheckCircle2, Receipt, ChevronDown, ChevronUp, Sparkles } from 'lucide-react'
import InvoiceParser from '@/components/invoice-parser'

// ── Types ──

interface Project {
  id: string
  name: string
  client_name: string | null
  status: string
  bid_total: number
}

interface TimeEntry {
  project_id: string
  subproject_id: string | null
  duration_minutes: number
}

interface Invoice {
  project_id: string
  total_amount: number
}

interface Subproject {
  id: string
  project_id: string
  name: string
  labor_hours: number
}

interface ProjectRisk {
  id: string
  name: string
  bidTotal: number
  actualTotal: number
  variancePct: number
  spentPct: number
  overHoursSubs: { name: string; estimated: number; actual: number }[]
}

// ── Helpers ──

function fmtMoney(n: number): string {
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

// ── Main Page ──

export default function DashboardPage() {
  const { org } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const shopRate = org?.shop_rate || 75
  const [loading, setLoading] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [report, setReport] = useState('')
  const [reportLoading, setReportLoading] = useState(false)

  useEffect(() => {
    loadData()
  }, [org?.id])

  async function loadData() {
    setLoading(true)

    if (!org?.id) return

    const [
      { data: projs },
      { data: subs },
      { data: entries },
      { data: invs },
    ] = await Promise.all([
      supabase.from('projects').select('id, name, client_name, status, bid_total').eq('org_id', org.id).in('status', ['active', 'bidding', 'complete']),
      supabase.from('subprojects').select('id, project_id, name, labor_hours').eq('org_id', org.id),
      supabase.from('time_entries').select('project_id, subproject_id, duration_minutes').eq('org_id', org.id),
      supabase.from('invoices').select('project_id, total_amount').eq('org_id', org.id),
    ])

    setProjects(projs || [])
    setSubprojects(subs || [])
    setTimeEntries(entries || [])
    setInvoices(invs || [])
    setLoading(false)
  }

  // ── Computed Metrics ──

  const activeProjects = projects.filter(p => p.status === 'active')
  const biddingProjects = projects.filter(p => p.status === 'bidding')
  const completedProjects = projects.filter(p => p.status === 'complete')

  // "In Production" = active projects that have time logged
  const inProductionProjects = activeProjects.filter(p =>
    timeEntries.some(t => t.project_id === p.id)
  )
  const inProductionBidTotal = inProductionProjects.reduce((sum, p) => sum + (p.bid_total || 0), 0)

  const activeBidTotal = activeProjects.reduce((sum, p) => sum + (p.bid_total || 0), 0)
  const biddingBidTotal = biddingProjects.reduce((sum, p) => sum + (p.bid_total || 0), 0)

  // Per-project actuals for active projects
  function getProjectActuals(projectId: string) {
    const laborMinutes = timeEntries
      .filter(e => e.project_id === projectId)
      .reduce((sum, e) => sum + e.duration_minutes, 0)
    const laborCost = (laborMinutes / 60) * shopRate
    const materialCost = invoices
      .filter(i => i.project_id === projectId)
      .reduce((sum, i) => sum + i.total_amount, 0)
    return { laborCost, materialCost, total: laborCost + materialCost }
  }

  // Overall margin — only from completed projects (so it reflects real outcomes, not in-progress guesses)
  const completedBid = completedProjects.reduce((sum, p) => sum + (p.bid_total || 0), 0)
  const completedActual = completedProjects.reduce((sum, p) => {
    const actuals = getProjectActuals(p.id)
    return sum + actuals.total
  }, 0)
  const overallMarginPct = completedBid > 0 ? ((completedBid - completedActual) / completedBid) * 100 : 0
  // If no completed projects yet, show in-production margin as a preview
  const hasCompleted = completedProjects.length > 0
  const inProdActual = inProductionProjects.reduce((sum, p) => sum + getProjectActuals(p.id).total, 0)
  const inProdMarginPct = inProductionBidTotal > 0 ? ((inProductionBidTotal - inProdActual) / inProductionBidTotal) * 100 : 0
  const displayMarginPct = hasCompleted ? overallMarginPct : inProdMarginPct
  const displayMarginLabel = hasCompleted ? 'Completed Projects' : 'In Production (live)'
  const displayVariance = hasCompleted ? completedBid - completedActual : inProductionBidTotal - inProdActual

  // Projects at risk: actual cost > 50% of bid OR any subproject over estimated hours
  const atRiskProjects: ProjectRisk[] = activeProjects
    .map(p => {
      const actuals = getProjectActuals(p.id)
      const bid = p.bid_total || 0
      const spentPct = bid > 0 ? (actuals.total / bid) * 100 : 0
      const pl = computeProjectPL({
        bidTotal: bid,
        actualLaborCost: actuals.laborCost,
        actualMaterialCost: actuals.materialCost,
      })

      // Check per-subproject hours
      const projSubs = subprojects.filter(s => s.project_id === p.id)
      const overHoursSubs = projSubs
        .map(sub => {
          const actualMins = timeEntries.filter(t => t.subproject_id === sub.id).reduce((s, t) => s + t.duration_minutes, 0)
          const actualHrs = actualMins / 60
          return { name: sub.name, estimated: sub.labor_hours, actual: Math.round(actualHrs * 10) / 10 }
        })
        .filter(s => s.estimated > 0 && s.actual > s.estimated)

      return {
        id: p.id,
        name: p.name,
        bidTotal: bid,
        actualTotal: actuals.total,
        variancePct: pl.variancePct,
        spentPct,
        overHoursSubs,
      }
    })
    .filter(p => p.spentPct > 50 || p.overHoursSubs.length > 0)
    .sort((a, b) => b.spentPct - a.spentPct)

  if (loading) {
    return (
      <>
        <Nav />
        <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">Loading...</div>
      </>
    )
  }

  return (
    <>
      <Nav />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mb-4 sm:mb-6">Dashboard</h1>

        {/* ── TOP ROW: Key Metrics ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
          {/* Shop Rate */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-[#2563EB]" />
              </div>
              <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Shop Rate</span>
            </div>
            <div className="text-2xl sm:text-3xl font-mono tabular-nums font-semibold text-[#111]">
              ${Number(shopRate).toFixed(2)}<span className="text-base text-[#9CA3AF] font-normal">/hr</span>
            </div>
          </div>

          {/* In Production */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
                <FolderKanban className="w-4 h-4 text-[#2563EB]" />
              </div>
              <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">In Production</span>
            </div>
            <div className="text-2xl sm:text-3xl font-mono tabular-nums font-semibold text-[#111]">
              {inProductionProjects.length}
            </div>
            <div className="text-xs text-[#6B7280] mt-1 font-mono tabular-nums">{fmtMoney(inProductionBidTotal)} bid value</div>
          </div>

          {/* Bidding Projects */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-[#FFFBEB] flex items-center justify-center">
                <FileText className="w-4 h-4 text-[#D97706]" />
              </div>
              <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Bidding</span>
            </div>
            <div className="text-2xl sm:text-3xl font-mono tabular-nums font-semibold text-[#111]">
              {biddingProjects.length}
            </div>
            <div className="text-xs text-[#6B7280] mt-1 font-mono tabular-nums">{fmtMoney(biddingBidTotal)} bid value</div>
          </div>

          {/* Overall Margin */}
          <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${displayMarginPct >= 0 ? 'bg-[#ECFDF5]' : 'bg-[#FEF2F2]'}`}>
                <TrendingUp className={`w-4 h-4 ${displayMarginPct >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`} />
              </div>
              <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Margin</span>
            </div>
            <div className={`text-3xl font-mono tabular-nums font-semibold ${displayMarginPct >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
              {displayMarginPct >= 0 ? '+' : ''}{displayMarginPct.toFixed(1)}%
            </div>
            <div className="text-xs text-[#6B7280] mt-1 font-mono tabular-nums">
              {fmtMoney(displayVariance)} · {displayMarginLabel}
            </div>
          </div>
        </div>

        {/* ── Quick Upload ── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <button
            onClick={() => setUploadOpen(prev => !prev)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-[#F9FAFB] transition-colors"
          >
            <div className="flex items-center gap-2">
              <Receipt className="w-4 h-4 text-[#2563EB]" />
              <h2 className="text-base font-semibold">Quick Upload</h2>
              <span className="text-xs text-[#9CA3AF] ml-1">Parse a vendor invoice with AI</span>
            </div>
            {uploadOpen ? <ChevronUp className="w-4 h-4 text-[#9CA3AF]" /> : <ChevronDown className="w-4 h-4 text-[#9CA3AF]" />}
          </button>
          {uploadOpen && (
            <div className="px-6 pb-5 border-t border-[#E5E7EB] pt-4">
              <InvoiceParser />
            </div>
          )}
        </div>

        {/* ── MIDDLE: Projects At Risk ── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB]">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-[#D97706]" />
              <h2 className="text-base font-semibold">Projects At Risk</h2>
              <span className="text-xs text-[#9CA3AF] ml-1">Over budget or over hours</span>
            </div>
          </div>

          {atRiskProjects.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <CheckCircle2 className="w-8 h-8 text-[#059669] mx-auto mb-2" />
              <p className="text-sm font-medium text-[#111]">All projects on track</p>
              <p className="text-xs text-[#9CA3AF] mt-1">No active projects are trending over budget</p>
            </div>
          ) : (
            <div className="divide-y divide-[#F3F4F6]">
              {atRiskProjects.map(p => {
                const barColor = p.spentPct >= 100 ? 'bg-[#DC2626]' : p.spentPct >= 90 ? 'bg-[#EA580C]' : 'bg-[#D97706]'
                const textColor = p.spentPct >= 100 ? 'text-[#DC2626]' : p.spentPct >= 90 ? 'text-[#EA580C]' : 'text-[#D97706]'

                return (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-[#F9FAFB] transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="text-sm font-medium text-[#111] group-hover:text-[#2563EB] transition-colors truncate">
                          {p.name}
                        </span>
                        <span className={`text-xs font-mono tabular-nums font-semibold ${textColor}`}>
                          {p.spentPct.toFixed(0)}% spent
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6B7280]">
                        <span className="font-mono tabular-nums">Bid {fmtMoney(p.bidTotal)}</span>
                        <span className="font-mono tabular-nums">Actual {fmtMoney(p.actualTotal)}</span>
                        <span className={`font-mono tabular-nums font-medium ${p.variancePct >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                          {p.variancePct >= 0 ? '+' : ''}{p.variancePct.toFixed(1)}% variance
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="w-full h-1.5 bg-[#F3F4F6] rounded-full mt-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${Math.min(p.spentPct, 100)}%` }}
                        />
                      </div>
                      {/* Over-hours subprojects */}
                      {p.overHoursSubs.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {p.overHoursSubs.map(sub => (
                            <div key={sub.name} className="flex items-center gap-2 text-xs">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#DC2626] flex-shrink-0" />
                              <span className="text-[#DC2626] font-medium">{sub.name}</span>
                              <span className="text-[#9CA3AF] font-mono tabular-nums">{sub.actual}/{sub.estimated}h over</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <svg className="w-4 h-4 text-[#9CA3AF] group-hover:text-[#6B7280] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* ── AI SHOP REPORT ── */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#D97706]" />
              <h2 className="text-base font-semibold">AI Shop Report</h2>
            </div>
            <button
              onClick={async () => {
                if (!org?.id) return
                setReportLoading(true)
                try {
                  const res = await fetch('/api/shop-report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ org_id: org.id }),
                  })
                  const data = await res.json()
                  setReport(data.report || data.error || 'Failed to generate report')
                } catch (err) {
                  setReport('Failed to generate report')
                }
                setReportLoading(false)
              }}
              disabled={reportLoading}
              className="px-4 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {reportLoading ? 'Analyzing...' : 'Generate Report'}
            </button>
          </div>
          {report ? (
            <div className="px-6 py-4 text-sm text-[#374151] leading-relaxed whitespace-pre-wrap prose prose-sm max-w-none">
              {report.split('\n').map((line, i) => {
                if (line.startsWith('**') && line.endsWith('**')) {
                  return <p key={i} className="font-semibold text-[#111] mt-3 mb-1">{line.replace(/\*\*/g, '')}</p>
                }
                if (line.match(/^\d+\.\s\*\*/)) {
                  const clean = line.replace(/\*\*/g, '')
                  return <p key={i} className="font-semibold text-[#111] mt-4 mb-1">{clean}</p>
                }
                if (line.startsWith('- ') || line.startsWith('• ')) {
                  return <p key={i} className="ml-4 text-[#4B5563]">{line}</p>
                }
                if (line.trim()) {
                  return <p key={i} className="text-[#4B5563]">{line}</p>
                }
                return null
              })}
            </div>
          ) : (
            <div className="px-6 py-8 text-center text-sm text-[#9CA3AF]">
              Click "Generate Report" for an AI-powered analysis of your shop health, project status, and actionable insights.
            </div>
          )}
        </div>

        {/* ── BOTTOM ROW: Quick Actions ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          <Link
            href="/projects"
            className="flex items-center gap-3 bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 hover:border-[#2563EB] hover:bg-[#F9FAFB] transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl bg-[#2563EB] flex items-center justify-center flex-shrink-0">
              <Plus className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#111] group-hover:text-[#2563EB] transition-colors">New Project</div>
              <div className="text-xs text-[#9CA3AF]">Create a bid or job</div>
            </div>
          </Link>

          <Link
            href="/time"
            className="flex items-center gap-3 bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 hover:border-[#2563EB] hover:bg-[#F9FAFB] transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl bg-[#059669] flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#111] group-hover:text-[#2563EB] transition-colors">Start Timer</div>
              <div className="text-xs text-[#9CA3AF]">Track time on a project</div>
            </div>
          </Link>

          <Link
            href="/settings"
            className="flex items-center gap-3 bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 hover:border-[#2563EB] hover:bg-[#F9FAFB] transition-colors group"
          >
            <div className="w-10 h-10 rounded-xl bg-[#6B7280] flex items-center justify-center flex-shrink-0">
              <Settings className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-[#111] group-hover:text-[#2563EB] transition-colors">Shop Rate Calculator</div>
              <div className="text-xs text-[#9CA3AF]">Configure pricing inputs</div>
            </div>
          </Link>
        </div>
      </div>
    </>
  )
}
