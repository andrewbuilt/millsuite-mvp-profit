'use client'

import { useState, useEffect, useMemo } from 'react'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import {
  computeShopGradeV2,
  type CompletedProject,
} from '@/lib/reports/gradeCalculations'
import { getNextMonthKeys, type BookedProject } from '@/lib/reports/outlookCalculations'
import { loadBookedProjects } from '@/lib/reports/bookedProjects'
import {
  countBillable,
  loadShopRateSetup,
  sumOverheadAnnual,
  sumTeamAnnualComp,
} from '@/lib/shop-rate-setup'
import ShopGrade from './components/ShopGrade'
import CompletedProjects from './components/CompletedProjects'
import OutlookSection from './components/OutlookSection'
import KpiCard from './components/KpiCard'
import DiagnosticDrawer from './components/DiagnosticDrawer'

// ── Period selector ──

type Period = '90d' | '6m' | '1y'

function periodStartDate(period: Period): string {
  const now = new Date()
  switch (period) {
    case '90d': now.setDate(now.getDate() - 90); break
    case '6m':  now.setMonth(now.getMonth() - 6); break
    case '1y':  now.setFullYear(now.getFullYear() - 1); break
  }
  return now.toISOString()
}

function fmtMoney(n: number): string {
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// ── Shop config defaults ──
// Used when the org hasn't filled in the underlying jsonb columns yet.
// Live values flow in from orgs.team_members + orgs.overhead_inputs +
// org.profit_margin_pct as soon as they're populated.
const DEFAULT_CONFIG = {
  crewSize: 0,
  overhead: 0,
  avgWage: 0,
  utilizationTarget: 80, // default until calibrated
  marginTarget: 25, // default until org.profit_margin_pct is set
  utilizationPct: 0, // historical actuals — 0 until time-entries data feeds it
}

const HRS_PER_FT_YEAR = 2080

// ── Main page ──

export default function ReportsPage() {
  const { org } = useAuth()
  const [period, setPeriod] = useState<Period>('90d')
  const [completedProjects, setCompletedProjects] = useState<CompletedProject[]>([])
  const [bookedProjects, setBookedProjects] = useState<BookedProject[]>([])
  const [shopConfig, setShopConfig] = useState(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<CompletedProject | null>(null)

  const monthKeys = useMemo(() => getNextMonthKeys(8), [])

  useEffect(() => {
    if (org?.id) loadData()
  }, [org?.id, period])

  async function loadData() {
    setLoading(true)
    const startDate = periodStartDate(period)

    try {
      const [outcomesRes, booked, shopSetup] = await Promise.all([
        supabase
          .from('project_outcomes')
          .select('*, projects!inner(name)')
          .eq('org_id', org!.id)
          .gte('completed_at', startDate)
          .order('completed_at', { ascending: false }),
        loadBookedProjects(org!.id),
        loadShopRateSetup(org!.id),
      ])

      const outcomes = outcomesRes.data || []

      setCompletedProjects(
        outcomes.map((o: any) => ({
          id: o.id,
          name: o.projects?.name || 'Unknown',
          completionDate: o.completed_at,
          estimatedHours: o.estimated_hours,
          actualHours: o.actual_hours,
          revenue: o.actual_revenue,
          profit: o.actual_margin,
          marginPct: o.actual_margin_pct,
          estimatedMaterials: o.estimated_materials,
          actualMaterials: o.actual_materials,
          estimatedPrice: o.estimated_price,
          changeOrderCount: o.change_order_count,
          changeOrderRevenue: o.change_order_revenue,
          shopRate: o.shop_rate_at_completion,
        })),
      )
      setBookedProjects(booked)

      // Crew config — derived live from orgs.team_members + .overhead_inputs.
      // Headcount = billable members (count). Monthly overhead = annual / 12.
      // Avg wage = annual team comp / (billable count × 2080 hr/yr).
      const billable = countBillable(shopSetup.team)
      const annualOverhead = sumOverheadAnnual(shopSetup.overhead)
      const annualTeamComp = sumTeamAnnualComp(shopSetup.team)
      const monthlyOverhead = annualOverhead / 12
      const avgWage =
        billable > 0 && annualTeamComp > 0
          ? annualTeamComp / (billable * HRS_PER_FT_YEAR)
          : 0
      const marginTarget = org?.profit_margin_pct ?? DEFAULT_CONFIG.marginTarget

      setShopConfig({
        crewSize: billable,
        overhead: monthlyOverhead,
        avgWage,
        utilizationTarget: DEFAULT_CONFIG.utilizationTarget,
        marginTarget,
        utilizationPct: DEFAULT_CONFIG.utilizationPct,
      })
    } catch (err) {
      console.error('reports loadData', err)
      setCompletedProjects([])
      setBookedProjects([])
      setShopConfig(DEFAULT_CONFIG)
    }

    setLoading(false)
  }

  const gradeResult = useMemo(
    () => computeShopGradeV2(completedProjects, shopConfig.utilizationPct),
    [completedProjects, shopConfig.utilizationPct]
  )

  const totalProfit = completedProjects.reduce((s, p) => s + p.profit, 0)
  const avgMargin = completedProjects.length > 0
    ? completedProjects.reduce((s, p) => s + p.marginPct, 0) / completedProjects.length
    : 0

  if (loading) {
    return (
      <>
        <Nav />
        <div className="min-h-screen bg-[#F9FAFB]">
          <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
            <div className="h-7 w-24 bg-[#E5E7EB] rounded-lg animate-pulse" />
            <div className="h-5 w-64 bg-[#E5E7EB] rounded animate-pulse" />
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 h-40 animate-pulse" />
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#F3F4F6] rounded-xl h-20 animate-pulse" />
              <div className="bg-[#F3F4F6] rounded-xl h-20 animate-pulse" />
            </div>
            <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 h-32 animate-pulse" />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-[#F9FAFB]">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-[#111]">Reports</h1>
            <p className="text-sm text-[#6B7280] mt-0.5">Your shop&apos;s health and where it&apos;s heading</p>
          </div>

          {/* Period selector */}
          <PeriodSelector period={period} setPeriod={setPeriod} />

          {/* ═══ TOP HALF: What happened ═══ */}

          <ShopGrade grade={gradeResult} />

          <div className="grid grid-cols-2 gap-3">
            {completedProjects.length === 0 ? (
              <>
                <KpiCard
                  label="Total profit"
                  value="—"
                  sub="Awaiting completed projects"
                />
                <KpiCard
                  label="Avg margin"
                  value="—"
                  sub="Awaiting completed projects"
                />
              </>
            ) : (
              <>
                <KpiCard
                  label="Total profit"
                  value={fmtMoney(totalProfit)}
                  sub={`${completedProjects.length} project${completedProjects.length === 1 ? '' : 's'} completed`}
                  valueColor={totalProfit >= 0 ? '#059669' : '#DC2626'}
                />
                <KpiCard
                  label="Avg margin"
                  value={`${avgMargin.toFixed(1)}%`}
                  sub={`Target: ${shopConfig.marginTarget}%`}
                  valueColor={avgMargin >= shopConfig.marginTarget ? '#059669' : avgMargin >= shopConfig.marginTarget - 5 ? '#D97706' : '#DC2626'}
                />
              </>
            )}
          </div>

          {/* Diagnostics drawer is Pro+ only — gate the click handler so
              Profit/Pro users see the table but can't open the margin
              waterfall drawer. The 'diagnostics' feature key is in
              PRO_AI_FEATURES per PR #113. */}
          <CompletedProjects
            projects={completedProjects}
            marginTarget={shopConfig.marginTarget}
            onProjectClick={hasAccess(org?.plan, 'diagnostics') ? setSelectedProject : undefined}
          />

          {/* ═══ DIVIDER ═══ */}
          <div className="border-t border-[#E5E7EB]" />

          {/* ═══ BOTTOM HALF: What's coming ═══ */}
          <OutlookSection
            projects={bookedProjects}
            currentHeadcount={shopConfig.crewSize}
            overhead={shopConfig.overhead}
            avgWage={shopConfig.avgWage}
            monthKeys={monthKeys}
          />
        </div>
      </div>

      {/* Diagnostic drawer */}
      <DiagnosticDrawer
        project={selectedProject}
        onClose={() => setSelectedProject(null)}
      />
    </>
  )
}

function PeriodSelector({ period, setPeriod }: { period: Period; setPeriod: (p: Period) => void }) {
  const options: { value: Period; label: string }[] = [
    { value: '90d', label: '90 days' },
    { value: '6m', label: '6 months' },
    { value: '1y', label: '1 year' },
  ]

  return (
    <div className="flex gap-0 border border-[#E5E7EB] rounded-xl overflow-hidden w-fit">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => setPeriod(opt.value)}
          className={`px-4 py-1.5 text-sm transition-colors ${
            period === opt.value
              ? 'bg-[#111] text-white font-medium'
              : 'text-[#6B7280] hover:text-[#111] bg-transparent'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
