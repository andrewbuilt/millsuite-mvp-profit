'use client'

import { useState, useEffect, useMemo } from 'react'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import {
  computeShopGradeV2,
  type CompletedProject,
} from '@/lib/reports/gradeCalculations'
import { getNextMonthKeys, type BookedProject } from '@/lib/reports/outlookCalculations'
import ShopGrade from './components/ShopGrade'
import CompletedProjects from './components/CompletedProjects'
import OutlookSection from './components/OutlookSection'
import KpiCard from './components/KpiCard'

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

// ── Seed data for demo ──

const DEMO_COMPLETED: CompletedProject[] = [
  {
    id: 'demo-1',
    name: 'Westshore Law Office',
    completionDate: '2026-04-04',
    estimatedHours: 400,
    actualHours: 420,
    revenue: 122500,
    profit: 35600,
    marginPct: 29.1,
  },
  {
    id: 'demo-2',
    name: 'Davis Island Residence',
    completionDate: '2026-03-28',
    estimatedHours: 580,
    actualHours: 640,
    revenue: 152000,
    profit: 34450,
    marginPct: 22.7,
  },
]

const DEMO_BOOKED: BookedProject[] = [
  { name: 'Bayshore Condos (3 units)', estimatedHours: 1800, startMonth: '2026-03', endMonth: '2026-06' },
  { name: 'Hyde Park Kitchen Remodel', estimatedHours: 320, startMonth: '2026-04', endMonth: '2026-05' },
  { name: 'Channel District Office', estimatedHours: 640, startMonth: '2026-05', endMonth: '2026-07' },
  { name: 'Harbour Island Master Bath', estimatedHours: 180, startMonth: '2026-06', endMonth: '2026-06' },
]

const DEMO_CONFIG = {
  crewSize: 14,
  overhead: 45000,
  avgWage: 28,
  utilizationTarget: 80,
  marginTarget: 25,
  utilizationPct: 78,
}

// ── Main page ──

export default function ReportsPage() {
  const { org } = useAuth()
  const [period, setPeriod] = useState<Period>('90d')
  const [completedProjects, setCompletedProjects] = useState<CompletedProject[]>([])
  const [bookedProjects, setBookedProjects] = useState<BookedProject[]>([])
  const [shopConfig, setShopConfig] = useState(DEMO_CONFIG)
  const [loading, setLoading] = useState(true)

  const monthKeys = useMemo(() => getNextMonthKeys(6), [])

  useEffect(() => {
    if (org?.id) loadData()
  }, [org?.id, period])

  async function loadData() {
    setLoading(true)
    const startDate = periodStartDate(period)

    try {
      const [outcomesRes, projectsRes, teamRes] = await Promise.all([
        supabase
          .from('project_outcomes')
          .select('*, projects!inner(name)')
          .eq('org_id', org!.id)
          .gte('completed_at', startDate)
          .order('completed_at', { ascending: false }),
        supabase
          .from('projects')
          .select('id, name, estimated_hours, start_date, target_completion_date')
          .eq('org_id', org!.id)
          .in('status', ['in_production', 'scheduled']),
        supabase
          .from('team_members')
          .select('id')
          .eq('org_id', org!.id)
          .eq('status', 'active'),
      ])

      const outcomes = outcomesRes.data || []
      const projects = projectsRes.data || []
      const teamCount = teamRes.data?.length || 0

      if (outcomes.length > 0) {
        setCompletedProjects(outcomes.map((o: any) => ({
          id: o.id,
          name: o.projects?.name || 'Unknown',
          completionDate: o.completed_at,
          estimatedHours: o.estimated_hours,
          actualHours: o.actual_hours,
          revenue: o.actual_revenue,
          profit: o.actual_margin,
          marginPct: o.actual_margin_pct,
        })))
      } else {
        setCompletedProjects(DEMO_COMPLETED)
      }

      if (projects.length > 0) {
        setBookedProjects(projects.map((p: any) => {
          const start = p.start_date ? p.start_date.substring(0, 7) : monthKeys[0]
          const end = p.target_completion_date ? p.target_completion_date.substring(0, 7) : monthKeys[2]
          return {
            name: p.name,
            estimatedHours: p.estimated_hours || 0,
            startMonth: start,
            endMonth: end,
          }
        }).filter((p: BookedProject) => p.estimatedHours > 0))
      } else {
        setBookedProjects(DEMO_BOOKED)
      }

      if (teamCount > 0) {
        setShopConfig(prev => ({ ...prev, crewSize: teamCount }))
      }
    } catch {
      setCompletedProjects(DEMO_COMPLETED)
      setBookedProjects(DEMO_BOOKED)
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
            <KpiCard
              label="Total profit"
              value={fmtMoney(totalProfit)}
              sub={`${completedProjects.length} projects completed`}
              valueColor={totalProfit >= 0 ? '#059669' : '#DC2626'}
            />
            <KpiCard
              label="Avg margin"
              value={`${avgMargin.toFixed(1)}%`}
              sub={`Target: ${shopConfig.marginTarget}%`}
              valueColor={avgMargin >= shopConfig.marginTarget ? '#059669' : avgMargin >= shopConfig.marginTarget - 5 ? '#D97706' : '#DC2626'}
            />
          </div>

          <CompletedProjects
            projects={completedProjects}
            marginTarget={shopConfig.marginTarget}
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
