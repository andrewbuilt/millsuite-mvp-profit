// ============================================================================
// inspect-project-payments.mjs — READ-ONLY. What does a project's money
// actually look like?
// ============================================================================
//   node --env-file=.env.local scripts/inspect-project-payments.mjs Schiller
//   node --env-file=.env.local scripts/inspect-project-payments.mjs Leonard Market
//
// WRITES NOTHING. Every statement is a select.
//
// ⛔ WHY THIS EXISTS. A draw schedule that got rewritten under recorded
// payments can't be diagnosed from the UI: the board shows the DERIVED view
// (the waterfall re-allocates ledger cash over whatever rows exist now), so
// the damage looks like a plausible schedule. This prints the raw rows —
// draws, ledger, and the reconciliation between them — so a repair is done
// against facts instead of the rendering.
//
// Prints, per matching project:
//   · contract (projects.bid_total) vs the sum of the stored draws
//   · every cash_flow_receivables row: label, amount, status, sort order
//   · every project_payments row: amount, date, method
//   · the arithmetic that says whether they agree
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Run with: node --env-file=.env.local scripts/inspect-project-payments.mjs <name…>')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const terms = process.argv.slice(2).filter((a) => !a.startsWith('-'))
if (terms.length === 0) {
  console.error('usage: … inspect-project-payments.mjs <name fragment> [more fragments]')
  process.exit(1)
}

const money = (n) => '$' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-US')

const { data: projects, error } = await db
  .from('projects')
  .select('id, name, stage, bid_total, imported_at')
  .order('name')
if (error) throw error

const matches = projects.filter((p) =>
  terms.every((t) => (p.name || '').toLowerCase().includes(t.toLowerCase())),
)
if (matches.length === 0) {
  console.log(`no project matches [${terms.join(', ')}]`)
  process.exit(0)
}

for (const p of matches) {
  console.log('\n' + '='.repeat(74))
  console.log(`${p.name}`)
  console.log('='.repeat(74))
  console.log(
    `  stage ${p.stage} · contract (bid_total) ${money(p.bid_total)} · ` +
      `${p.imported_at ? 'IMPORTED ' + String(p.imported_at).slice(0, 10) : 'native'}`,
  )

  const { data: draws } = await db
    .from('cash_flow_receivables')
    .select('id, milestone_label, milestone_pct, amount, status, expected_date, received_date, notes, created_at, change_order_id')
    .eq('project_id', p.id)
    .eq('type', 'receivable')
    .order('created_at')

  const rows = draws || []
  console.log(`\n  DRAWS — ${rows.length} row(s)`)
  if (rows.length === 0) console.log('    (none — this project is in the "no payment schedule" tray)')
  let drawSum = 0
  for (const r of rows) {
    if (r.status !== 'cancelled') drawSum += Number(r.amount) || 0
    const order = /order:(\d+)/.exec(r.notes || '')?.[1] ?? '—'
    console.log(
      `    ${String(order).padStart(2)}  ${String(r.milestone_label || '—').padEnd(34).slice(0, 34)} ` +
        `${money(r.amount).padStart(12)}  ${String(r.status).padEnd(9)} ` +
        `${r.milestone_pct != null ? String(r.milestone_pct) + '%' : '   '} ` +
        `exp ${r.expected_date || '—'} ` +
        `${r.change_order_id ? 'CO' : ''} ` +
        `created ${String(r.created_at).slice(0, 19).replace('T', ' ')}`,
    )
  }

  const { data: pays } = await db
    .from('project_payments')
    .select('id, amount, payment_date, method, reference, notes, created_at')
    .eq('project_id', p.id)
    .order('payment_date')
  const ledger = pays || []
  console.log(`\n  LEDGER — ${ledger.length} payment(s)`)
  let cash = 0
  for (const e of ledger) {
    cash += Number(e.amount) || 0
    console.log(
      `        ${money(e.amount).padStart(12)}  ${e.payment_date}  ${String(e.method || '—').padEnd(6)} ` +
        `${(e.reference || '').slice(0, 20).padEnd(20)} created ${String(e.created_at).slice(0, 19).replace('T', ' ')}`,
    )
  }

  const contract = Number(p.bid_total) || 0
  console.log('\n  RECONCILIATION')
  console.log(`    contract           ${money(contract).padStart(14)}`)
  console.log(`    stored draws sum   ${money(drawSum).padStart(14)}` +
    (Math.abs(drawSum - contract) > 0.5 ? `   ⚠ DRIFT ${money(drawSum - contract)}` : '   ✓'))
  console.log(`    cash received      ${money(cash).padStart(14)}`)
  console.log(`    still owed         ${money(contract - cash).padStart(14)}`)

  // ⛔ THE TELL. Payments v2 made paid-ness DERIVED — logPayment never sets
  // a draw's status — so a fully-paid draw is still status='projected' and
  // every path that deletes "only projected rows" can destroy it.
  const projected = rows.filter((r) => r.status === 'projected').length
  const received = rows.filter((r) => r.status === 'received').length
  if (ledger.length > 0 && projected > 0) {
    console.log(
      `\n  ⛔ ${projected} draw row(s) are status='projected' while ${money(cash)} of cash exists.\n` +
        `     Any path that deletes "only projected rows" will destroy them —\n` +
        `     that guard predates Payments v2 and no longer means "unpaid".`,
    )
  }
  if (received > 0) {
    console.log(`\n  · ${received} row(s) carry the legacy status='received'.`)
  }
}

console.log('\nRead-only — nothing was written.\n')
