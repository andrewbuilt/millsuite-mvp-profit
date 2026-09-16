// ============================================================================
// preview-completed-chart.mjs — render the Completed Projects chart to a
// standalone HTML file so it can be LOOKED AT without logging in.
// ============================================================================
// Run: npx tsx scripts/preview-completed-chart.mjs   → /tmp/completed-chart.html
//
// To actually LOOK at it (a browser tool won't open file:// here):
//   cp /tmp/completed-chart.html public/__chart-preview.html
//   npm run dev     → http://localhost:3000/__chart-preview.html
//   rm public/__chart-preview.html      ⛔ don't commit it — it would ship.
//
// ⛔ WHY. This component has now produced TWO defects that were invisible to
// both tsc and to querying the data, and visible in one glance at the render:
// an elastic column shifted every bar, and a loss drew the same length as a
// profit. Reasoning about flex widths in my head is exactly what missed the
// first one. So: real classes, real numbers, real browser.
//
// ⚠️ This mirrors the component's markup by hand. If they drift, this lies.
// It exists for eyeballing a layout change, NOT as a substitute for the app.
// The math comes from the real module, so at least the numbers can't drift.
// ============================================================================

import fs from 'fs'
import {
  ZERO_X,
  averageProfit,
  barGeometry,
  blendedMarginPct,
  targetX,
} from '../lib/reports/margin-bar-geometry.ts'

const PROJECTS = [
  { name: 'Meridian Storefront Build-out', date: 'Sep 2', est: 96, act: 121, profit: -3190, revenue: 21300, marginPct: -15.0 },
  { name: 'Vega Residence — Painted Shaker Kitchen', date: 'Sep 1', est: 308, act: 308, profit: 25420, revenue: 72000, marginPct: 35.3 },
  { name: 'Sandpiper Lane Library Wall', date: 'Aug 28', est: 211, act: 213.5, profit: 16953, revenue: 48500, marginPct: 35.0 },
  { name: 'Gulfview Kitchen — Rift Oak', date: 'Aug 21', est: 430, act: 452, profit: 32730, revenue: 102500, marginPct: 31.9 },
  { name: 'Palm & Pine Salon — Reception Desk', date: 'Aug 14', est: 152, act: 158, profit: 10325, revenue: 36500, marginPct: 28.3 },
  { name: 'Cypress Social — Bar & Banquette', date: 'Aug 7', est: 245, act: 251, profit: 17780, revenue: 58500, marginPct: 30.4 },
  { name: 'Bayshore Closet System', date: 'Jul 31', est: 134, act: 147, profit: 6480, revenue: 31500, marginPct: 20.6 },
]
const TARGET = 25

const barColor = (pct) => (pct >= TARGET ? '#059669' : pct >= TARGET - 5 ? '#D97706' : '#DC2626')
const money = (n) =>
  n < 0 ? `-$${Math.abs(n).toLocaleString()}` : `$${n.toLocaleString()}`

const blended = blendedMarginPct(PROJECTS)
const avgProfit = averageProfit(PROJECTS)
const avgGeom = barGeometry(blended)
const avgColor = barColor(blended)
const targetPos = targetX(TARGET)

const COL_NAME = 'w-[140px] sm:w-[180px] flex-shrink-0'
const COL_HOURS = 'w-[104px] flex-shrink-0 hidden sm:block'
const COL_VALUE = 'w-[92px] flex-shrink-0'

const row = (p) => {
  const g = barGeometry(p.marginPct)
  const c = barColor(p.marginPct)
  return `
  <div class="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg">
    <div class="${COL_NAME}">
      <div class="text-sm font-medium text-[#111] truncate">${p.name}</div>
      <div class="text-xs text-[#6B7280]">Delivered ${p.date}</div>
    </div>
    <div class="text-xs text-[#6B7280] text-right font-mono tabular-nums leading-relaxed ${COL_HOURS}">
      ${p.est}h est<br />${p.act}h actual
    </div>
    <div class="flex-1 relative h-6">
      <div class="absolute inset-0 bg-[#F3F4F6] rounded"></div>
      <div class="absolute top-0 bottom-0 rounded-sm" style="left:${g.leftPct}%;width:${g.widthPct}%;background:${c}"></div>
      <div class="absolute top-[-3px] bottom-[-3px] w-[1.5px] opacity-30" style="left:${targetPos}%;background:#111"></div>
      <div class="absolute top-[-5px] bottom-[-5px] w-[2px] opacity-70" style="left:${ZERO_X}%;background:#111"></div>
    </div>
    <div class="text-right ${COL_VALUE}">
      <div class="text-sm font-medium font-mono tabular-nums" style="color:${c}">${p.marginPct >= 0 ? '+' : ''}${p.marginPct.toFixed(1)}%</div>
      <div class="text-xs text-[#6B7280] font-mono tabular-nums">${money(p.profit)}</div>
    </div>
  </div>`
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><script src="https://cdn.tailwindcss.com"></script>
<style>body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}</style></head>
<body class="bg-[#F9FAFB] p-8">
<div class="max-w-[1100px] mx-auto space-y-8">

  <div class="bg-white border border-[#E5E7EB] rounded-xl p-6">
    <div class="text-sm font-medium text-[#111] mb-3">Completed projects</div>

    <div class="flex items-center gap-3 pb-2 -mx-2 px-2">
      <div class="${COL_NAME}"></div>
      <div class="${COL_HOURS}"></div>
      <div class="flex-1 relative h-4">
        <div class="absolute top-0 left-0 text-[10px] font-medium uppercase tracking-wide text-[#DC2626]">&minus;100% lost</div>
        <div class="absolute top-0 text-[10px] font-medium uppercase tracking-wide text-[#6B7280] -translate-x-1/2" style="left:${ZERO_X}%">0</div>
        <div class="absolute top-0 text-[10px] font-medium uppercase tracking-wide text-[#111] -translate-x-1/2 whitespace-nowrap" style="left:${targetPos}%">${TARGET}% target</div>
        <div class="absolute top-0 right-0 text-[10px] font-medium uppercase tracking-wide text-[#059669]">+100% gained</div>
      </div>
      <div class="${COL_VALUE}"></div>
    </div>

    <div class="divide-y divide-[#E5E7EB]">${PROJECTS.map(row).join('')}</div>

    <div class="flex items-center gap-3 py-2.5 -mx-2 px-2 mt-1 border-t-2 border-[#E5E7EB]">
      <div class="${COL_NAME}">
        <div class="text-sm font-semibold text-[#111]">Average</div>
        <div class="text-xs text-[#6B7280]">${PROJECTS.length} jobs · blended</div>
      </div>
      <div class="${COL_HOURS}"></div>
      <div class="flex-1 relative h-6">
        <div class="absolute inset-0 bg-[#F3F4F6] rounded"></div>
        <div class="absolute top-0 bottom-0 rounded-sm" style="left:${avgGeom.leftPct}%;width:${avgGeom.widthPct}%;background:${avgColor}"></div>
        <div class="absolute top-[-3px] bottom-[-3px] w-[1.5px] opacity-30" style="left:${targetPos}%;background:#111"></div>
        <div class="absolute top-[-5px] bottom-[-5px] w-[2px] opacity-70" style="left:${ZERO_X}%;background:#111"></div>
      </div>
      <div class="text-right ${COL_VALUE}">
        <div class="text-sm font-semibold font-mono tabular-nums" style="color:${avgColor}">+${blended.toFixed(1)}%</div>
        <div class="text-xs text-[#6B7280] font-mono tabular-nums">${money(Math.round(avgProfit))}</div>
      </div>
    </div>

    <p class="text-xs text-[#6B7280] mt-2 leading-relaxed">
      Bars show each job's margin on a fixed scale — 0 in the centre, 100% at either end, so
      lengths mean the same thing on every row and in every period. Average shows a visual of the
      blended rate: total profit ÷ total revenue across these ${PROJECTS.length} jobs, with profit
      per job in dollars beneath it.
    </p>
  </div>

</div></body></html>`

fs.writeFileSync('/tmp/completed-chart.html', html)
console.log(`\n  wrote /tmp/completed-chart.html`)
console.log(`  0 at ${ZERO_X}%  ·  ${TARGET}% target tick at ${targetPos}%  ·  blended ${blended.toFixed(1)}%  ·  avg/job ${money(Math.round(avgProfit))}\n`)
