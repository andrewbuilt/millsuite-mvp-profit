'use client'

import { useState, useEffect } from 'react'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import {
  computeShopGrade,
  computeUtilizationConfidence,
  computeOutcomeSummary,
  type ProjectOutcome,
  type WeeklySnapshot,
} from '@/lib/financial-engine'
import { Camera, Lock } from 'lucide-react'

// ── Types ──

type OutcomeRow = ProjectOutcome & { projects: { name: string } }

type Period = '90d' | '6m' | '1y'

// ── Helpers ──

function fmtMoney(n: number): string {
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function periodStartDate(period: Period): string {
  const now = new Date()
  switch (period) {
    case '90d':
      now.setDate(now.getDate() - 90)
      break
    case '6m':
      now.setMonth(now.getMonth() - 6)
      break
    case '1y':
      now.setFullYear(now.getFullYear() - 1)
      break
  }
  return now.toISOString()
}

function gradeColor(grade: string): { bg: string; text: string; ring: string } {
  switch (grade) {
    case 'A': return { bg: 'bg-[#ECFDF5]', text: 'text-[#059669]', ring: 'ring-[#059669]/20' }
    case 'B': return { bg: 'bg-[#EFF6FF]', text: 'text-[#2563EB]', ring: 'ring-[#2563EB]/20' }
    case 'C': return { bg: 'bg-[#FFFBEB]', text: 'text-[#D97706]', ring: 'ring-[#D97706]/20' }
    case 'D': return { bg: 'bg-[#FFF7ED]', text: 'text-[#EA580C]', ring: 'ring-[#EA580C]/20' }
    default:  return { bg: 'bg-[#FEF2F2]', text: 'text-[#DC2626]', ring: 'ring-[#DC2626]/20' }
  }
}

function marginBarColor(pct: number): string {
  if (pct >= 25) return 'bg-[#059669]'
  if (pct >= 15) return 'bg-[#D97706]'
  return 'bg-[#DC2626]'
}

function confidenceBanner(status: 'healthy' | 'warning' | 'critical'): { bg: string; border: string; text: string; icon: string } {
  switch (status) {
    case 'healthy':  return { bg: 'bg-[#ECFDF5]', border: 'border-[#059669]/20', text: 'text-[#059669]', icon: 'text-[#059669]' }
    case 'warning':  return { bg: 'bg-[#FFFBEB]', border: 'border-[#D97706]/20', text: 'text-[#92400E]', icon: 'text-[#D97706]' }
    case 'critical': return { bg: 'bg-[#FEF2F2]', border: 'border-[#DC2626]/20', text: 'text-[#991B1B]', icon: 'text-[#DC2626]' }
  }
}

// ── Tab types ──

type Tab = 'outcomes' | 'diagnostics' | 'trajectory'

// ── Main Page ──

export default function ReportsPage() {
  const { org } = useAuth()
  const plan = org?.plan || 'starter'

  const [activeTab, setActiveTab] = useState<Tab>('outcomes')
  const [period, setPeriod] = useState<Period>('90d')
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([])
  const [snapshot, setSnapshot] = useState<WeeklySnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [snapshotLoading, setSnapshotLoading] = useState(false)

  useEffect(() => {
    if (org?.id) loadData()
  }, [org?.id, period])

  async function loadData() {
    setLoading(true)
    const startDate = periodStartDate(period)

    const [outcomesRes, snapshotRes] = await Promise.all([
      supabase
        .from('project_outcomes')
        .select('*, projects!inner(name)')
        .eq('org_id', org!.id)
        .gte('completed_at', startDate)
        .order('completed_at', { ascending: false }),
      supabase
        .from('weekly_snapshots')
        .select('*')
        .eq('org_id', org!.id)
        .order('week_start', { ascending: false })
        .limit(1)
        .single(),
    ])

    setOutcomes((outcomesRes.data as OutcomeRow[]) || [])
    setSnapshot(snapshotRes.data as WeeklySnapshot | null)
    setLoading(false)
  }

  async function takeSnapshot() {
    if (!org?.id) return
    setSnapshotLoading(true)
    try {
      await fetch('/api/weekly-snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org.id }),
      })
      await loadData()
    } catch {
      // silent
    }
    setSnapshotLoading(false)
  }

  // Computed
  const outcomesWithName = outcomes.map(o => ({
    ...o,
    project_name: o.projects?.name || 'Unknown',
  }))

  const grade = computeShopGrade(outcomesWithName, snapshot)
  const confidence = snapshot
    ? computeUtilizationConfidence(
        snapshot.utilization_assumed,
        snapshot.billable_hours,
        snapshot.paid_hours
      )
    : null
  const summary = computeOutcomeSummary(outcomesWithName)

  const gc = gradeColor(grade.overall)
  const pgc = gradeColor(grade.projectGrade)
  const sgc = gradeColor(grade.shopGrade)

  // ── Loading skeleton ──

  if (loading) {
    return (
      <>
        <Nav />
        <div className="min-h-screen bg-[#F9FAFB]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
            <div className="h-8 w-32 bg-[#E5E7EB] rounded-lg animate-pulse mb-6" />
            {/* Tab skeleton */}
            <div className="flex gap-2 mb-6">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-9 w-28 bg-[#E5E7EB] rounded-lg animate-pulse" />
              ))}
            </div>
            {/* Grade skeleton */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-6">
              <div className="flex items-center gap-6">
                <div className="w-24 h-24 rounded-2xl bg-[#E5E7EB] animate-pulse" />
                <div className="flex-1 space-y-3">
                  <div className="h-4 w-48 bg-[#E5E7EB] rounded animate-pulse" />
                  <div className="h-3 w-full bg-[#E5E7EB] rounded animate-pulse" />
                  <div className="h-4 w-48 bg-[#E5E7EB] rounded animate-pulse mt-4" />
                  <div className="h-3 w-full bg-[#E5E7EB] rounded animate-pulse" />
                </div>
              </div>
            </div>
            {/* Banner skeleton */}
            <div className="h-14 bg-[#E5E7EB] rounded-xl animate-pulse mb-6" />
            {/* Cards skeleton */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-5">
                  <div className="h-3 w-20 bg-[#E5E7EB] rounded animate-pulse mb-3" />
                  <div className="h-8 w-28 bg-[#E5E7EB] rounded animate-pulse" />
                </div>
              ))}
            </div>
            {/* Bars skeleton */}
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 space-y-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex items-center gap-4">
                  <div className="h-4 w-32 bg-[#E5E7EB] rounded animate-pulse" />
                  <div className="flex-1 h-6 bg-[#E5E7EB] rounded animate-pulse" />
                  <div className="h-4 w-20 bg-[#E5E7EB] rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    )
  }

  // ── Render ──

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-[#F9FAFB]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* ── Header ── */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-[#111]">Reports</h1>
            <button
              onClick={takeSnapshot}
              disabled={snapshotLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
              {snapshotLoading ? 'Taking...' : 'Take Snapshot'}
            </button>
          </div>

          {/* ── Tabs ── */}
          <div className="flex gap-1 mb-6 bg-white border border-[#E5E7EB] rounded-xl p-1 w-fit">
            {(['outcomes', 'diagnostics', 'trajectory'] as Tab[]).map(tab => {
              const label = tab.charAt(0).toUpperCase() + tab.slice(1)
              const isActive = activeTab === tab
              const isLocked = tab !== 'outcomes' && !hasAccess(plan, tab)

              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#F3F4F6] text-[#111]'
                      : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
                  }`}
                >
                  {isLocked && <Lock className="w-3 h-3 text-[#9CA3AF]" />}
                  {label}
                </button>
              )
            })}
          </div>

          {/* ── Tab Content ── */}
          {activeTab === 'outcomes' && (
            <PlanGate requires="outcomes">
              <OutcomesView
                outcomes={outcomesWithName}
                grade={grade}
                confidence={confidence}
                summary={summary}
                gc={gc}
                pgc={pgc}
                sgc={sgc}
                period={period}
                setPeriod={setPeriod}
              />
            </PlanGate>
          )}

          {activeTab === 'diagnostics' && (
            <PlanGate requires="diagnostics">
              <div />
            </PlanGate>
          )}

          {activeTab === 'trajectory' && (
            <PlanGate requires="trajectory">
              <div />
            </PlanGate>
          )}
        </div>
      </div>
    </>
  )
}

// ── Outcomes View ──

function OutcomesView({
  outcomes,
  grade,
  confidence,
  summary,
  gc,
  pgc,
  sgc,
  period,
  setPeriod,
}: {
  outcomes: (ProjectOutcome & { project_name: string })[]
  grade: ReturnType<typeof computeShopGrade>
  confidence: ReturnType<typeof computeUtilizationConfidence> | null
  summary: ReturnType<typeof computeOutcomeSummary>
  gc: { bg: string; text: string; ring: string }
  pgc: { bg: string; text: string; ring: string }
  sgc: { bg: string; text: string; ring: string }
  period: Period
  setPeriod: (p: Period) => void
}) {
  // ── Empty state ──
  if (outcomes.length === 0 && !confidence) {
    return (
      <div className="space-y-6">
        {/* Period selector */}
        <PeriodSelector period={period} setPeriod={setPeriod} />

        <div className="bg-white border border-[#E5E7EB] rounded-xl px-6 py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-[#9CA3AF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
            </svg>
          </div>
          <h2 className="text-base font-semibold text-[#111] mb-1">No completed projects in this period</h2>
          <p className="text-sm text-[#6B7280] max-w-md mx-auto leading-relaxed">
            Project outcomes are captured automatically when projects are marked complete. Complete a project to see your shop grade and margin analysis here.
          </p>
        </div>
      </div>
    )
  }

  // Max margin for bar scaling
  const maxMarginAbs = outcomes.length > 0
    ? Math.max(...outcomes.map(o => Math.abs(o.actual_margin_pct)), 30)
    : 30

  return (
    <div className="space-y-6">
      {/* ── Period Selector ── */}
      <PeriodSelector period={period} setPeriod={setPeriod} />

      {/* ── 1. Shop Grade ── */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          {/* Big grade circle */}
          <div className={`w-24 h-24 rounded-2xl ${gc.bg} ring-2 ${gc.ring} flex items-center justify-center flex-shrink-0`}>
            <span className={`text-5xl font-bold ${gc.text}`}>{grade.overall}</span>
          </div>

          <div className="flex-1 min-w-0 w-full">
            <h2 className="text-lg font-semibold text-[#111] mb-1">Shop Grade</h2>
            <p className="text-xs text-[#9CA3AF] mb-4">
              Composite score: {grade.overallScore}/100
            </p>

            {/* Project Execution */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-[#374151]">Project Execution</span>
                <span className={`text-sm font-semibold ${pgc.text}`}>{grade.projectGrade} ({grade.projectScore})</span>
              </div>
              <div className="w-full h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${pgc.text.replace('text-', 'bg-')}`}
                  style={{ width: `${Math.min(grade.projectScore, 100)}%` }}
                />
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-[#9CA3AF]">
                <span>Hit rate: {grade.estimateHitRate}%</span>
                <span>Avg margin: {grade.avgMargin}%</span>
              </div>
            </div>

            {/* Shop Efficiency */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-[#374151]">Shop Efficiency</span>
                <span className={`text-sm font-semibold ${sgc.text}`}>{grade.shopGrade} ({grade.shopScore})</span>
              </div>
              <div className="w-full h-2 bg-[#F3F4F6] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${sgc.text.replace('text-', 'bg-')}`}
                  style={{ width: `${Math.min(grade.shopScore, 100)}%` }}
                />
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-[#9CA3AF]">
                <span>Utilization gap: {grade.utilizationGap > 0 ? '+' : ''}{grade.utilizationGap}pts</span>
                {grade.marginOverstatement > 0 && (
                  <span>Margin overstatement: ~{grade.marginOverstatement}pts</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Utilization Confidence Band ── */}
      {confidence && (
        <ConfidenceBanner confidence={confidence} />
      )}

      {/* ── 3. Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard
          label="Total Billed"
          value={fmtMoney(summary.totalRevenue)}
          sub={`${summary.totalProjects} project${summary.totalProjects !== 1 ? 's' : ''}`}
        />
        <SummaryCard
          label="Total Profit"
          value={fmtMoney(summary.totalProfit)}
          valueColor={summary.totalProfit >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}
        />
        <SummaryCard
          label="Avg Margin"
          value={`${summary.avgMargin}%`}
          valueColor={summary.avgMargin >= 25 ? 'text-[#059669]' : summary.avgMargin >= 15 ? 'text-[#D97706]' : 'text-[#DC2626]'}
          sub={`Target: 25%`}
        />
        <SummaryCard
          label="Estimate Hit Rate"
          value={`${summary.estimateHitRate}%`}
          valueColor={summary.estimateHitRate >= 80 ? 'text-[#059669]' : summary.estimateHitRate >= 60 ? 'text-[#D97706]' : 'text-[#DC2626]'}
          sub="Within 5% of estimate"
        />
      </div>

      {/* ── 4. Project Margin Bars ── */}
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E5E7EB]">
          <h2 className="text-base font-semibold text-[#111]">Project Margins</h2>
          <p className="text-xs text-[#9CA3AF] mt-0.5">Completed projects by margin performance</p>
        </div>

        {outcomes.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[#9CA3AF]">
            No completed projects in this period.
          </div>
        ) : (
          <div className="divide-y divide-[#F3F4F6]">
            {outcomes.map(outcome => {
              const marginPct = outcome.actual_margin_pct
              const barWidth = Math.max(Math.abs(marginPct) / maxMarginAbs * 100, 2)
              const targetPosition = (25 / maxMarginAbs) * 100
              const isNegative = marginPct < 0

              return (
                <div key={outcome.id} className="flex items-center gap-4 px-6 py-3.5 hover:bg-[#F9FAFB] transition-colors">
                  {/* Project name */}
                  <div className="w-40 sm:w-52 flex-shrink-0 truncate">
                    <span className="text-sm font-medium text-[#111]">
                      {(outcome as any).project_name || 'Unknown'}
                    </span>
                    <div className="text-xs text-[#9CA3AF] font-mono tabular-nums">
                      {new Date(outcome.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>

                  {/* Bar area */}
                  <div className="flex-1 relative h-7">
                    {/* Background */}
                    <div className="absolute inset-0 bg-[#F3F4F6] rounded" />

                    {/* Actual margin bar */}
                    <div
                      className={`absolute top-0 bottom-0 rounded transition-all duration-500 ${marginBarColor(marginPct)} ${isNegative ? 'opacity-80' : ''}`}
                      style={{ width: `${Math.min(barWidth, 100)}%` }}
                    />

                    {/* Target line at 25% */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-[#111]/20"
                      style={{ left: `${Math.min(targetPosition, 100)}%` }}
                    >
                      <div className="absolute -top-4 left-1/2 -translate-x-1/2 text-[9px] text-[#9CA3AF] whitespace-nowrap">
                        25%
                      </div>
                    </div>
                  </div>

                  {/* Margin value */}
                  <div className="w-28 sm:w-32 flex-shrink-0 text-right">
                    <span className={`text-sm font-semibold font-mono tabular-nums ${
                      marginPct >= 25 ? 'text-[#059669]' : marginPct >= 15 ? 'text-[#D97706]' : 'text-[#DC2626]'
                    }`}>
                      {marginPct >= 0 ? '+' : ''}{marginPct.toFixed(1)}%
                    </span>
                    <div className="text-xs text-[#9CA3AF] font-mono tabular-nums">
                      {fmtMoney(outcome.actual_margin)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──

function PeriodSelector({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  const options: { value: Period; label: string }[] = [
    { value: '90d', label: '90 days' },
    { value: '6m', label: '6 months' },
    { value: '1y', label: '1 year' },
  ]

  return (
    <div className="flex items-center gap-1 bg-white border border-[#E5E7EB] rounded-xl p-1 w-fit">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => setPeriod(opt.value)}
          className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            period === opt.value
              ? 'bg-[#F3F4F6] text-[#111]'
              : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  valueColor = 'text-[#111]',
}: {
  label: string
  value: string
  sub?: string
  valueColor?: string
}) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
      <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">{label}</span>
      <div className={`text-2xl sm:text-3xl font-mono tabular-nums font-semibold mt-2 ${valueColor}`}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-[#9CA3AF] mt-1">{sub}</div>
      )}
    </div>
  )
}

function ConfidenceBanner({ confidence }: { confidence: NonNullable<ReturnType<typeof computeUtilizationConfidence>> }) {
  const style = confidenceBanner(confidence.status)

  const icon = confidence.status === 'healthy' ? (
    <svg className={`w-5 h-5 ${style.icon} flex-shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  ) : (
    <svg className={`w-5 h-5 ${style.icon} flex-shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
    </svg>
  )

  return (
    <div className={`${style.bg} border ${style.border} rounded-xl px-5 py-3.5 flex items-start gap-3`}>
      {icon}
      <div>
        <span className={`text-sm font-medium ${style.text}`}>Utilization Confidence</span>
        <p className={`text-sm ${style.text} mt-0.5`}>{confidence.message}</p>
      </div>
    </div>
  )
}
