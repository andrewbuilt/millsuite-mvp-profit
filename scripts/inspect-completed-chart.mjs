// ============================================================================
// inspect-completed-chart.mjs — READ ONLY. What the Completed Projects chart
// is actually being asked to draw, with real numbers.
// ============================================================================
// Run: npx tsx scripts/inspect-completed-chart.mjs [orgIdOrSlug]
//      defaults to the Bayside Millworks demo org (the marketing screenshot).
//
// ⛔ WHY THIS EXISTS. The redesign switches the bar from MARGIN PERCENT to
// DOLLAR PROFIT and adds a blended average. Both are claims about proportion,
// and proportion is exactly what the last bug in this component got wrong. So
// before changing the drawing, print what the drawing has to represent:
//   · the dollar spread (does one job dwarf the rest? then every other bar
//     collapses to a sliver and the chart says nothing)
//   · simple mean margin vs BLENDED margin (the page's KPI card shows the
//     simple mean; if those two differ the page contradicts itself)
//   · the widest text the right-hand column can produce (an elastic column
//     there shifts every bar — the same bug, other edge)
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const DEMO = '36f655a7-b989-4073-bb9d-3c5585623738'
const arg = process.argv[2] || DEMO

const { data: orgs } = await db.from('orgs').select('id, name, slug, profit_margin_pct')
const org =
  (orgs || []).find((o) => o.id === arg) ||
  (orgs || []).find((o) => o.slug === arg) ||
  (orgs || []).find((o) => (o.name || '').toLowerCase().includes(String(arg).toLowerCase()))
if (!org) {
  console.log(`\n⛔ no org matching "${arg}". Known: ${(orgs || []).map((o) => o.slug || o.name).join(', ')}\n`)
  process.exit(1)
}

// Replicate the page's own query EXACTLY: `projects!inner(name)`, the 90-day
// default window as a full ISO timestamp, practice projects excluded after.
// ⛔ The first draft of this script embedded `projects(name, is_practice)` and
// printed "0 completed rows — nothing to draw." There are seven. PostgREST
// fails the WHOLE select on one unknown column, and the error rode in a field
// this script wasn't reading, so a broken query rendered as an empty shop.
// That is the exact failure this file exists to catch. The error is checked now.
const since = new Date()
since.setDate(since.getDate() - 90)
const { data: raw, error: rawErr } = await db
  .from('project_outcomes')
  .select('id, completed_at, actual_revenue, actual_margin, actual_margin_pct, project_id, projects!inner(name)')
  .eq('org_id', org.id)
  .gte('completed_at', since.toISOString())
  .order('completed_at', { ascending: false })
if (rawErr) {
  console.log(`\n⛔ the outcomes query FAILED — this is not an empty shop: ${rawErr.message}\n`)
  process.exit(1)
}

const { data: practice } = await db
  .from('projects')
  .select('id, is_practice')
  .eq('org_id', org.id)
  .eq('is_practice', true)
const practiceIds = new Set((practice || []).map((p) => p.id))
const rows = (raw || []).filter((o) => !practiceIds.has(o.project_id))
const target = org.profit_margin_pct ?? 25

console.log(`\n══ ${org.name} · target ${target}% · ${rows.length} completed rows in the 90d window ══\n`)
if (rows.length === 0) {
  console.log('  nothing to draw.\n')
  process.exit(0)
}

const profits = rows.map((r) => Number(r.actual_margin))
const maxGain = Math.max(0, ...profits)
const maxLoss = Math.max(0, ...profits.map((p) => -p))
const span = maxGain + maxLoss

for (const r of rows) {
  const p = Number(r.actual_margin)
  const share = span > 0 ? (Math.abs(p) / span) * 100 : 0
  console.log(
    `  ${String(r.projects?.name).slice(0, 34).padEnd(34)} ` +
      `${(Number(r.actual_margin_pct)).toFixed(1).padStart(6)}%  ` +
      `${fmt(p).padStart(10)}  rev ${fmt(Number(r.actual_revenue)).padStart(10)}  ` +
      `bar ${share.toFixed(1).padStart(5)}% of span`,
  )
}

// ── Does the dollar axis still separate the rows? ──
const gains = profits.filter((p) => p > 0)
const smallestGain = gains.length ? Math.min(...gains) : 0
console.log(`\n  maxGain ${fmt(maxGain)} · maxLoss ${fmt(-maxLoss)} · span ${fmt(span)}`)
console.log(
  `  smallest gain ${fmt(smallestGain)} → ${((smallestGain / span) * 100).toFixed(1)}% of the span` +
    (smallestGain / span < 0.05 ? '   ⚠️ under 5% — that bar is a sliver on a dollar axis' : ''),
)

// ── The two averages. If these disagree, the page disagrees with itself. ──
const simpleMean = rows.reduce((s, r) => s + Number(r.actual_margin_pct), 0) / rows.length
const totalProfit = profits.reduce((s, p) => s + p, 0)
const totalRevenue = rows.reduce((s, r) => s + Number(r.actual_revenue), 0)
const blended = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
console.log(`\n══ average margin — two different numbers ══`)
console.log(`  simple mean of percentages : ${simpleMean.toFixed(1)}%   ← what the "Avg margin" KPI card shows today`)
console.log(`  BLENDED (ΣProfit / ΣRevenue): ${blended.toFixed(1)}%   ← what the brief's Average row asks for`)
console.log(`  difference: ${Math.abs(simpleMean - blended).toFixed(1)} points`)
if (Math.abs(simpleMean - blended) >= 0.5) {
  console.log(`  ⛔ THE PAGE WOULD SHOW BOTH, ~100px apart, both labelled "average". Pick one.`)
}
console.log(`  avg profit per job: ${fmt(totalProfit / rows.length)} (the Average row's bar length)`)

// ── The right-hand column: can it shift the bars? ──
const widest = rows.reduce((w, r) => {
  const pct = `${Number(r.actual_margin_pct) >= 0 ? '+' : ''}${Number(r.actual_margin_pct).toFixed(1)}%`
  const money = fmt(Number(r.actual_margin))
  return Math.max(w, pct.length, money.length)
}, 0)
const narrowest = rows.reduce((w, r) => {
  const pct = `${Number(r.actual_margin_pct) >= 0 ? '+' : ''}${Number(r.actual_margin_pct).toFixed(1)}%`
  const money = fmt(Number(r.actual_margin))
  return Math.min(w, Math.max(pct.length, money.length))
}, 99)
console.log(`\n══ right-hand value column ══`)
console.log(`  widest row ${widest} chars · narrowest ${narrowest} chars`)
console.log(
  widest === narrowest
    ? `  ✅ every row is the same width TODAY — but the column is min-w, so this is luck, not a guarantee.`
    : `  ⛔ ${widest - narrowest} chars of difference — with a min-w column that SHIFTS the bars, exactly like the hours bug.`,
)
console.log('')

function fmt(n) {
  const v = Math.round(Math.abs(n)).toLocaleString()
  return n < 0 ? `-$${v}` : `$${v}`
}
