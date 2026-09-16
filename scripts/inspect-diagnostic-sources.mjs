// ============================================================================
// inspect-diagnostic-sources.mjs — READ ONLY. What can the /reports diagnostic
// drawer actually SHOW, and is any of it a fallback wearing a real label?
// ============================================================================
// Run: npx tsx scripts/inspect-diagnostic-sources.mjs
//
// ⛔ WHY. The drawer is being rebuilt to show tracked hours per department and
// material budget vs spend, each linking to a manifest. Every one of those is a
// claim about recorded reality, and this codebase has repeatedly shipped a
// screen where a FALLBACK was indistinguishable from a FACT. Before drawing any
// of it, check:
//   · do project_outcomes.dept_hours_estimated / _actual exist and hold data?
//   · does the `invoices` table (the material manifest) exist, and what is its
//     amount column actually called?
//   · ⛔ /api/project-outcome does `materials = actualMaterials > 0 ?
//     actualMaterials : estimatedMaterials` — so "material actual" silently
//     becomes the BUDGET when nothing was recorded, and the variance reads
//     $0 "on budget" when the truth is "nobody logged anything".
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

// ── 1. Does the outcome row carry per-department hours? ──────────────────────
console.log('\n══ project_outcomes: dept hours ══')
const { data: outs, error: outErr } = await db
  .from('project_outcomes')
  .select(
    'id, project_id, org_id, estimated_hours, actual_hours, estimated_materials, actual_materials, dept_hours_estimated, dept_hours_actual, projects!inner(name)',
  )
  .limit(400)
if (outErr) {
  console.log(`  ⛔ the columns do not exist as named: ${outErr.message}`)
} else {
  const withEst = (outs || []).filter((o) => o.dept_hours_estimated && Object.keys(o.dept_hours_estimated).length)
  const withAct = (outs || []).filter((o) => o.dept_hours_actual && Object.keys(o.dept_hours_actual).length)
  console.log(`  ${outs.length} outcome rows total`)
  console.log(`  dept_hours_estimated populated: ${withEst.length}`)
  console.log(`  dept_hours_actual    populated: ${withAct.length}`)
  if (withEst.length === 0) {
    console.log('  ⛔ NOTHING TO DRAW — a per-dept table would render empty for every job.')
  } else {
    const sample = withEst[0]
    console.log(`  sample keys (${sample.projects?.name}): ${Object.keys(sample.dept_hours_estimated).join(', ')}`)
    console.log(`     est: ${JSON.stringify(sample.dept_hours_estimated)}`)
    console.log(`     act: ${JSON.stringify(sample.dept_hours_actual)}`)
  }
  // ⚠️ Do the per-dept numbers actually add up to the headline totals? If they
  // don't, a table that foots to a different number than the card above it is
  // worse than no table.
  let footOk = 0
  let footBad = []
  for (const o of withAct) {
    const sumAct = Object.values(o.dept_hours_actual).reduce((s, v) => s + Number(v || 0), 0)
    if (Math.abs(sumAct - Number(o.actual_hours || 0)) <= 0.6) footOk++
    else footBad.push(`${o.projects?.name}: depts ${sumAct.toFixed(1)}h vs actual_hours ${o.actual_hours}h`)
  }
  console.log(`\n  dept actuals foot to actual_hours: ${footOk}/${withAct.length}`)
  for (const b of footBad.slice(0, 6)) console.log(`     ⚠️ ${b}`)
}

// ── 2. The material manifest: does `invoices` exist, and what is the amount? ──
console.log('\n══ the material manifest (`invoices`) ══')
for (const col of ['total', 'total_amount']) {
  const { error } = await db.from('invoices').select(`id, project_id, ${col}`).limit(1)
  console.log(
    error
      ? `  invoices.${col.padEnd(12)} ⛔ ${error.message.slice(0, 70)}`
      : `  invoices.${col.padEnd(12)} ✅ exists`,
  )
}
const { count: invCount } = await db.from('invoices').select('id', { count: 'exact', head: true })
console.log(`  rows in invoices: ${invCount ?? 'unknown'}`)

// ── 3. ⛔ IS "MATERIAL ACTUAL" REALLY AN ACTUAL? ──────────────────────────────
// /api/project-outcome falls back to the budget when no invoice rows exist, so
// actual === estimated is the SIGNATURE of "nothing was ever recorded".
console.log('\n══ material actual vs budget ══')
if (!outErr) {
  const identical = (outs || []).filter(
    (o) => Number(o.actual_materials) === Number(o.estimated_materials) && Number(o.estimated_materials) > 0,
  )
  const differs = (outs || []).filter(
    (o) => Number(o.actual_materials) !== Number(o.estimated_materials),
  )
  console.log(`  actual === budget (the fallback signature): ${identical.length}`)
  console.log(`  actual  !=  budget (a real recorded spend): ${differs.length}`)
  if (identical.length > 0) {
    console.log(
      `  ⛔ ${identical.length} job${identical.length === 1 ? '' : 's'} would render "on budget, $0 variance"` +
        ` when the truth may be "no material invoice was ever attached".`,
    )
    for (const o of identical.slice(0, 5)) {
      console.log(`     · ${o.projects?.name} — $${Number(o.estimated_materials).toLocaleString()} both sides`)
    }
  }
}

// ── 4. Can /time actually be filtered to one project? ────────────────────────
console.log('\n══ the hours manifest (/time) ══')
const { data: demoOut } = await db
  .from('project_outcomes')
  .select('project_id, projects!inner(name)')
  .eq('org_id', DEMO)
  .limit(1)
if (demoOut?.[0]) {
  const pid = demoOut[0].project_id
  const { count } = await db
    .from('time_entries')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', pid)
  console.log(`  ${demoOut[0].projects?.name}: ${count ?? 0} time entries reachable by project_id`)
  console.log(
    `  ⚠️ CompletedProject.id is the OUTCOME id, not the project id — linking /time?project=<outcome id>` +
      ` returns 0 rows and reads as "nobody tracked time".`,
  )
  console.log(`     outcome.project_id = ${pid}`)
}
console.log('')
