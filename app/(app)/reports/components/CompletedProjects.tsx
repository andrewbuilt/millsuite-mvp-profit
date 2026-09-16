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

              {/* ⛔ FIXED WIDTH, AND THIS IS THE BUG. It was `min-w-[80px]`
                  with no `flex-shrink-0`, so the column GREW with its content
                  and the `flex-1` bar track next to it absorbed the
                  difference. "213.5h actual" is two characters longer than
                  "308h actual", so Sandpiper Lane — the only row whose hours
                  carry a DECIMAL — started its bar ~24px right of every other
                  row and ran on a shorter track. Its target tick sat right of
                  the others too.
                  ⚠️ That makes the bars NOT COMPARABLE, which is the entire
                  job of this chart: same percentage, different track, so the
                  lengths mean different things row to row. It reads as one
                  wrong bar, which is how it was reported.
                  Wide enough for "9999.5h actual" — the longest string this
                  can produce before the numbers themselves are the problem. */}
              {/* Hours */}
              <div className="text-xs text-[#6B7280] text-right w-[104px] flex-shrink-0 font-mono tabular-nums leading-relaxed hidden sm:block">
                {project.estimatedHours}h est<br />
                {project.actualHours}h actual
              </div>

              {/* Margin bar */}
              <div className="flex-1 relative h-6">
                <div className="absolute inset-0 bg-[#F3F4F6] rounded" />
                {/* ⛔ `transition-colors`, NOT `transition-all`. This animated
                    WIDTH over 500ms, so for half a second after any re-render
                    that changes the data a bar is a length that does not match
                    the number printed beside it. On a page people screenshot
                    and read financially, an in-between width IS a wrong
                    number — and it's the only mechanism left that can make a
                    bar disagree with its own percentage (the value path was
                    verified correct end to end: one outcome row per project,
                    numeric, and the same `marginPct` feeds both). Colour can
                    animate; length is data. */}
                <div
                  className="absolute top-0 bottom-0 rounded transition-colors duration-500"
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
