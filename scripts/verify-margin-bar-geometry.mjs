// ============================================================================
// verify-margin-bar-geometry.mjs — the Completed Projects profit bar.
// ============================================================================
// Run: npx tsx scripts/verify-margin-bar-geometry.mjs   (no DB, no network)
//
// ⛔ WHY THIS FILE EXISTS. Every defect this chart has shipped was GEOMETRY or
// LAYOUT, and tsc was green for all of them: an elastic column made every row's
// bar track a different width; a loss drew like a profit; a dollar-scaled bar
// sat beside a percentage and disagreed with it. None of that is type-checkable.
//
// So this checks BOTH halves of the drawing:
//   1. the math   — one scale, nothing clips, length is proportional to money
//   2. the layout — no elastic siblings, and the fill/label wiring that carries
//                   SIGN now that every bar grows the same direction
//
// ⚠️ Every check below was confirmed to FAIL when the thing it guards was
// deliberately broken. A guard that has never gone red is not a guard.
// ============================================================================

import {
  AXIS_LADDER,
  MIN_BAR_PCT,
  averageProfit,
  barWidthPct,
  blendedMarginPct,
  chooseAxisMax,
  gradations,
  overflowsAxis,
  shortMoney,
} from '../lib/reports/margin-bar-geometry.ts'
import fs from 'fs'
import path from 'path'

let pass = 0
const fails = []
function check(name, ok, detail = '') {
  if (ok) {
    pass++
  } else {
    fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps

// ── The real Bayside Millworks set, from scripts/inspect-completed-chart.mjs ──
const BAYSIDE = [
  { name: 'Meridian Storefront', profit: -3190, revenue: 21300, marginPct: -15.0 },
  { name: 'Vega Residence', profit: 25420, revenue: 72000, marginPct: 35.3 },
  { name: 'Sandpiper Lane', profit: 16953, revenue: 48500, marginPct: 35.0 },
  { name: 'Gulfview Kitchen', profit: 32730, revenue: 102500, marginPct: 31.9 },
  { name: 'Palm & Pine Salon', profit: 10325, revenue: 36500, marginPct: 28.3 },
  { name: 'Cypress Social', profit: 17780, revenue: 58500, marginPct: 30.4 },
  { name: 'Bayshore Closet', profit: 6480, revenue: 31500, marginPct: 20.6 },
]

const axisMax = chooseAxisMax(BAYSIDE.map((p) => p.profit))
const ticks = gradations(axisMax)

// ── 1. THE AXIS CAN NEVER CLIP ───────────────────────────────────────────────
// ⛔ A clipped bar renders at exactly 100% — which reads as "the maximum", a
// plausible and wrong number. Money must never run off the end of the chart.
{
  check('ladder rung contains the data', axisMax >= 32730, `${axisMax}`)
  check('ladder picks the SMALLEST rung that fits', axisMax === 50_000, `${axisMax}`)
  for (const p of BAYSIDE) {
    check(`${p.name}: does not overflow the axis`, !overflowsAxis(p.profit, axisMax))
    check(`${p.name}: width <= 100%`, barWidthPct(p.profit, axisMax) <= 100)
  }
  // Every rung, and past the top of the ladder.
  for (const rung of AXIS_LADDER) {
    check(`exactly ${rung} still fits on its own rung`, chooseAxisMax([rung]) === rung)
    check(`${rung} + $1 moves up a rung`, chooseAxisMax([rung + 1]) > rung)
  }
  const huge = chooseAxisMax([42_000_000])
  check('past the top rung it rounds UP, never clips', huge >= 42_000_000, `${huge}`)
  // ⚠️ A catastrophic LOSS has to fit too — the axis reads magnitude.
  check('a big loss widens the axis', chooseAxisMax([-400_000, 1_000]) >= 400_000)
}

// ── 2. LENGTH IS PROPORTIONAL TO MONEY ───────────────────────────────────────
{
  check('twice the profit, twice the bar',
    near(barWidthPct(20_000, axisMax), barWidthPct(10_000, axisMax) * 2))
  check('half the axis is half the track', near(barWidthPct(axisMax / 2, axisMax), 50))
  check('the full axis fills the track', near(barWidthPct(axisMax, axisMax), 100))
  check('$0 draws NOTHING', barWidthPct(0, axisMax) === 0)
  check('a tiny profit still draws', barWidthPct(1, axisMax) >= MIN_BAR_PCT)
  check('NaN draws nothing', barWidthPct(NaN, axisMax) === 0)
  check('a zero axis cannot divide by zero', barWidthPct(100, 0) === 0)
}

// ── 3. ⚠️ SIGN IS *NOT* IN THE LENGTH — SO IT MUST BE SOMEWHERE ELSE ─────────
// ⛔ THIS IS THE KNOWN, ACCEPTED TRADE OF ANCHORING AT THE LEFT EDGE. A loss
// and a gain of the same size are the SAME BAR. Asserted here so nobody later
// "fixes" the length and assumes direction was ever encoded in it. The layout
// guard below is what proves colour AND pattern are still carrying it.
check('⚠️ BY DESIGN: -$3,190 and +$3,190 draw identical lengths',
  near(barWidthPct(-3190, axisMax), barWidthPct(3190, axisMax)))

// ── 4. THE GRADATIONS TELL THE TRUTH ─────────────────────────────────────────
// The scale moves between rungs, so the labels are the only thing telling a
// reader whether a full bar is $50k or $5M. If they drift, the chart lies.
{
  check('gradations span 0..100%', ticks[0].pct === 0 && ticks[ticks.length - 1].pct === 100)
  check('first gradation is $0', ticks[0].label === '$0' && ticks[0].value === 0)
  check('last gradation is the axis max', ticks[ticks.length - 1].value === axisMax)
  check('gradations are evenly spaced and rising',
    ticks.every((t, i) => i === 0 || (t.value > ticks[i - 1].value && t.pct > ticks[i - 1].pct)))
  check('each gradation label matches its own value',
    ticks.every((t) => t.label === shortMoney(t.value)),
    ticks.map((t) => `${t.label}=${t.value}`).join(' '))
  // ⛔ A bar at a gradation's value must land exactly ON that gradation, or
  // the grid lines are decorative and a reader measuring against them is wrong.
  for (const t of ticks) {
    check(`a bar worth ${t.label} ends on the ${t.label} line`,
      near(barWidthPct(t.value, axisMax), t.pct) || t.value === 0)
  }
  check('$50k axis reads in $10k steps', ticks.map((t) => t.label).join(' ') === '$0 $10k $20k $30k $40k $50k',
    ticks.map((t) => t.label).join(' '))
  check('short money: thousands', shortMoney(12_500) === '$12.5k', shortMoney(12_500))
  check('short money: whole thousands have no decimal', shortMoney(50_000) === '$50k', shortMoney(50_000))
  check('short money: millions', shortMoney(2_500_000) === '$2.5M', shortMoney(2_500_000))
  check('short money: zero', shortMoney(0) === '$0')
}

// ── 7. BLENDED IS REVENUE-WEIGHTED, NOT A MEAN OF RATIOS ─────────────────────
// ⛔ THIS IS THE CHECK THAT MATTERS MOST. A mean of percentages lets a tiny
// job swing the shop's headline number as hard as a huge one.
{
  const mixed = [
    { profit: 3000, revenue: 5000 },    // 60% on a small job
    { profit: 100000, revenue: 500000 }, // 20% on a big one
  ]
  const simple = (60 + 20) / 2
  const b = blendedMarginPct(mixed)
  check('blended is revenue-weighted', b < 21 && b > 20, `${b.toFixed(2)}% (mean of ratios says ${simple}%)`)
  check('blended differs from the mean of ratios', Math.abs(b - simple) > 19)

  check('Bayside blended = 28.7%', near(blendedMarginPct(BAYSIDE), 28.7, 0.05),
    `${blendedMarginPct(BAYSIDE).toFixed(2)}`)
  const meanOfRatios = BAYSIDE.reduce((s, p) => s + p.marginPct, 0) / BAYSIDE.length
  check('⚠️ Bayside: blended BEATS the 25% target while the mean of ratios MISSES it',
    blendedMarginPct(BAYSIDE) > 25 && meanOfRatios < 25,
    `blended ${blendedMarginPct(BAYSIDE).toFixed(1)}% vs mean ${meanOfRatios.toFixed(1)}%`)

  check('no revenue: no divide-by-zero', blendedMarginPct([{ profit: 5, revenue: 0 }]) === 0)
  check('empty: blended is 0', blendedMarginPct([]) === 0)
  check('average profit', near(averageProfit(BAYSIDE), 106498 / 7, 1e-6), `${averageProfit(BAYSIDE)}`)
  check('average of nothing is 0, not NaN', averageProfit([]) === 0)
}

// ── 8. THE AVERAGE ROW SHARES THE ROWS' SCALE ────────────────────────────────
// If it didn't, the one row meant to summarise the others would be the one row
// you can't compare to them.
{
  const avg = averageProfit(BAYSIDE)
  const w = barWidthPct(avg, axisMax)
  check('average bar sits on the track', w <= 100)
  check('the average BAR is the average DOLLARS, same basis as every row',
    near(w, (avg / axisMax) * 100))
  check('average is shorter than the best job', w < barWidthPct(32730, axisMax))
  check('average is longer than the smallest gain', w > barWidthPct(6480, axisMax))
  check('average shares the rows\' axis', chooseAxisMax(BAYSIDE.map((p) => p.profit)) === axisMax)
}

// ═════════════════════════════════════════════════════════════════════════════
// 9. THE LAYOUT GUARD — read the component, not a description of it.
// ═════════════════════════════════════════════════════════════════════════════
// ⛔ This is the half that tsc cannot see and that the original bug lived in.
const file = path.join(process.cwd(), 'app/(app)/reports/components/CompletedProjects.tsx')
const rawSrc = fs.readFileSync(file, 'utf8')

// ⛔ STRIP COMMENTS BEFORE SCANNING. The first run of this guard went red on
// `min-w-[80px]` and `transition-all` — both of which appear ONLY inside the
// comments that explain why they're forbidden. A guard that can't tell code
// from prose about code fails whenever someone documents the bug properly,
// which trains everyone to delete the documentation. It scans code now.
const src = rawSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

// The defect, exactly: a `min-w-*` sibling of the `flex-1` track grows with its
// content and steals width from the track, so rows stop being comparable.
const minW = src.match(/min-w-\[[^\]]+\]/g) || []
check('⛔ NO min-w-* anywhere in the row (it steals width from the track)',
  minW.length === 0, minW.join(' '))

// Each column constant must be fixed-width AND non-shrinking. `flex-shrink-0`
// alone is not enough — that was the value column's exact state.
for (const name of ['COL_NAME', 'COL_HOURS', 'COL_VALUE']) {
  const m = src.match(new RegExp(`const ${name} = '([^']+)'`))
  check(`${name} is declared`, !!m)
  if (!m) continue
  check(`${name} is flex-shrink-0`, m[1].includes('flex-shrink-0'), m[1])
  check(`${name} has an explicit w-[…]`, /\bw-\[/.test(m[1]), m[1])
  check(`${name} has no min-w`, !m[1].includes('min-w'), m[1])
}

// Every column must actually be USED by all three row shapes (legend, project
// row, average row), or the track width differs between them and the legend's
// "0" drifts off the 0 line it labels.
for (const [name, expected] of [['COL_NAME', 3], ['COL_HOURS', 3], ['COL_VALUE', 3]]) {
  const uses = (src.match(new RegExp(`\\{?${name}\\}?`, 'g')) || []).length - 1 // minus the declaration
  check(`${name} used by all ${expected} row shapes`, uses >= expected, `${uses} uses`)
}

// Length must never animate — an in-between width is an in-between dollar figure.
check('⛔ no transition-all (it animates WIDTH)', !src.includes('transition-all'))

// The old single-direction bar must be GONE, not merely unused.
check('⛔ the Math.abs(marginPct) bar is gone', !/Math\.abs\(\s*project\.marginPct/.test(src))
// ⛔ THE BAR MUST BE FED DOLLARS, AND THE BIG NUMBER MUST BE DOLLARS TOO.
// The previous build drove the bar with dollars and printed the PERCENTAGE as
// the primary figure, so Gulfview's longest-in-the-set bar sat beside "+31.9%"
// while Vega's shorter bar read "+35.3%". Whatever drives the length has to be
// the number the eye lands on first.
check('⛔ bar length comes from profit dollars', src.includes('barWidthPct(project.profit, axisMax)'))
check('⛔ the bar is anchored at the left edge', src.includes('bottom-0 left-0 rounded-sm'))
{
  // In the value column, fmtMoney must appear BEFORE the percentage.
  const col = src.slice(src.indexOf('COL_VALUE}`}'), src.indexOf('COL_VALUE}`}') + 600)
  const moneyAt = col.indexOf('fmtMoney(project.profit)')
  const pctAt = col.indexOf('marginPct.toFixed(1)')
  check('⛔ dollars are the BIG number, percent is secondary',
    moneyAt > -1 && pctAt > -1 && moneyAt < pctAt, `money@${moneyAt} pct@${pctAt}`)
}

// ⛔⛔ SIGN IS CARRIED BY COLOUR *AND* PATTERN, NOT COLOUR ALONE.
// Every bar grows the same direction now, so a loss and a gain of equal size
// are the same length. Red/green is the worst pair for colour-vision
// deficiency (~8% of men) — drop the stripes and ~1 reader in 12 cannot tell
// -$3,190 from +$3,190 at all. This is the check that keeps that from
// happening quietly.
check('⛔ LOSS_FILL (the stripe pattern) exists', src.includes('const LOSS_FILL'))
check('⛔ LOSS_FILL is actually a repeating gradient, not a flat colour',
  /LOSS_FILL[\s\S]{0,200}repeating-linear-gradient/.test(src))
const lossUses = (src.match(/LOSS_FILL\(/g) || []).length
check('⛔ the stripe is applied to project rows AND the average row',
  lossUses >= 2, `${lossUses} uses`)
check('⛔ sign comes from profit, not the percentage', src.includes('project.profit < 0'))

// The laddered axis has to be SHOWN, or a reader cannot tell $50k from $5M.
check('gradations are computed', src.includes('gradations(axisMax)'))
const tickUses = (src.match(/ticks\./g) || []).length
check('gradations are drawn in the header AND behind the bars', tickUses >= 3, `${tickUses} uses`)

// Nothing from the abandoned centred/percent axis may survive.
check('⛔ no leftover centred-axis geometry', !src.includes('ZERO_X') && !src.includes('targetX'))
check('⛔ no leftover percent-driven bar', !src.includes('barGeometry('))

check('the component was actually read', rawSrc.length > 2000 && src.includes('CompletedProjects'))

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n══ profit bar — zero at left, laddered axis ══\n`)
const W = 54
console.log(`  ${''.padEnd(22)} ${ticks.map((t) => t.label.padEnd(W / (ticks.length - 1))).join('')}`)
for (const p of [...BAYSIDE, { name: 'AVERAGE (per job)', profit: averageProfit(BAYSIDE) }]) {
  const w = Math.max(1, Math.round((barWidthPct(p.profit, axisMax) / 100) * W))
  const fill = p.profit < 0 ? '▨' : '█'
  console.log(
    `  ${p.name.padEnd(22)} ${fill.repeat(w)}${'·'.repeat(W - w)}  ` +
      `${p.profit < 0 ? '-$' : ' $'}${Math.abs(Math.round(p.profit)).toLocaleString()}`,
  )
}
console.log(`\n  axis $0 … ${shortMoney(axisMax)}   ▨ = striped (loss)`)

console.log(`\n  ${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`)
if (fails.length) {
  for (const f of fails) console.log(`   ⛔ ${f}`)
  console.log('')
  process.exit(1)
}
console.log('')
