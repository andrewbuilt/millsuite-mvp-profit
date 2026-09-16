'use client'

import { useState, useEffect, useMemo } from 'react'
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
  computeDerivedShopRate,
  emptyOverheadInputs,
  loadShopRateSetup,
  saveShopRate,
  sumBillableHoursYear,
  sumOverheadAnnual,
  sumTeamAnnualComp,
  type BillableHoursInputs,
  type TeamMember,
} from '@/lib/shop-rate-setup'
import { loadProjectDeptHours } from '@/lib/project-hours'
import MarginsCard from './components/MarginsCard'
import ShopGrade from './components/ShopGrade'
import CompletedProjects from './components/CompletedProjects'
import OutlookSection from './components/OutlookSection'
import DiagnosticDrawer from './components/DiagnosticDrawer'
import AiShopReport from './components/AiShopReport'
import { loadPracticeProjectIds } from '@/lib/practice'

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

// ── Margins card data (moved off /team 2026-09-15) ──────────────────────────

interface MarginsData {
  breakEven: number
  shopRate: number
  snapshots: Array<{ id: string; effective_rate: number; created_at: string }>
  alerts: Array<{ id: string; name: string; effRate: number; belowBreakEven: boolean }>
  /** Kept so the promote-rate write can snapshot the inputs behind the rate. */
  overhead: ReturnType<typeof emptyOverheadInputs>
  team: TeamMember[]
  billable: BillableHoursInputs
}

/**
 * Everything the Margins card needs, or NULL if the caller may not see money.
 *
 * ⛔ THE GATE IS /api/team/setup, NOT A CLIENT-SIDE READ. That endpoint is the
 * one authority on "can this person see comp" — it strips every money figure
 * server-side for non-owners. /reports has no role check of its own, so
 * fetching `orgs` directly here would quietly expose break-even and the margin
 * ladder to every manager who can open this page.
 */
async function loadMarginsData(orgId: string): Promise<MarginsData | null> {
  const { data: session } = await supabase.auth.getSession()
  const res = await fetch('/api/team/setup', {
    headers: { Authorization: `Bearer ${session.session?.access_token ?? ''}` },
    // The derived rate is computed from this payload and the inputs are edited
    // on /team and Settings — a cached response shows a stale ladder.
    cache: 'no-store',
  })
  if (!res.ok) return null
  const setup = await res.json()
  if (!setup?.canSeeComp) return null

  const overhead = setup.overhead || emptyOverheadInputs()
  const team = (setup.team || []) as TeamMember[]
  const billable = setup.billable as BillableHoursInputs
  const breakEven = computeDerivedShopRate(overhead, team, billable)

  const { data: snaps } = await supabase
    .from('shop_rate_snapshots')
    .select('id, effective_rate, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(8)

  // Margin alerts: active projects whose effective rate sits under break-even
  // +15%. N parallel calls, same as it was on /team — fine at beta scale.
  let alerts: MarginsData['alerts'] = []
  if (breakEven > 0) {
    const { data: projs } = await supabase
      .from('projects')
      .select('id, name, bid_total, stage')
      .eq('org_id', orgId)
      .in('stage', ['sold', 'production', 'installed'])
    const threshold = breakEven * 1.15
    const rows = await Promise.all(
      ((projs || []) as Array<{ id: string; name: string; bid_total: number }>).map(async (p) => {
        const { totalHours } = await loadProjectDeptHours(orgId, p.id)
        if (!totalHours || totalHours <= 0 || !p.bid_total) return null
        const effRate = p.bid_total / totalHours
        if (effRate >= threshold) return null
        return { id: p.id, name: p.name, effRate, belowBreakEven: effRate < breakEven }
      }),
    )
    alerts = rows.filter(Boolean).sort((a, b) => a!.effRate - b!.effRate) as MarginsData['alerts']
  }

  return {
    breakEven,
    shopRate: Number(setup.shopRate) || 0,
    snapshots: (snaps || []) as MarginsData['snapshots'],
    alerts,
    overhead,
    team,
    billable,
  }
}

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

  // Margins card (moved off /team). NULL for anyone who may not see money.
  const [margins, setMargins] = useState<MarginsData | null>(null)
  const [savingRate, setSavingRate] = useState(false)

  useEffect(() => {
    if (org?.id) loadData()
  }, [org?.id, period])

  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    void loadMarginsData(org.id)
      .then((m) => {
        if (!cancelled) setMargins(m)
      })
      .catch(() => {
        // A failed load must leave the card HIDDEN, not half-rendered with
        // zeros — a break-even of $0 reads as "every job is profitable".
        if (!cancelled) setMargins(null)
      })
    return () => {
      cancelled = true
    }
  }, [org?.id])

  /**
   * Promote the derived rate to the shop rate, and snapshot the inputs behind
   * it. Moved verbatim from /team with the card.
   *
   * ⚠️ The snapshot is best-effort: the rate is already saved by then, so a
   * snapshot failure must not read as "the save failed".
   */
  async function promoteRate() {
    if (!org?.id || !margins || margins.breakEven <= 0) return
    setSavingRate(true)
    try {
      const rate = Math.round(margins.breakEven * 100) / 100
      await saveShopRate(org.id, rate)
      try {
        await supabase.from('shop_rate_snapshots').insert({
          org_id: org.id,
          effective_rate: rate,
          overhead_monthly: sumOverheadAnnual(margins.overhead) / 12,
          labor_cost_monthly: sumTeamAnnualComp(margins.team) / 12,
          billable_hours_monthly: sumBillableHoursYear(margins.team, margins.billable) / 12,
          utilization_pct: margins.billable.utilization_pct,
        })
      } catch (e) {
        console.warn('shop rate snapshot', e)
      }
      setMargins(await loadMarginsData(org.id))
    } catch (e) {
      console.error('promote shop rate', e)
    } finally {
      setSavingRate(false)
    }
  }

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

      // Completed practice jobs would otherwise teach the learning loop from
      // work that never happened.
      const practice = await loadPracticeProjectIds(org!.id)
      const outcomes = (outcomesRes.data || []).filter(
        (o: any) => !practice.has(o.project_id),
      )

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

  if (loading) {
    return (
      <>
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

          {/* ⛔ THE "Total profit" / "Avg margin" KpiCards THAT USED TO SIT HERE
              NOW LIVE INSIDE <CompletedProjects>, on the same card as the jobs
              they summarise. They were two free-floating cards above the chart,
              which is how the page came to show 23.8% in amber up here against
              a 28.7% green summary row down there — the same seven jobs, two
              containers, opposite verdicts. One card, one render, one source.
              ⚠️ Do not reintroduce a shop-level figure on this page without
              deriving it from the same `completedProjects` the chart draws. */}

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

          {/* Moved off /dashboard 2026-09-12. Sits between what happened and
              what's coming because it narrates both. */}
          <AiShopReport />

          {/* ⛔ MOVED OFF /team 2026-09-15 (team upgrade item 2), AND IT IS
              OWNER-ONLY. `margins` stays null unless /api/team/setup says
              `canSeeComp` — that endpoint strips every money figure
              server-side for non-owners, and THIS page has no role check of
              its own. Rendering the ladder without that gate would hand
              break-even and per-project effective rates to any manager who can
              open Reports. */}
          {margins && (
            <>
              <div className="border-t border-[#E5E7EB]" />
              <MarginsCard
                breakEven={margins.breakEven}
                shopRate={margins.shopRate}
                saving={savingRate}
                onSave={promoteRate}
                snapshots={margins.snapshots}
                alerts={margins.alerts}
              />
            </>
          )}

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
