'use client'

import Link from 'next/link'
import type { CompletedProject } from '@/lib/reports/gradeCalculations'
import { marginBarColor } from '@/lib/reports/gradeCalculations'
import {
  ZERO_X,
  averageProfit,
  barGeometry,
  blendedMarginPct,
  targetX,
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

  // ⛔ THE BAR IS THE PERCENTAGE PRINTED NEXT TO IT, ON A FIXED −100…0…+100
  // AXIS WITH 0 DEAD CENTRE. Nothing here is scaled to the other rows.
  //
  // The two earlier versions each failed a different way, and both only showed
  // up on a rendered page:
  //   · `Math.abs(marginPct)` drew a LOSS exactly like a PROFIT — −15% and
  //     +15% were the same length, separated only by colour.
  //   · dollar profit scaled to the set's max fixed that, but then THE BAR
  //     DISAGREED WITH ITS OWN NUMBER: Gulfview drew the longest bar in the
  //     set at +31.9% while Vega drew shorter at +35.3%, because Gulfview is
  //     a bigger job. A longer bar against a smaller percentage is unreadable.
  //
  // Dollars haven't been lost — they're printed under every percentage, and
  // on the Average row. They just don't drive length any more, because length
  // has to mean the same thing as the number beside it.
  const blended = blendedMarginPct(projects)
  const avgProfit = averageProfit(projects)
  const avgGeom = barGeometry(blended)
  const avgColor = marginBarColor(blended, marginTarget)

  // ⛔ THE TARGET TICK IS BACK, AND IT IS ONE x FOR EVERY ROW. It had to be
  // deleted while the bar was in dollars — a percentage has no single x on a
  // dollar axis, so "target" would have sat in a different place on every row.
  // On a percentage axis it's a single vertical line down the whole chart:
  // every row reads instantly as left of target or right of it.
  const targetPos = targetX(marginTarget)
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
      <div className="text-sm font-medium text-[#111] mb-3">Completed projects</div>

      {/* Legend — same column skeleton as the rows, so it lines up with the
          track by construction. The axis ends are labelled with the actual
          numbers now that they mean something fixed: the track runs −100% to
          +100% no matter what the data does, so those captions stay true. */}
      <div className="flex items-center gap-3 pb-1.5 -mx-2 px-2">
        <div className={COL_NAME} />
        <div className={COL_HOURS} />
        <div className="flex-1 relative h-4">
          <div className="absolute top-0 left-0 text-[10px] font-medium uppercase tracking-wide text-[#DC2626]">
            −100% lost
          </div>
          <div
            className="absolute top-0 text-[10px] font-medium uppercase tracking-wide text-[#6B7280] -translate-x-1/2"
            style={{ left: `${ZERO_X}%` }}
          >
            0
          </div>
          {/* The target caption rides the tick, so it can't drift from it. */}
          <div
            className="absolute top-0 text-[10px] font-medium uppercase tracking-wide text-[#111] -translate-x-1/2 whitespace-nowrap"
            style={{ left: `${targetPos}%` }}
          >
            {marginTarget}% target
          </div>
          <div className="absolute top-0 right-0 text-[10px] font-medium uppercase tracking-wide text-[#059669]">
            +100% gained
          </div>
        </div>
        <div className={COL_VALUE} />
      </div>

      <div className="divide-y divide-[#E5E7EB]">
        {projects.map(project => {
          // ⛔ THE SAME `project.marginPct` DRIVES THE BAR AND THE TEXT. Same
          // object, same render pass, same number — so they cannot disagree.
          const geom = barGeometry(project.marginPct)
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
                    wrong number. Colour can animate; length is data. */}
                <div
                  className="absolute top-0 bottom-0 rounded-sm transition-colors duration-500"
                  style={{
                    left: `${geom.leftPct}%`,
                    width: `${geom.widthPct}%`,
                    background: barColor,
                  }}
                />
                {/* Target tick — one x for every row, because the axis is
                    percent. Drawn under the 0 line but over the bar. */}
                <div
                  className="absolute top-[-3px] bottom-[-3px] w-[1.5px] opacity-30"
                  style={{ left: `${targetPos}%`, background: '#111' }}
                />
                {/* 0 line — drawn last so it sits on top of the bar it anchors. */}
                <div
                  className="absolute top-[-5px] bottom-[-5px] w-[2px] opacity-70"
                  style={{ left: `${ZERO_X}%`, background: '#111' }}
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
            className="absolute top-[-3px] bottom-[-3px] w-[1.5px] opacity-30"
            style={{ left: `${targetPos}%`, background: '#111' }}
          />
          <div
            className="absolute top-[-5px] bottom-[-5px] w-[2px] opacity-70"
            style={{ left: `${ZERO_X}%`, background: '#111' }}
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

      {/* ⚠️ The Average row's BAR AND PERCENT ARE THE SAME NUMBER (blended),
          exactly like every row above it. Only the dollar figure answers a
          different question — profit per job — so the caption names it. */}
      <p className="text-xs text-[#6B7280] mt-2 leading-relaxed">
        Bars show each job&apos;s margin on a fixed scale — 0 in the centre, 100% at either end,
        so lengths mean the same thing on every row and in every period. Average shows a visual of
        the blended rate: total profit ÷ total revenue across these {projects.length} job
        {projects.length === 1 ? '' : 's'}, with profit per job in dollars beneath it.
      </p>
    </div>
  )
}
