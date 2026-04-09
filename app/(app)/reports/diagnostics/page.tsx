'use client'

import { useState, useEffect, useMemo } from 'react'
import Nav from '@/components/nav'
import PlanGate from '@/components/plan-gate'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { computeWaterfall, type ProjectOutcome, type WaterfallItem } from '@/lib/financial-engine'
import { ChevronDown, Activity, TrendingUp, TrendingDown, Lightbulb } from 'lucide-react'
import ReportTabs from '@/components/report-tabs'

// ── Types ──

interface OutcomeWithProject extends ProjectOutcome {
  projects: { name: string }
}

// ── Helpers ──

function fmtMoney(n: number): string {
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function fmtPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

// ── Main Page ──

export default function DiagnosticsPage() {
  const { org } = useAuth()
  const [outcomes, setOutcomes] = useState<OutcomeWithProject[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!org?.id) return
    loadData()
  }, [org?.id])

  async function loadData() {
    if (!org?.id) return
    setLoading(true)

    const { data } = await supabase
      .from('project_outcomes')
      .select('*, projects!inner(name)')
      .eq('org_id', org.id)
      .order('completed_at', { ascending: false })

    const items = (data || []) as OutcomeWithProject[]
    setOutcomes(items)
    if (items.length > 0 && !selectedId) {
      setSelectedId(items[0].id)
    }
    setLoading(false)
  }

  const selected = outcomes.find(o => o.id === selectedId) || null
  const waterfall = useMemo(() => selected ? computeWaterfall(selected) : [], [selected])

  // ── Department breakdown ──
  const departments = useMemo(() => {
    if (!selected) return []
    const estDept = selected.dept_hours_estimated || {}
    const actDept = selected.dept_hours_actual || {}
    const allDepts = Array.from(new Set([...Object.keys(estDept), ...Object.keys(actDept)]))
    return allDepts.map(dept => {
      const est = estDept[dept] || 0
      const act = actDept[dept] || 0
      const variance = act - est
      const variancePct = est > 0 ? (variance / est) * 100 : 0
      return { name: dept, estimated: est, actual: act, variance, variancePct }
    }).sort((a, b) => b.variance - a.variance)
  }, [selected])

  // ── Key takeaway generation ──
  const takeaway = useMemo(() => {
    if (!selected || waterfall.length < 2) return null

    const estimatedItem = waterfall[0]
    const actualItem = waterfall[waterfall.length - 1]
    const marginDelta = actualItem.value - estimatedItem.value
    const exceeded = marginDelta >= 0

    // Find primary driver (largest absolute variance, excluding start/end)
    const variances = waterfall.slice(1, -1)
    const sorted = [...variances].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    const primary = sorted[0]

    let driverText = ''
    if (primary) {
      if (primary.label === 'Hours Variance') {
        // Find worst department
        const worstDept = departments.length > 0
          ? departments.reduce((worst, d) => Math.abs(d.variance) > Math.abs(worst.variance) ? d : worst, departments[0])
          : null
        if (worstDept && worstDept.variance > 0) {
          driverText = `hours ran over in ${worstDept.name} by ${Math.abs(worstDept.variancePct).toFixed(0)}%`
        } else if (worstDept && worstDept.variance < 0) {
          driverText = `hours came in under estimate in ${worstDept.name} by ${Math.abs(worstDept.variancePct).toFixed(0)}%`
        } else {
          driverText = primary.detail
        }
      } else if (primary.label === 'Material Variance') {
        driverText = primary.value >= 0
          ? 'materials came in under budget'
          : 'materials exceeded budget'
      } else if (primary.label === 'Revenue Gained' || primary.label === 'Revenue Lost') {
        if (selected.change_order_revenue > 0) {
          driverText = `a change order brought in ${fmtMoney(selected.change_order_revenue)} in additional revenue`
        } else {
          driverText = primary.label === 'Revenue Gained' ? 'collected more than estimated' : 'collected less than estimated'
        }
      } else {
        driverText = primary.detail
      }
    }

    const headline = exceeded
      ? `This project beat its estimated margin by ${Math.abs(marginDelta).toFixed(1)}%.`
      : `This project came in ${Math.abs(marginDelta).toFixed(1)}% below its estimated margin.`

    const driver = driverText ? `Primary driver: ${driverText}.` : ''

    return { headline, driver, exceeded }
  }, [selected, waterfall, departments])

  // ── Waterfall chart helpers ──
  // We compute cumulative running totals so bars stack correctly
  const waterfallBars = useMemo(() => {
    if (waterfall.length === 0) return []

    // Find the range we need to display
    let runningTotal = 0
    const bars: { label: string; start: number; end: number; value: number; type: WaterfallItem['type']; detail: string }[] = []

    for (let i = 0; i < waterfall.length; i++) {
      const item = waterfall[i]
      if (item.type === 'neutral' || item.type === 'total') {
        // Absolute bar from 0 to value
        bars.push({ label: item.label, start: 0, end: item.value, value: item.value, type: item.type, detail: item.detail })
        runningTotal = item.value
      } else {
        // Delta bar
        const start = runningTotal
        const end = runningTotal + item.value
        bars.push({ label: item.label, start, end, value: item.value, type: item.type, detail: item.detail })
        runningTotal = end
      }
    }

    return bars
  }, [waterfall])

  // Compute chart range
  const chartMin = useMemo(() => {
    if (waterfallBars.length === 0) return 0
    return Math.min(0, ...waterfallBars.map(b => Math.min(b.start, b.end))) - 5
  }, [waterfallBars])

  const chartMax = useMemo(() => {
    if (waterfallBars.length === 0) return 100
    return Math.max(0, ...waterfallBars.map(b => Math.max(b.start, b.end))) + 5
  }, [waterfallBars])

  const chartRange = chartMax - chartMin

  function pctPosition(value: number): number {
    return ((value - chartMin) / chartRange) * 100
  }

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
      <PlanGate requires="diagnostics">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight mb-1">Reports</h1>
          <p className="text-sm text-[#6B7280] mb-4">Why or why not? Margin gap analysis for completed projects.</p>

          <ReportTabs />

          {outcomes.length === 0 ? (
            <div className="bg-white border border-[#E5E7EB] rounded-xl px-6 py-16 text-center">
              <div className="w-14 h-14 rounded-2xl bg-[#F3F4F6] flex items-center justify-center mx-auto mb-4">
                <Activity className="w-6 h-6 text-[#9CA3AF]" />
              </div>
              <p className="text-sm font-medium text-[#111] mb-1">No project outcomes to analyze</p>
              <p className="text-sm text-[#9CA3AF]">Mark a project as complete to generate diagnostic data.</p>
            </div>
          ) : (
            <>
              {/* ── 1. Project Selector ── */}
              <div className="mb-6">
                <label className="block text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">
                  Select Project
                </label>
                <div className="relative inline-block">
                  <select
                    value={selectedId || ''}
                    onChange={e => setSelectedId(e.target.value)}
                    className="appearance-none bg-white border border-[#E5E7EB] rounded-xl px-4 py-2.5 pr-10 text-sm font-medium text-[#111] focus:outline-none focus:ring-2 focus:ring-[#2563EB] focus:border-transparent cursor-pointer min-w-[300px]"
                  >
                    {outcomes.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.projects.name} ({o.actual_margin_pct.toFixed(1)}% margin)
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-[#9CA3AF] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {selected && (
                <>
                  {/* ── 2. Summary Bar ── */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
                    {/* Revenue */}
                    <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
                      <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">Revenue</div>
                      <div className="text-xs text-[#6B7280] mb-1">Estimated</div>
                      <div className="text-lg font-mono tabular-nums font-semibold text-[#111]">
                        {fmtMoney(selected.estimated_price)}
                      </div>
                      <div className="text-xs text-[#6B7280] mt-2 mb-1">Actual</div>
                      <div className="text-lg font-mono tabular-nums font-semibold text-[#111]">
                        {fmtMoney(selected.actual_revenue)}
                      </div>
                    </div>

                    {/* Hours */}
                    <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
                      <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">Hours</div>
                      <div className="text-xs text-[#6B7280] mb-1">Estimated</div>
                      <div className="text-lg font-mono tabular-nums font-semibold text-[#111]">
                        {selected.estimated_hours.toLocaleString()}h
                      </div>
                      <div className="text-xs text-[#6B7280] mt-2 mb-1">Actual</div>
                      <div className={`text-lg font-mono tabular-nums font-semibold ${selected.hours_variance > 0 ? 'text-[#DC2626]' : 'text-[#059669]'}`}>
                        {selected.actual_hours.toLocaleString()}h
                        <span className="text-xs font-normal ml-1">({fmtPct(selected.hours_variance_pct)})</span>
                      </div>
                    </div>

                    {/* Materials */}
                    <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
                      <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">Materials</div>
                      <div className="text-xs text-[#6B7280] mb-1">Estimated</div>
                      <div className="text-lg font-mono tabular-nums font-semibold text-[#111]">
                        {fmtMoney(selected.estimated_materials)}
                      </div>
                      <div className="text-xs text-[#6B7280] mt-2 mb-1">Actual</div>
                      <div className={`text-lg font-mono tabular-nums font-semibold ${selected.material_variance > 0 ? 'text-[#DC2626]' : 'text-[#059669]'}`}>
                        {fmtMoney(selected.actual_materials)}
                        <span className="text-xs font-normal ml-1">({fmtPct(selected.material_variance_pct)})</span>
                      </div>
                    </div>

                    {/* Margin */}
                    <div className="bg-white border border-[#E5E7EB] rounded-xl px-4 sm:px-5 py-4 sm:py-5">
                      <div className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider mb-2">Margin</div>
                      <div className="text-xs text-[#6B7280] mb-1">Estimated</div>
                      <div className="text-lg font-mono tabular-nums font-semibold text-[#111]">
                        {waterfall.length > 0 ? waterfall[0].detail : '—'}
                      </div>
                      <div className="text-xs text-[#6B7280] mt-2 mb-1">Actual</div>
                      <div className={`text-lg font-mono tabular-nums font-semibold ${selected.actual_margin_pct >= 0 ? 'text-[#059669]' : 'text-[#DC2626]'}`}>
                        {fmtMoney(selected.actual_margin)} ({selected.actual_margin_pct.toFixed(1)}%)
                      </div>
                    </div>
                  </div>

                  {/* ── 3. Waterfall Chart ── */}
                  <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
                    <div className="px-6 py-4 border-b border-[#E5E7EB]">
                      <h2 className="text-base font-semibold text-[#111]">Margin Gap Analysis</h2>
                      <p className="text-xs text-[#9CA3AF] mt-0.5">Waterfall showing what moved margin from estimate to actual</p>
                    </div>
                    <div className="px-6 py-6">
                      <div className="space-y-3">
                        {waterfallBars.map((bar, i) => {
                          const left = pctPosition(Math.min(bar.start, bar.end))
                          const right = pctPosition(Math.max(bar.start, bar.end))
                          const width = right - left

                          let bgColor = 'bg-[#6B7280]' // neutral
                          if (bar.type === 'positive') bgColor = 'bg-[#059669]'
                          if (bar.type === 'negative') bgColor = 'bg-[#DC2626]'
                          if (bar.type === 'total') bgColor = 'bg-[#2563EB]'

                          let textColor = 'text-[#6B7280]'
                          if (bar.type === 'positive') textColor = 'text-[#059669]'
                          if (bar.type === 'negative') textColor = 'text-[#DC2626]'
                          if (bar.type === 'total') textColor = 'text-[#2563EB]'

                          return (
                            <div key={i} className="flex items-center gap-4">
                              {/* Label */}
                              <div className="w-36 sm:w-44 flex-shrink-0 text-right">
                                <div className="text-sm font-medium text-[#111]">{bar.label}</div>
                                <div className="text-xs text-[#9CA3AF]">{bar.detail}</div>
                              </div>
                              {/* Bar */}
                              <div className="flex-1 relative h-10">
                                <div className="absolute inset-0 bg-[#F9FAFB] rounded-lg" />
                                {/* Zero line */}
                                <div
                                  className="absolute top-0 bottom-0 w-px bg-[#E5E7EB]"
                                  style={{ left: `${pctPosition(0)}%` }}
                                />
                                {/* Bar segment */}
                                <div
                                  className={`absolute top-1.5 bottom-1.5 rounded ${bgColor} transition-all`}
                                  style={{
                                    left: `${left}%`,
                                    width: `${Math.max(width, 0.5)}%`,
                                  }}
                                />
                                {/* Value label on bar */}
                                <div
                                  className={`absolute top-1/2 -translate-y-1/2 text-xs font-mono tabular-nums font-semibold ${textColor}`}
                                  style={{
                                    left: `${right + 1}%`,
                                  }}
                                >
                                  {bar.type === 'neutral' || bar.type === 'total'
                                    ? `${bar.value.toFixed(1)}%`
                                    : `${bar.value >= 0 ? '+' : ''}${bar.value.toFixed(1)}%`
                                  }
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {/* ── 4. Department Breakdown ── */}
                  {departments.length > 0 && (
                    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
                      <div className="px-6 py-4 border-b border-[#E5E7EB]">
                        <h2 className="text-base font-semibold text-[#111]">Department Breakdown</h2>
                        <p className="text-xs text-[#9CA3AF] mt-0.5">Hours estimated vs actual by department</p>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[#E5E7EB]">
                              <th className="text-left px-6 py-3 text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Department</th>
                              <th className="text-right px-6 py-3 text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Est. Hours</th>
                              <th className="text-right px-6 py-3 text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Actual Hours</th>
                              <th className="text-right px-6 py-3 text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Variance</th>
                              <th className="text-right px-6 py-3 text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Var %</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#F3F4F6]">
                            {departments.map(dept => {
                              const isOver = dept.variance > 0
                              const isUnder = dept.variance < 0
                              const color = isOver ? 'text-[#DC2626]' : isUnder ? 'text-[#059669]' : 'text-[#6B7280]'

                              return (
                                <tr key={dept.name} className="hover:bg-[#F9FAFB] transition-colors">
                                  <td className="px-6 py-3 font-medium text-[#111]">{dept.name}</td>
                                  <td className="px-6 py-3 text-right font-mono tabular-nums text-[#6B7280]">
                                    {dept.estimated.toFixed(1)}h
                                  </td>
                                  <td className="px-6 py-3 text-right font-mono tabular-nums text-[#111]">
                                    {dept.actual.toFixed(1)}h
                                  </td>
                                  <td className={`px-6 py-3 text-right font-mono tabular-nums font-medium ${color}`}>
                                    {dept.variance > 0 ? '+' : ''}{dept.variance.toFixed(1)}h
                                  </td>
                                  <td className={`px-6 py-3 text-right font-mono tabular-nums font-medium ${color}`}>
                                    {dept.estimated > 0 ? fmtPct(dept.variancePct) : '—'}
                                  </td>
                                </tr>
                              )
                            })}
                            {/* Totals row */}
                            <tr className="bg-[#F9FAFB] font-semibold">
                              <td className="px-6 py-3 text-[#111]">Total</td>
                              <td className="px-6 py-3 text-right font-mono tabular-nums text-[#6B7280]">
                                {selected.estimated_hours.toFixed(1)}h
                              </td>
                              <td className="px-6 py-3 text-right font-mono tabular-nums text-[#111]">
                                {selected.actual_hours.toFixed(1)}h
                              </td>
                              <td className={`px-6 py-3 text-right font-mono tabular-nums ${selected.hours_variance > 0 ? 'text-[#DC2626]' : selected.hours_variance < 0 ? 'text-[#059669]' : 'text-[#6B7280]'}`}>
                                {selected.hours_variance > 0 ? '+' : ''}{selected.hours_variance.toFixed(1)}h
                              </td>
                              <td className={`px-6 py-3 text-right font-mono tabular-nums ${selected.hours_variance_pct > 0 ? 'text-[#DC2626]' : selected.hours_variance_pct < 0 ? 'text-[#059669]' : 'text-[#6B7280]'}`}>
                                {fmtPct(selected.hours_variance_pct)}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── 5. Key Takeaway ── */}
                  {takeaway && (
                    <div className={`border rounded-xl px-6 py-5 ${takeaway.exceeded ? 'bg-[#ECFDF5] border-[#A7F3D0]' : 'bg-[#FEF2F2] border-[#FECACA]'}`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${takeaway.exceeded ? 'bg-[#D1FAE5]' : 'bg-[#FEE2E2]'}`}>
                          {takeaway.exceeded
                            ? <TrendingUp className="w-4 h-4 text-[#059669]" />
                            : <TrendingDown className="w-4 h-4 text-[#DC2626]" />
                          }
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Lightbulb className="w-3.5 h-3.5 text-[#D97706]" />
                            <span className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wider">Key Takeaway</span>
                          </div>
                          <p className={`text-sm font-semibold ${takeaway.exceeded ? 'text-[#065F46]' : 'text-[#991B1B]'}`}>
                            {takeaway.headline}
                          </p>
                          {takeaway.driver && (
                            <p className={`text-sm mt-1 ${takeaway.exceeded ? 'text-[#047857]' : 'text-[#B91C1C]'}`}>
                              {takeaway.driver}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </PlanGate>
    </>
  )
}
