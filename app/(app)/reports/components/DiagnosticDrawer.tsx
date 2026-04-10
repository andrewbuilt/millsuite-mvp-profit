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

  // Scale bars so the largest absolute value (usually est or actual margin) fills the track
  const maxAbs = Math.max(...waterfall.map(w => Math.abs(w.value)), 10)
  const marginTarget = 25

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
            {waterfall.map((step, i) => {
              const isStart = step.type === 'start'
              const isTotal = step.type === 'total'

              // Color rules:
              // - Start (est margin): green
              // - Total (actual margin): green if at/above target, amber if within 5 below, red if worse
              // - Variance: green if positive, red if negative
              const color = isStart
                ? '#059669'
                : isTotal
                  ? (step.value >= marginTarget ? '#059669' : step.value >= marginTarget - 5 ? '#D97706' : '#DC2626')
                  : (step.value >= 0 ? '#059669' : '#DC2626')

              // All bars anchored left; length proportional to |value|
              const widthPct = Math.max((Math.abs(step.value) / maxAbs) * 100, 1)
              const targetLeftPct = (marginTarget / maxAbs) * 100

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
                  <div className="relative h-6 bg-[#F3F4F6] rounded">
                    {/* Bar from left */}
                    <div
                      className="absolute top-0 bottom-0 left-0 rounded transition-all"
                      style={{
                        width: `${Math.min(widthPct, 100)}%`,
                        background: color,
                      }}
                    />
                    {/* Target line at 25% (only on start/total bars) */}
                    {(isStart || isTotal) && targetLeftPct <= 100 && (
                      <div
                        className="absolute top-[-4px] bottom-[-4px] w-[1.5px] opacity-40"
                        style={{ left: `${targetLeftPct}%`, background: '#111' }}
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
