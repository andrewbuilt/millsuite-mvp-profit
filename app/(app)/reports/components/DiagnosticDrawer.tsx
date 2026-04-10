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
  const maxAbs = Math.max(...waterfall.map(w => Math.abs(w.value)), 35)

  // Compute running position for each step
  let running = 0
  const steps = waterfall.map(item => {
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
            {steps.map((step, i) => {
              const isNeg = step.type === 'negative'
              const isPos = step.type === 'positive'
              const isStart = step.type === 'start'
              const isTotal = step.type === 'total'

              const color = isStart ? '#6B7280'
                : isTotal ? (step.value >= 25 ? '#059669' : step.value >= 15 ? '#D97706' : '#DC2626')
                : isPos ? '#059669'
                : '#DC2626'

              // Bar position calculation
              const barLeft = Math.min(step.from, step.to) / maxAbs * 50 + 50
              const barWidth = Math.abs(step.to - step.from) / maxAbs * 50
              const actualLeft = isStart || isTotal ? 50 : Math.max(0, barLeft)
              const actualWidth = isStart || isTotal
                ? Math.abs(step.value) / maxAbs * 50
                : Math.max(barWidth, 1)
              const leftOffset = isStart || isTotal
                ? (step.value >= 0 ? 50 : 50 - actualWidth)
                : actualLeft

              return (
                <div key={i}>
                  <div className="flex items-baseline justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-[#111]">{step.label}</span>
                      {!isStart && !isTotal && (
                        <span
                          className="text-xs font-mono tabular-nums"
                          style={{ color }}
                        >
                          {step.value >= 0 ? '+' : ''}{step.value.toFixed(1)}pp
                        </span>
                      )}
                    </div>
                    <span
                      className="text-sm font-mono tabular-nums font-medium"
                      style={{ color }}
                    >
                      {isTotal || isStart ? `${step.value >= 0 ? '+' : ''}${step.value.toFixed(1)}%` : fmtMoney(step.dollarValue)}
                    </span>
                  </div>

                  {/* Bar */}
                  <div className="relative h-6 bg-[#F3F4F6] rounded">
                    {/* Zero line */}
                    <div className="absolute top-0 bottom-0 w-px bg-[#D1D5DB]" style={{ left: '50%' }} />
                    {/* Step bar */}
                    <div
                      className="absolute top-0 bottom-0 rounded transition-all"
                      style={{
                        left: `${leftOffset}%`,
                        width: `${actualWidth}%`,
                        background: color,
                        opacity: isStart ? 0.5 : 1,
                      }}
                    />
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
