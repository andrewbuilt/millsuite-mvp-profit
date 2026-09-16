// ============================================================================
// verify-margin-bar-geometry.mjs — the Completed Projects diverging bar.
// ============================================================================
// Run: npx tsx scripts/verify-margin-bar-geometry.mjs   (no DB, no network)
//
// ⛔ WHY THIS FILE EXISTS. The last defect in this chart was GEOMETRY, and it
// shipped because geometry isn't type-checked: an elastic column made every
// row's bar track a different width, so lengths were not comparable between
// rows. tsc was green the whole time. Two investigations went hunting in the
// data, which was correct the whole time.
//
// So this checks BOTH halves of the drawing:
//   1. the math   — one scale, both sides, every row; nothing overflows
//   2. the layout — no sibling of the `flex-1` track can grow with its content
//
// ⚠️ Every check below was confirmed to FAIL when the thing it guards was
// deliberately broken. A guard that has never gone red is not a guard.
// ============================================================================

import {
  MIN_BAR_PCT,
  MIN_SIDE,
  averageProfit,
  barGeometry,
  blendedMarginPct,
  computeBarScale,
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

const scale = computeBarScale(BAYSIDE.map((p) => p.profit))

// ── 1. ONE SCALE, BOTH SIDES ─────────────────────────────────────────────────
// The invariant the whole redesign rests on: a dollar is the same width
// whether it was made or lost. Break this and a small loss can draw longer
// than a large gain, which is the old bug wearing a new coat.
{
  const gain = barGeometry(5000, scale)
  const loss = barGeometry(-5000, scale)
  check('equal magnitudes draw equal lengths', near(gain.widthPct, loss.widthPct),
    `gain ${gain.widthPct.toFixed(3)} vs loss ${loss.widthPct.toFixed(3)}`)

  const big = barGeometry(20000, scale)
  const small = barGeometry(10000, scale)
  check('twice the profit draws twice the bar', near(big.widthPct, small.widthPct * 2, 1e-6),
    `${big.widthPct.toFixed(3)} vs ${small.widthPct.toFixed(3)}`)
}

// ── 2. THE 0 LINE ANCHORS EVERY BAR ──────────────────────────────────────────
for (const p of BAYSIDE) {
  const g = barGeometry(p.profit, scale)
  if (p.profit > 0) {
    check(`${p.name}: gain starts AT 0`, near(g.leftPct, scale.zeroPct),
      `left ${g.leftPct.toFixed(3)} vs zero ${scale.zeroPct.toFixed(3)}`)
  } else {
    check(`${p.name}: loss ENDS at 0`, near(g.leftPct + g.widthPct, scale.zeroPct),
      `right edge ${(g.leftPct + g.widthPct).toFixed(3)} vs zero ${scale.zeroPct.toFixed(3)}`)
  }
}

// ── 3. NOTHING LEAVES THE TRACK ──────────────────────────────────────────────
// A bar drawn past 100% is silently clipped by the browser, so it reads as
// "exactly the maximum" — a number that looks plausible and is wrong.
for (const p of BAYSIDE) {
  const g = barGeometry(p.profit, scale)
  check(`${p.name}: stays on the track`,
    g.leftPct >= -1e-9 && g.leftPct + g.widthPct <= 100 + 1e-9,
    `[${g.leftPct.toFixed(3)}, ${(g.leftPct + g.widthPct).toFixed(3)}]`)
}

// ── 4. THE EXTREMES USE THE FULL TRACK ───────────────────────────────────────
{
  const maxGain = barGeometry(scale.maxGain, scale)
  check('largest gain reaches the right edge',
    near(maxGain.leftPct + maxGain.widthPct, 100, 1e-6),
    `${(maxGain.leftPct + maxGain.widthPct).toFixed(3)}%`)
}

// ── 5. DEGENERATE SETS DON'T PRODUCE NaN ─────────────────────────────────────
// An all-profitable shop is the COMMON case, not an edge case.
{
  const allGains = computeBarScale([100, 200, 300])
  check('all gains: 0 line floors at MIN_SIDE', near(allGains.zeroPct, MIN_SIDE * 100),
    `${allGains.zeroPct}`)
  check('all gains: scale is finite', Number.isFinite(allGains.pctPerDollar) && allGains.pctPerDollar > 0)

  const allLosses = computeBarScale([-100, -200])
  check('all losses: 0 line caps at 1-MIN_SIDE', near(allLosses.zeroPct, (1 - MIN_SIDE) * 100),
    `${allLosses.zeroPct}`)
  check('all losses: scale is finite', Number.isFinite(allLosses.pctPerDollar) && allLosses.pctPerDollar > 0)

  const empty = computeBarScale([])
  check('empty set: no NaN', Number.isFinite(empty.zeroPct) && Number.isFinite(empty.pctPerDollar))

  const zeros = computeBarScale([0, 0])
  check('all zeros: no NaN', Number.isFinite(zeros.zeroPct) && Number.isFinite(zeros.pctPerDollar))
  const zg = barGeometry(0, zeros)
  check('zero profit draws NOTHING', zg.widthPct === 0, `${zg.widthPct}`)
}

// ── 6. A SLIVER IS VISIBLE, BUT ZERO IS NOT A SLIVER ─────────────────────────
{
  const lopsided = computeBarScale([1000000, 1])
  const tiny = barGeometry(1, lopsided)
  check('a tiny non-zero profit still draws', tiny.widthPct >= MIN_BAR_PCT, `${tiny.widthPct}`)
  check('the sliver still starts at 0', near(tiny.leftPct, lopsided.zeroPct))
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
  const avg = barGeometry(averageProfit(BAYSIDE), scale)
  check('average bar sits on the track', avg.leftPct + avg.widthPct <= 100 + 1e-9)
  const gulfview = barGeometry(32730, scale)
  check('average is shorter than the best job', avg.widthPct < gulfview.widthPct)
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
check('bar length comes from profit', src.includes('barGeometry(project.profit'))

// The percent-axis target tick cannot survive on a dollar axis.
check('⛔ no percent target tick on a dollar axis', !src.includes('targetPosition'))

// The 0 line is shared geometry, not a per-row guess. Three places need it:
// the legend's "0" label, the project row, the average row.
const zeroUses = (src.match(/scale\.zeroPct/g) || []).length
check('the 0 line is drawn from the shared scale in all 3 row shapes', zeroUses >= 3, `${zeroUses} uses`)

// The declarations themselves live in the stripped-out region? No — they're
// code. But the COL_* regexes ran against `src`, so confirm the file really
// still contains what we think it does before trusting any of the above.
check('the component was actually read', rawSrc.length > 2000 && src.includes('CompletedProjects'))

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n══ margin bar geometry ══\n`)
console.log(`  Bayside scale: 0 line at ${scale.zeroPct.toFixed(1)}%  ·  ${scale.pctPerDollar.toFixed(5)}% per dollar`)
console.log(`  maxGain $${scale.maxGain.toLocaleString()} · maxLoss $${scale.maxLoss.toLocaleString()}\n`)
for (const p of BAYSIDE) {
  const g = barGeometry(p.profit, scale)
  const L = Math.round(g.leftPct / 2)
  const W = Math.max(1, Math.round(g.widthPct / 2))
  console.log(
    `  ${p.name.padEnd(22)} ${' '.repeat(L)}${(p.profit < 0 ? '◀' : '') + '█'.repeat(W)}` +
      `${' '.repeat(Math.max(0, 52 - L - W))} ${p.profit < 0 ? '-$' : '+$'}${Math.abs(p.profit).toLocaleString()}`,
  )
}
const ag = barGeometry(averageProfit(BAYSIDE), scale)
console.log(
  `  ${'AVERAGE'.padEnd(22)} ${' '.repeat(Math.round(ag.leftPct / 2))}${'█'.repeat(Math.max(1, Math.round(ag.widthPct / 2)))}`,
)

console.log(`\n  ${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`)
if (fails.length) {
  for (const f of fails) console.log(`   ⛔ ${f}`)
  console.log('')
  process.exit(1)
}
console.log('')
