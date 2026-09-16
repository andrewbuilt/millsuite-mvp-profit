'use client'

import Link from 'next/link'
import type { CompletedProject } from '@/lib/reports/gradeCalculations'
import { marginBarColor } from '@/lib/reports/gradeCalculations'
import {
  averageProfit,
  barGeometry,
  blendedMarginPct,
  computeBarScale,
} from '@/lib/reports/margin-bar-geometry'

function fmtMoney(n: number): string {
  if (n < 0) return `-$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// ⛔ ONE SOURCE OF TRUTH FOR THE COLUMN WIDTHS — the legend, every project row
// and the average row all read these, so the bar track (`flex-1`, i.e. whatever
// is left over) is IDENTICAL in all of them by construction rather than by
// three places happening to agree.
//
// EVERY ONE IS FIXED-WIDTH AND `flex-shrink-0`. That is the whole lesson of the
// bar-width bug: the hours column was `min-w-[80px]` with no `flex-shrink-0`,
// so it grew with its content and the `flex-1` track beside it absorbed the
// difference. One row's hours carried a decimal, its track came out ~24px
// narrower, and its bar started ~24px right of every other row's.
// ⚠️ The VALUE column had the same defect and still did at redesign time:
// `min-w-[70px]`, and `-$3,190` is one character wider than `$6,480`, so the
// demo set was already drawing on two different track widths.
// ⛔ DO NOT put `min-w-*` on a sibling of the track. Ever.
const COL_NAME = 'w-[140px] sm:w-[180px] flex-shrink-0'
const COL_HOURS = 'w-[104px] flex-shrink-0 hidden sm:block' // fits "9999.5h actual"
const COL_VALUE = 'w-[92px] flex-shrink-0' // fits "-$999,999"

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

  // ⛔ BAR LENGTH IS DOLLAR PROFIT, NOT MARGIN PERCENT — and it diverges from a
  // 0 line instead of always running left-to-right.
  //
  // The old chart drew `Math.abs(marginPct)`, which made a LOSS look exactly
  // like a PROFIT of the same size, separated only by colour: Meridian at −15%
  // rendered a 42.5%-wide bar, indistinguishable in length from +15%. On a
  // chart where length reads as "how did this job go", that is a misread, and
  // it arrives the first time any real shop loses money on a job.
  //
  // Percent was also never comparable across jobs: 30% of a $30k closet and
  // 30% of a $300k kitchen are the same bar and ten times the money.
  const scale = computeBarScale(projects.map(p => p.profit))
  const blended = blendedMarginPct(projects)
  const avgProfit = averageProfit(projects)
  const avgGeom = barGeometry(avgProfit, scale)
  const avgColor = marginBarColor(blended, marginTarget)

  // ⛔ THE TARGET TICK IS GONE, AND IT CANNOT COME BACK AS DRAWN.
  // It marked `marginTarget` on a percent axis. On a DOLLAR axis a percentage
  // has no single x: 25% of $21,300 is $5,325 and 25% of $102,500 is $25,625,
  // so one tick would have to sit at a different place on every row — the very
  // non-comparability this redesign exists to remove. Target performance is
  // still on screen, carried by COLOUR via `marginBarColor` (green at or above
  // target, amber within 5% below, red past that).
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
      <div className="text-sm font-medium text-[#111] mb-3">Completed projects</div>

      {/* Legend — same column skeleton as the rows, so it lines up with the
          track by construction.

          ⚠️ EACH LABEL IS CONFINED TO THE REGION IT DESCRIBES, and there is
          deliberately no "0" caption here. The first version pinned "Amount
          lost" to the far left with a "0" centred on the line, and the render
          showed why that can't work: the 0 line sits wherever the loss:gain
          ratio puts it — 14% on the real demo set — so "the left edge" and
          "the 0 line" are nearly the same place and the two labels ran
          together as "AMOUNT LOST 0". Pinning the label to the loss region
          instead makes it correct at any 0 position, and the line itself is
          now heavy enough to need no caption. MIN_SIDE in the geometry module
          is what guarantees the loss label has somewhere to live. */}
      <div className="flex items-center gap-3 pb-2 -mx-2 px-2">
        <div className={COL_NAME} />
        <div className={COL_HOURS} />
        <div className="flex-1 relative h-4">
          <div
            className="absolute top-0 left-0 text-[10px] font-medium uppercase tracking-wide text-[#DC2626] text-right truncate pr-1.5"
            style={{ width: `${scale.zeroPct}%` }}
          >
            Amount lost
          </div>
          <div
            className="absolute top-0 right-0 text-[10px] font-medium uppercase tracking-wide text-[#059669] truncate pl-1.5"
            style={{ left: `${scale.zeroPct}%` }}
          >
            Amount gained
          </div>
        </div>
        <div className={COL_VALUE} />
      </div>

      <div className="divide-y divide-[#E5E7EB]">
        {projects.map(project => {
          const geom = barGeometry(project.profit, scale)
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
              <div className={COL_NAME}>
                <div className="text-sm font-medium text-[#111] truncate">{project.name}</div>
                <div className="text-xs text-[#6B7280]">
                  Delivered {new Date(project.completionDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>

              {/* Hours */}
              <div className={`text-xs text-[#6B7280] text-right font-mono tabular-nums leading-relaxed ${COL_HOURS}`}>
                {project.estimatedHours}h est<br />
                {project.actualHours}h actual
              </div>

              {/* Profit bar */}
              <div className="flex-1 relative h-6">
                <div className="absolute inset-0 bg-[#F3F4F6] rounded" />
                {/* ⛔ `transition-colors`, NOT `transition-all`. This once
                    animated WIDTH over 500ms, so for half a second after any
                    re-render that changed the data a bar was a length that did
                    not match the number printed beside it. On a page people
                    screenshot and read financially, an in-between width IS a
                    wrong number. Colour can animate; length is data — and now
                    that length is dollars, an in-between length is an
                    in-between dollar figure. */}
                <div
                  className="absolute top-0 bottom-0 rounded-sm transition-colors duration-500"
                  style={{
                    left: `${geom.leftPct}%`,
                    width: `${geom.widthPct}%`,
                    background: barColor,
                  }}
                />
                {/* 0 line — drawn last so it sits on top of the bar it anchors. */}
                <div
                  className="absolute top-[-5px] bottom-[-5px] w-[2px] opacity-70"
                  style={{ left: `${scale.zeroPct}%`, background: "#111" }}
                />
              </div>

              {/* Margin value */}
              <div className={`text-right ${COL_VALUE}`}>
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

      {/* Average — the portfolio read, in the same visual language. */}
      <div className="flex items-center gap-3 py-2.5 -mx-2 px-2 mt-1 border-t-2 border-[#E5E7EB]">
        <div className={COL_NAME}>
          <div className="text-sm font-semibold text-[#111]">Average</div>
          <div className="text-xs text-[#6B7280]">
            {projects.length} job{projects.length === 1 ? '' : 's'} · blended
          </div>
        </div>
        <div className={COL_HOURS} />
        <div className="flex-1 relative h-6">
          <div className="absolute inset-0 bg-[#F3F4F6] rounded" />
          <div
            className="absolute top-0 bottom-0 rounded-sm transition-colors duration-500"
            style={{
              left: `${avgGeom.leftPct}%`,
              width: `${avgGeom.widthPct}%`,
              background: avgColor,
            }}
          />
          <div
            className="absolute top-[-5px] bottom-[-5px] w-[2px] opacity-70"
            style={{ left: `${scale.zeroPct}%`, background: '#111' }}
          />
        </div>
        <div className={`text-right ${COL_VALUE}`}>
          <div className="text-sm font-semibold font-mono tabular-nums" style={{ color: avgColor }}>
            {blended >= 0 ? '+' : ''}{blended.toFixed(1)}%
          </div>
          <div className="text-xs text-[#6B7280] font-mono tabular-nums">
            {fmtMoney(avgProfit)}
          </div>
        </div>
      </div>

      {/* ⚠️ The two numbers on the Average row answer different questions and
          the caption has to say so, or it reads as one number split in half.
          The PERCENT is blended (total profit ÷ total revenue — the shop's
          actual margin). The BAR and DOLLARS are profit per job, because the
          bar has to sit on the same dollar scale as the rows above it to be
          comparable to them. */}
      <p className="text-xs text-[#6B7280] mt-2 leading-relaxed">
        Average shows a visual of the blended rate — the percentage is total profit ÷ total
        revenue across these {projects.length} job{projects.length === 1 ? '' : 's'}; the bar and
        dollar figure are profit per job, on the same scale as the rows above.
      </p>
    </div>
  )
}
