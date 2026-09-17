// ============================================================================
// inspect-drift.mjs — READ ONLY. How far do stored draws sit from the contract?
// ============================================================================
// Run: npx tsx scripts/inspect-drift.mjs
//
// ⛔ WHY MEASURE BEFORE BUILDING. `ProjectReconciliation.drift` carries this
// warning in its own doc comment:
//
//     "NON-ZERO IS THE NORMAL STATE TODAY, not an exception."
//
// If that is literally true across the book, a tray that lists every non-zero
// drift is a tray listing every project — noise that teaches people to ignore
// the one row that matters. So: count them, size them, and find the threshold
// that separates "a change order moved the contract" from "$1 of old rounding".
//
// ⛔ AND THE TRAP THAT MATTERS MOST: `reconcileEverything` falls back to
//     contractTotals[projectId] ?? list.reduce((s, d) => s + d.amount, 0)
// so a project MISSING from the totals map gets its contract DEFINED as the
// stored sum — which makes drift exactly 0 by construction. That is not "in
// sync", it is "we don't know the contract", and a UI that reports it as the
// former is lying. Counted separately below.
//
// STATE says: Batia is NOT drift (removed scope — leave it), Vallowe-Colquhoun
// is $0 vs $33,430, Towers is off $2,474, UT - Public Arts is repricing drift.
// Those four should show up here; if they don't, this script is wrong.
// ============================================================================

import { driftsWorthShowing, reconcileEverything } from '../lib/payment-ledger.ts'
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

const money = (n) =>
  `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString()}`

const { data: orgs, error: orgErr } = await db.from('orgs').select('id, name')
if (orgErr) {
  console.log(`⛔ org read failed: ${orgErr.message}`)
  process.exit(1)
}

const SOLD = ['sold', 'production', 'installed', 'complete']

let grand = { projects: 0, drifting: 0, unknown: 0, noSchedule: 0 }
const buckets = { tiny: 0, small: 0, real: 0, huge: 0 }
const rows = []

for (const org of orgs) {
  const { data: projects, error: pErr } = await db
    .from('projects')
    .select('id, name, bid_total, stage')
    .eq('org_id', org.id)
    .in('stage', SOLD)
  if (pErr) {
    console.log(`⛔ ${org.name}: project read failed — ${pErr.message}`)
    continue
  }
  if (!projects?.length) continue

  const ids = projects.map((p) => p.id)
  const { data: recv, error: rErr } = await db
    .from('cash_flow_receivables')
    .select('project_id, amount, status')
    .in('project_id', ids)
  if (rErr) {
    console.log(`⛔ ${org.name}: receivables read failed — ${rErr.message}`)
    continue
  }

  const byProject = new Map()
  for (const r of recv || []) {
    const list = byProject.get(r.project_id)
    if (list) list.push(r)
    else byProject.set(r.project_id, [r])
  }

  for (const p of projects) {
    grand.projects++
    const draws = byProject.get(p.id) || []
    const storedSum = draws.reduce((s, d) => s + Number(d.amount || 0), 0)
    const contract = Number(p.bid_total || 0)

    if (draws.length === 0) {
      grand.noSchedule++
      continue
    }
    // ⛔ No contract value = the fallback defines drift as 0. Not "in sync".
    if (!contract) {
      grand.unknown++
      rows.push({ org: org.name, name: p.name, contract, storedSum, drift: null, n: draws.length })
      continue
    }

    const drift = Math.round((storedSum - contract) * 100) / 100
    const abs = Math.abs(drift)
    if (abs < 0.005) continue

    grand.drifting++
    if (abs <= 1) buckets.tiny++
    else if (abs < 100) buckets.small++
    else if (abs < 10_000) buckets.real++
    else buckets.huge++

    rows.push({ org: org.name, name: p.name, contract, storedSum, drift, n: draws.length })
  }
}

rows.sort((a, b) => Math.abs(b.drift ?? 0) - Math.abs(a.drift ?? 0))

console.log(`\n══ draw schedules vs contract ══\n`)
for (const r of rows) {
  const tag =
    r.drift === null
      ? '⛔ NO CONTRACT VALUE — drift is undefined, not zero'
      : `${money(r.drift)} ${r.drift > 0 ? '(draws exceed contract)' : '(draws short of contract)'}`
  console.log(
    `  ${r.name.slice(0, 32).padEnd(32)} ${r.org.slice(0, 10).padEnd(10)} ` +
      `contract ${money(r.contract).padStart(10)}  draws ${money(r.storedSum).padStart(10)} (${r.n})  ${tag}`,
  )
}

console.log(`\n══ how big is this problem ══`)
console.log(`  sold-or-later projects        : ${grand.projects}`)
console.log(`  with no schedule at all       : ${grand.noSchedule}  (a different tray already covers these)`)
console.log(`  ⛔ with NO CONTRACT VALUE     : ${grand.unknown}  (drift reads 0 by construction — must NOT say "in sync")`)
console.log(`  actually drifting             : ${grand.drifting}`)
console.log(`     ≤ $1        (old rounding) : ${buckets.tiny}`)
console.log(`     $1–$100                    : ${buckets.small}`)
console.log(`     $100–$10k                  : ${buckets.real}`)
console.log(`     ≥ $10k                     : ${buckets.huge}`)

const scheduled = grand.projects - grand.noSchedule
console.log(
  `\n  ${grand.drifting} of ${scheduled} scheduled projects drift ` +
    `(${scheduled ? Math.round((grand.drifting / scheduled) * 100) : 0}%).`,
)
console.log(
  grand.drifting > scheduled * 0.5
    ? '  ⚠️ MORE THAN HALF — the doc comment is right, and a tray listing all of them is noise.'
    : '  ✅ A minority — a tray naming them is readable rather than wallpaper.',
)
console.log('')

// ── The SHIPPED lib, on the real book ────────────────────────────────────────
// ⛔ Everything above is hand arithmetic. This runs the actual functions the
// board calls, so the tray Andrew sees and the numbers printed here cannot be
// two different answers.
console.log('══ what the board will actually render ══\n')
for (const org of orgs) {
  const { data: raw } = await db
    .from('cash_flow_receivables')
    .select('id, project_id, amount, status, milestone_label, notes, created_at, projects!inner(name, bid_total, stage, org_id)')
    .eq('projects.org_id', org.id)
    .neq('status', 'cancelled')
    .in('projects.stage', SOLD)
  if (!raw?.length) continue

  const rows = raw.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    projectName: r.projects?.name || 'Untitled project',
    clientName: null,
    stage: r.projects?.stage || 'sold',
    label: r.milestone_label || 'Milestone',
    amount: Number(r.amount) || 0,
    expectedDate: null,
    status: r.status,
    sortOrder: Number(/order:(\d+)/.exec(r.notes || '')?.[1] ?? Number.MAX_SAFE_INTEGER),
    createdAt: r.created_at,
  }))
  const totals = {}
  for (const r of raw) totals[r.project_id] = Number(r.projects?.bid_total) || 0

  const { driftByProject } = reconcileEverything(rows, [], totals)
  const shown = driftsWorthShowing(driftByProject)
  console.log(`  ${org.name}: ${shown.length} of ${driftByProject.length} scheduled projects in the tray`)
  for (const d of shown) {
    console.log(
      d.contractKnown
        ? `     ⚠️ ${d.projectName.slice(0, 34).padEnd(34)} ${money(d.storedSum)} of draws vs ${money(d.contractTotal)}  →  ${d.drift > 0 ? '+' : '−'}${money(Math.abs(d.drift))}`
        : `     ⛔ ${d.projectName.slice(0, 34).padEnd(34)} NO CONTRACT VALUE · ${money(d.storedSum)} of draws  →  "—"`,
    )
  }
}
console.log('')
