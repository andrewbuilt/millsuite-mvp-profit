'use client'

import { useEffect } from 'react'
import { computeWaterfall, type CompletedProject } from '@/lib/reports/gradeCalculations'

function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  return `${sign}$${abs.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function DiagnosticDrawer({
  project,
  onClose,
}: {
  project: CompletedProject | null
  onClose: () => void
}) {
  // Close on Escape
  useEffect(() => {
    if (!project) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [project, onClose])

  if (!project) return null

  const waterfall = computeWaterfall(project)

  // Compute cascade positions: each variance step floats at the running total
  let running = 0
  const rawSteps = waterfall.map(item => {
    if (item.type === 'start') {
      running = item.value
      return { ...item, from: 0, to: item.value }
    }
    if (item.type === 'total') {
      return { ...item, from: 0, to: item.value }
    }
    const from = running
    running += item.value
    return { ...item, from, to: running }
  })

  // Scale the chart so the larger of start/total margin fills ~70% of the track,
  // leaving headroom for deductions that might dip below and bars above the total
  const startVal = rawSteps.find(s => s.type === 'start')?.value || 0
  const totalVal = rawSteps.find(s => s.type === 'total')?.value || 0
  const maxMargin = Math.max(Math.abs(startVal), Math.abs(totalVal), 10)
  const allValues = rawSteps.flatMap(s => [s.from, s.to])
  const chartMin = Math.min(0, ...allValues)
  const chartMax = Math.max(maxMargin * 1.1, ...allValues)
  const chartRange = chartMax - chartMin

  // Helper to convert a percentage value to a position on the track (0-100%)
  const toPos = (v: number) => ((v - chartMin) / chartRange) * 100

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[560px] bg-white z-50 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E7EB] px-6 py-4 flex items-start justify-between">
          <div>
            <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-0.5">Diagnostic</div>
            <h2 className="text-lg font-semibold text-[#111]">{project.name}</h2>
            <p className="text-xs text-[#6B7280] mt-0.5">
              Delivered {new Date(project.completionDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        {/* Summary stats */}
        <div className="px-6 py-5 grid grid-cols-2 gap-3 border-b border-[#E5E7EB]">
          <div className="bg-[#F9FAFB] rounded-xl px-4 py-3">
            <div className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wide mb-1">Final margin</div>
            <div
              className="text-xl font-medium font-mono tabular-nums"
              style={{ color: project.marginPct >= 25 ? '#059669' : project.marginPct >= 15 ? '#D97706' : '#DC2626' }}
            >
              {project.marginPct >= 0 ? '+' : ''}{project.marginPct.toFixed(1)}%
            </div>
            <div className="text-[11px] text-[#6B7280] mt-0.5 font-mono tabular-nums">{fmtMoney(project.profit)}</div>
          </div>
          <div className="bg-[#F9FAFB] rounded-xl px-4 py-3">
            <div className="text-[10px] font-medium text-[#6B7280] uppercase tracking-wide mb-1">Hours</div>
            <div className="text-xl font-medium font-mono tabular-nums text-[#111]">
              {project.actualHours}h
              <span className="text-xs text-[#6B7280] font-normal ml-1">/ {project.estimatedHours}h est</span>
            </div>
            <div
              className="text-[11px] mt-0.5 font-mono tabular-nums"
              style={{ color: project.actualHours > project.estimatedHours * 1.05 ? '#DC2626' : project.actualHours < project.estimatedHours * 0.95 ? '#059669' : '#6B7280' }}
            >
              {project.actualHours > project.estimatedHours ? '+' : ''}{(project.actualHours - project.estimatedHours)}h ({((project.actualHours - project.estimatedHours) / project.estimatedHours * 100).toFixed(1)}%)
            </div>
          </div>
        </div>

        {/* Waterfall */}
        <div className="px-6 py-5">
          <div className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-4">
            Margin waterfall — what happened
          </div>

          <div className="space-y-3">
            {rawSteps.map((step, i) => {
              const isStart = step.type === 'start'
              const isTotal = step.type === 'total'
              const isPos = step.type === 'positive'

              const color = isStart ? '#9CA3AF'
                : isTotal ? (step.value >= 25 ? '#059669' : step.value >= 15 ? '#D97706' : '#DC2626')
                : isPos ? '#059669'
                : '#DC2626'

              // For start/total: solid bar from 0 to value
              // For variance: floating bar from `from` to `to`
              const low = Math.min(step.from, step.to)
              const high = Math.max(step.from, step.to)
              const leftPct = toPos(low)
              const widthPct = Math.max(toPos(high) - toPos(low), 0.8)
              const zeroPct = toPos(0)

              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-sm font-medium text-[#111]">{step.label}</span>
                    <span
                      className="text-sm font-mono tabular-nums font-medium"
                      style={{ color }}
                    >
                      {step.value >= 0 ? '+' : ''}{step.value.toFixed(1)}%
                    </span>
                  </div>

                  {/* Bar track */}
                  <div className="relative h-7 bg-[#F9FAFB] rounded">
                    {/* Zero baseline */}
                    <div
                      className="absolute top-0 bottom-0 w-px bg-[#E5E7EB]"
                      style={{ left: `${zeroPct}%` }}
                    />
                    {/* Step bar */}
                    <div
                      className="absolute top-1 bottom-1 rounded transition-all"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: color,
                      }}
                    />
                    {/* Connector line from end of this bar to start of next */}
                    {i < rawSteps.length - 1 && !isTotal && (
                      <div
                        className="absolute -bottom-3 w-px bg-[#D1D5DB]"
                        style={{
                          left: `${toPos(step.to)}%`,
                          height: '12px',
                        }}
                      />
                    )}
                  </div>

                  <div className="text-xs text-[#6B7280] mt-1">{step.detail}</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Hit/miss callout */}
        <div className="px-6 pb-6">
          <div
            className="rounded-xl p-4 border"
            style={{
              background: Math.abs(project.actualHours - project.estimatedHours) / project.estimatedHours <= 0.05 ? '#EAF3DE' : '#FAECE7',
              borderColor: Math.abs(project.actualHours - project.estimatedHours) / project.estimatedHours <= 0.05 ? '#97C459' : '#F09595',
            }}
          >
            <div
              className="text-xs font-medium uppercase tracking-wide mb-1"
              style={{ color: Math.abs(project.actualHours - project.estimatedHours) / project.estimatedHours <= 0.05 ? '#3B6D11' : '#A32D2D' }}
            >
              {Math.abs(project.actualHours - project.estimatedHours) / project.estimatedHours <= 0.05 ? 'Estimate hit' : 'Estimate miss'}
            </div>
            <p
              className="text-sm"
              style={{ color: Math.abs(project.actualHours - project.estimatedHours) / project.estimatedHours <= 0.05 ? '#3B6D11' : '#A32D2D' }}
            >
              {Math.abs(project.actualHours - project.estimatedHours) / project.estimatedHours <= 0.05
                ? `Within 5% of estimated hours. Execution matched the plan.`
                : `${Math.abs((project.actualHours - project.estimatedHours) / project.estimatedHours * 100).toFixed(0)}% ${project.actualHours > project.estimatedHours ? 'over' : 'under'} estimated hours. ${project.actualHours > project.estimatedHours ? 'Either the estimate was low or execution ran long — or both.' : 'Either the estimate was padded or the crew moved fast.'}`}
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
