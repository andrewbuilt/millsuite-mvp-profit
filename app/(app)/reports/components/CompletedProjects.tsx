'use client'

import Link from 'next/link'
import type { CompletedProject } from '@/lib/reports/gradeCalculations'
import { marginBarColor } from '@/lib/reports/gradeCalculations'
import {
  averageProfit,
  barWidthPct,
  blendedMarginPct,
  chooseAxisMax,
  gradations,
} from '@/lib/reports/margin-bar-geometry'

// ⛔ LOSSES ARE STRIPED, NOT JUST RED — and this is load-bearing, not styling.
// With the bar anchored at the left edge, a loss and a gain of the same size
// draw the SAME LENGTH, so direction rests entirely on how the bar looks. Red
// vs green is the worst possible pair for colour-vision deficiency (~8% of
// men). Without the stripes, roughly one reader in twelve sees −$3,190 and
// +$3,190 as identical bars. The pattern is the accessible half of the signal.
const LOSS_FILL = (color: string) =>
  `repeating-linear-gradient(135deg, ${color} 0 6px, rgba(255,255,255,.42) 6px 11px)`

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
const COL_VALUE = 'w-[104px] flex-shrink-0' // fits "-$9,999,999" at text-sm

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

  // ⛔ LENGTH IS DOLLARS, ANCHORED AT THE LEFT EDGE, ON A LADDERED AXIS.
  // Andrew, 2026-09-16: "zero can to the far left. negative would just be red."
  //
  // ⚠️ THE TRADE THIS MAKES, KNOWINGLY: a loss and a gain of the same size are
  // the SAME LENGTH. −$3,190 draws like +$3,190. That is the misread the
  // redesign brief was written to kill, and it is accepted here because on a
  // dollar axis length answers "how much money moved" and direction is carried
  // by COLOUR **and PATTERN** (see LOSS_FILL — the pattern is what keeps it
  // readable for the ~8% of men with colour-vision deficiency).
  //
  // ⛔ THE DOLLARS ARE THE BIG NUMBER NOW AND THE PERCENT IS SECONDARY. The
  // previous build put the percentage next to a dollar-driven bar, which made
  // Gulfview's longest-in-the-set bar sit beside "+31.9%" while Vega's shorter
  // bar read "+35.3%". Whatever drives the bar has to be the number the eye
  // lands on first, or the row argues with itself.
  const axisMax = chooseAxisMax(projects.map(p => p.profit))
  const ticks = gradations(axisMax)
  const blended = blendedMarginPct(projects)
  const avgProfit = averageProfit(projects)
  const avgColor = marginBarColor(blended, marginTarget)

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
      <div className="text-sm font-medium text-[#111] mb-3">Completed projects</div>

      {/* ⛔ THE GRADATIONS ARE THE SCALE, SPOKEN OUT LOUD. The axis snaps to a
          ladder rung, so it can and will change when the data grows — a reader
          who can't see the current rung can't tell a $50k bar from a $500k one.
          Same column skeleton as the rows, so the ticks line up with the track
          they describe by construction rather than by two places agreeing. */}
      <div className="flex items-end gap-3 pb-1 -mx-2 px-2">
        <div className={COL_NAME} />
        <div className={COL_HOURS} />
        <div className="flex-1 relative h-4">
          {ticks.map((t, i) => (
            <div
              key={t.value}
              className={`absolute bottom-0 text-[10px] font-medium tabular-nums text-[#9CA3AF] ${
                i === 0 ? '' : i === ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'
              }`}
              style={{ left: `${t.pct}%` }}
            >
              {t.label}
            </div>
          ))}
        </div>
        <div className={COL_VALUE} />
      </div>

      <div className="divide-y divide-[#E5E7EB]">
        {projects.map(project => {
          const barColor = marginBarColor(project.marginPct, marginTarget)
          // ⛔ SIGN COMES FROM THE PROFIT, NOT THE PERCENTAGE. They agree today,
          // but a $0-revenue outcome can produce a 0% margin against a real
          // negative profit, and then the bar would be drawn solid while the
          // number beside it reads negative.
          const isLoss = project.profit < 0

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
                {/* Gradation lines UNDER the bar, so a bar can be read against
                    the scale without a ruler. Skipped at 0 and at the far end,
                    where the track edge already marks it. */}
                {ticks.slice(1, -1).map(t => (
                  <div
                    key={t.value}
                    className="absolute top-0 bottom-0 w-px bg-[#E5E7EB]"
                    style={{ left: `${t.pct}%` }}
                  />
                ))}
                {/* ⛔ `transition-colors`, NOT `transition-all`. This once
                    animated WIDTH over 500ms, so for half a second after any
                    re-render that changed the data a bar was a length that did
                    not match the number printed beside it. On a page people
                    screenshot and read financially, an in-between width IS a
                    wrong number. Colour can animate; length is data. */}
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-sm transition-colors duration-500"
                  style={{
                    width: `${barWidthPct(project.profit, axisMax)}%`,
                    background: isLoss ? LOSS_FILL(barColor) : barColor,
                  }}
                />
              </div>

              {/* ⛔ DOLLARS ON TOP. The bar is dollars, so the number the eye
                  lands on first has to be dollars — that is the whole fix for
                  "a longer bar next to a smaller percentage". */}
              <div className={`text-right ${COL_VALUE}`}>
                <div className="text-sm font-medium font-mono tabular-nums" style={{ color: barColor }}>
                  {fmtMoney(project.profit)}
                </div>
                <div className="text-xs text-[#6B7280] font-mono tabular-nums">
                  {project.marginPct >= 0 ? '+' : ''}{project.marginPct.toFixed(1)}%
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Average — same visual language as the rows above it. */}
      <div className="flex items-center gap-3 py-2.5 -mx-2 px-2 mt-1 border-t-2 border-[#E5E7EB]">
        <div className={COL_NAME}>
          <div className="text-sm font-semibold text-[#111]">Average</div>
          <div className="text-xs text-[#6B7280]">
            {projects.length} job{projects.length === 1 ? '' : 's'} · per job
          </div>
        </div>
        <div className={COL_HOURS} />
        <div className="flex-1 relative h-6">
          <div className="absolute inset-0 bg-[#F3F4F6] rounded" />
          {ticks.slice(1, -1).map(t => (
            <div
              key={t.value}
              className="absolute top-0 bottom-0 w-px bg-[#E5E7EB]"
              style={{ left: `${t.pct}%` }}
            />
          ))}
          <div
            className="absolute top-0 bottom-0 left-0 rounded-sm transition-colors duration-500"
            style={{
              width: `${barWidthPct(avgProfit, axisMax)}%`,
              background: avgProfit < 0 ? LOSS_FILL(avgColor) : avgColor,
            }}
          />
        </div>
        {/* ⚠️ The bar and the big number are BOTH average profit per job, so
            they agree exactly like every row above. The percentage underneath
            is the BLENDED margin (ΣProfit ÷ ΣRevenue) — a different question,
            which is why the caption names it rather than leaving a reader to
            assume it's the average of the percentages above it. It isn't:
            those two differ by 4.9 points on the demo set. */}
        <div className={`text-right ${COL_VALUE}`}>
          <div className="text-sm font-semibold font-mono tabular-nums" style={{ color: avgColor }}>
            {fmtMoney(avgProfit)}
          </div>
          <div className="text-xs text-[#6B7280] font-mono tabular-nums">
            {blended >= 0 ? '+' : ''}{blended.toFixed(1)}%
          </div>
        </div>
      </div>

      <p className="text-xs text-[#6B7280] mt-2 leading-relaxed">
        Bars show profit in dollars against the scale above &mdash; <span className="text-[#DC2626] font-medium">striped
        red</span> is money lost, so a bar&apos;s length is how much money moved and its fill is
        which way. Average is profit per job across these {projects.length} job
        {projects.length === 1 ? '' : 's'}; the percentage beneath it is the blended rate, total
        profit &divide; total revenue.
      </p>
    </div>
  )
}
