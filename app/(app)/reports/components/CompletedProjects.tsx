'use client'

import Link from 'next/link'
import type { CompletedProject } from '@/lib/reports/gradeCalculations'
import { marginBarColor } from '@/lib/reports/gradeCalculations'

function fmtMoney(n: number): string {
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function CompletedProjects({
  projects,
  marginTarget = 25,
  onProjectClick,
}: {
  projects: CompletedProject[]
  marginTarget?: number
  onProjectClick?: (project: CompletedProject) => void
}) {
  if (projects.length === 0) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 text-center">
        <div className="text-sm font-medium text-[#111] mb-1">
          No completed projects yet
        </div>
        <p className="text-xs text-[#6B7280] mb-3 leading-relaxed">
          Mark a project complete to see it here.
        </p>
        <Link
          href="/projects"
          className="text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8]"
        >
          Open projects →
        </Link>
      </div>
    )
  }

  const maxMargin = Math.max(...projects.map(p => Math.abs(p.marginPct)), 35)
  const targetPosition = (marginTarget / maxMargin) * 100

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
      <div className="text-sm font-medium text-[#111] mb-3">Completed projects</div>
      <div className="divide-y divide-[#E5E7EB]">
        {projects.map(project => {
          const barWidth = Math.max((Math.abs(project.marginPct) / maxMargin) * 100, 2)
          const barColor = marginBarColor(project.marginPct, marginTarget)

          // Click affordance only when onProjectClick is wired up. The
          // diagnostics drawer is gated to Pro+ in /reports/page.tsx —
          // Profit/Pro users see the same table but rows aren't clickable
          // (no cursor pointer, no hover state) so we don't tease a feature
          // that won't fire.
          const clickable = !!onProjectClick
          return (
            <div
              key={project.id}
              onClick={clickable ? () => onProjectClick(project) : undefined}
              className={`flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg transition-colors ${
                clickable ? 'cursor-pointer hover:bg-[#F9FAFB]' : ''
              }`}
            >
              {/* Name + date */}
              <div className="w-[140px] sm:w-[180px] flex-shrink-0">
                <div className="text-sm font-medium text-[#111] truncate">{project.name}</div>
                <div className="text-xs text-[#6B7280]">
                  Delivered {new Date(project.completionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>

              {/* Hours */}
              <div className="text-xs text-[#6B7280] text-right min-w-[80px] font-mono tabular-nums leading-relaxed hidden sm:block">
                {project.estimatedHours}h est<br />
                {project.actualHours}h actual
              </div>

              {/* Margin bar */}
              <div className="flex-1 relative h-6">
                <div className="absolute inset-0 bg-[#F3F4F6] rounded" />
                <div
                  className="absolute top-0 bottom-0 rounded transition-all duration-500"
                  style={{ width: `${Math.min(barWidth, 100)}%`, background: barColor }}
                />
                {/* Target line */}
                <div
                  className="absolute top-[-4px] bottom-[-4px] w-[1.5px] opacity-40"
                  style={{ left: `${Math.min(targetPosition, 100)}%`, background: '#111' }}
                />
              </div>

              {/* Margin value */}
              <div className="text-right min-w-[70px] flex-shrink-0">
                <div className="text-sm font-medium font-mono tabular-nums" style={{ color: barColor }}>
                  {project.marginPct >= 0 ? '+' : ''}{project.marginPct.toFixed(1)}%
                </div>
                <div className="text-xs text-[#6B7280] font-mono tabular-nums">
                  {fmtMoney(project.profit)}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
