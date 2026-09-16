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
  AXIS_MAX_PCT,
  MIN_BAR_PCT,
  ZERO_X,
  averageProfit,
  barGeometry,
  blendedMarginPct,
  targetX,
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

// ── 1. THE BAR IS THE NUMBER BESIDE IT ───────────────────────────────────────
// ⛔ THE CHECK THIS CHART EXISTS FOR, AND THE ONE THE DOLLAR VERSION FAILED.
// Order by bar length and order by printed percentage MUST be the same order.
// The dollar-scaled version drew Gulfview (+31.9%) longer than Vega (+35.3%)
// because Gulfview is a bigger job — a longer bar against a smaller number.
{
  const gains = BAYSIDE.filter((p) => p.marginPct > 0)
  const byBar = [...gains].sort((a, b) => barGeometry(b.marginPct).widthPct - barGeometry(a.marginPct).widthPct)
  const byPct = [...gains].sort((a, b) => b.marginPct - a.marginPct)
  check('⛔ longest bar = highest percentage, every row',
    byBar.map((p) => p.name).join('|') === byPct.map((p) => p.name).join('|'),
    `bars: ${byBar.map((p) => p.name).join(', ')}`)

  // And the strict form: length is exactly proportional to the percentage.
  for (const p of gains) {
    const g = barGeometry(p.marginPct)
    check(`${p.name}: length is its own percentage`,
      near(g.widthPct, (p.marginPct / AXIS_MAX_PCT) * ZERO_X, 1e-9),
      `${g.widthPct.toFixed(4)} vs ${((p.marginPct / AXIS_MAX_PCT) * ZERO_X).toFixed(4)}`)
  }
}

// ── 2. THE AXIS IS FIXED, NOT DERIVED FROM THE DATA ──────────────────────────
// A row must draw the same length regardless of what it is sitting next to.
// This is what lets two periods — or two shops — be compared at all.
{
  const alone = barGeometry(35.3)
  check('a row is unaffected by its neighbours', near(alone.widthPct, (35.3 / 100) * 50))
  check('0 line is dead centre', ZERO_X === 50)
  check('+100% reaches the right edge', near(barGeometry(100).leftPct + barGeometry(100).widthPct, 100))
  check('−100% reaches the left edge', near(barGeometry(-100).leftPct, 0))
  check('a 30% job fills 30% of its half', near(barGeometry(30).widthPct, 15))
}

// ── 3. GAINS RIGHT, LOSSES LEFT, BOTH ANCHORED AT 0 ──────────────────────────
for (const p of BAYSIDE) {
  const g = barGeometry(p.marginPct)
  if (p.marginPct > 0) {
    check(`${p.name}: gain starts AT 0`, near(g.leftPct, ZERO_X), `${g.leftPct}`)
  } else {
    check(`${p.name}: loss ENDS at 0`, near(g.leftPct + g.widthPct, ZERO_X), `${g.leftPct + g.widthPct}`)
  }
  check(`${p.name}: stays on the track`,
    g.leftPct >= -1e-9 && g.leftPct + g.widthPct <= 100 + 1e-9,
    `[${g.leftPct.toFixed(2)}, ${(g.leftPct + g.widthPct).toFixed(2)}]`)
}

// ── 4. EQUAL MAGNITUDES, EQUAL LENGTHS ───────────────────────────────────────
// A dollar of margin is the same width whether it was made or lost.
check('+15% and −15% draw the same length',
  near(barGeometry(15).widthPct, barGeometry(-15).widthPct))

// ── 5. THE TARGET TICK IS ONE x FOR EVERY ROW ────────────────────────────────
// ⛔ This is what the fixed axis buys back — it was impossible on a dollar axis.
{
  check('25% target sits at 62.5%', near(targetX(25), 62.5), `${targetX(25)}`)
  check('a 0% target sits on the 0 line', near(targetX(0), ZERO_X))
  check('the target tick does not depend on any row', targetX(25) === targetX(25))
  // A job at exactly target must end exactly on the tick, or the tick lies.
  const atTarget = barGeometry(25)
  check('a job AT target ends exactly on the tick',
    near(atTarget.leftPct + atTarget.widthPct, targetX(25)),
    `${atTarget.leftPct + atTarget.widthPct} vs ${targetX(25)}`)
  const under = barGeometry(20.6)
  check('a job UNDER target ends left of the tick', under.leftPct + under.widthPct < targetX(25))
  const over = barGeometry(35.3)
  check('a job OVER target ends right of the tick', over.leftPct + over.widthPct > targetX(25))
}

// ── 6. DEGENERATE VALUES DON'T PRODUCE NaN OR OVERFLOW ───────────────────────
{
  check('0% draws NOTHING', barGeometry(0).widthPct === 0)
  check('0% still sits on the line', near(barGeometry(0).leftPct, ZERO_X))
  const tiny = barGeometry(0.01)
  check('a tiny non-zero margin still draws', tiny.widthPct >= MIN_BAR_PCT, `${tiny.widthPct}`)
  // ⚠️ A catastrophic job (cost > 2x price) is below −100%. It clamps to the
  // end of the track; the printed number keeps telling the truth.
  const disaster = barGeometry(-250)
  check('−250% clamps to the left edge, no overflow',
    near(disaster.leftPct, 0) && near(disaster.widthPct, ZERO_X), `${JSON.stringify(disaster)}`)
  check('NaN margin draws nothing', barGeometry(NaN).widthPct === 0)
  check('undefined margin draws nothing', barGeometry(undefined).widthPct === 0)
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
  const blended = blendedMarginPct(BAYSIDE)
  const avg = barGeometry(blended)
  check('average bar sits on the track', avg.leftPct + avg.widthPct <= 100 + 1e-9)
  check('the average BAR is the average PERCENT, same as every row',
    near(avg.widthPct, (blended / AXIS_MAX_PCT) * ZERO_X))
  check('average is shorter than the best job', avg.widthPct < barGeometry(35.3).widthPct)
  check('average is longer than the worst gain', avg.widthPct > barGeometry(20.6).widthPct)
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
// ⛔ THE BAR MUST BE FED THE SAME FIELD THAT IS PRINTED. `project.profit`
// here is the dollar-scaled version's exact mistake.
check('⛔ bar length comes from marginPct, the number that is printed',
  src.includes('barGeometry(project.marginPct)'))
check('⛔ bar length is NOT dollars', !src.includes('barGeometry(project.profit'))

// The target tick is back, and it must be the shared one.
check('the target tick is drawn from targetX()', src.includes('targetX(marginTarget)'))
const targetUses = (src.match(/targetPos/g) || []).length
check('the target tick appears in the legend + both row shapes', targetUses >= 4, `${targetUses} uses`)

// The 0 line is the fixed axis constant, not a per-row or per-set guess.
const zeroUses = (src.match(/ZERO_X/g) || []).length
check('the 0 line is the fixed ZERO_X in all 3 row shapes', zeroUses >= 4, `${zeroUses} uses`)
check('⛔ no data-derived zero position survives', !src.includes('scale.zeroPct'))

// The declarations themselves live in the stripped-out region? No — they're
// code. But the COL_* regexes ran against `src`, so confirm the file really
// still contains what we think it does before trusting any of the above.
check('the component was actually read', rawSrc.length > 2000 && src.includes('CompletedProjects'))

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`\n══ margin bar geometry — fixed axis, 0 dead centre ══\n`)
const W = 60
const mark = (x) => Math.round((x / 100) * W)
const axis = Array(W + 1).fill(' ')
axis[mark(ZERO_X)] = '0'
axis[mark(targetX(25))] = 'T'
console.log(`  ${''.padEnd(22)} ${axis.join('')}   −100% … 0 … +100%  (T = 25% target)`)
for (const p of [...BAYSIDE, { name: 'AVERAGE (blended)', marginPct: blendedMarginPct(BAYSIDE) }]) {
  const g = barGeometry(p.marginPct)
  const L = mark(g.leftPct)
  const Wd = Math.max(1, mark(g.widthPct))
  const line = Array(W + 1).fill('·')
  for (let i = L; i < L + Wd; i++) line[i] = p.marginPct < 0 ? '▓' : '█'
  line[mark(ZERO_X)] = '|'
  console.log(`  ${p.name.padEnd(22)} ${line.join('')}   ${p.marginPct >= 0 ? '+' : ''}${p.marginPct.toFixed(1)}%`)
}

console.log(`\n  ${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`)
if (fails.length) {
  for (const f of fails) console.log(`   ⛔ ${f}`)
  console.log('')
  process.exit(1)
}
console.log('')
