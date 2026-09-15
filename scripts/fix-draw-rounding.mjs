// ============================================================================
// fix-draw-rounding.mjs — make each project's draws sum to its contract.
// ============================================================================
//   node --env-file=.env.local scripts/fix-draw-rounding.mjs            # dry run
//   node --env-file=.env.local scripts/fix-draw-rounding.mjs --apply
//
// ⛔ WHY. Draw amounts were generated with `Math.round(total * pct / 100)` per
// row, so the rows didn't sum to the contract: 50% of $49,075 rounds to
// $24,538 and each 25% to $12,269 — $49,076. Schiller and Brabson are both $1
// over. The operator then chases a phantom dollar or records a correcting
// payment to make the ledger foot. The generators now use `allocateRounded`;
// this repairs the rows that already exist.
//
// ⛔ WHAT IT WILL NOT DO — these are the ways a repair script does damage:
//   · It never changes the NUMBER of rows, their labels, percentages, dates
//     or statuses. Only `amount`, and only where the total is wrong.
//   · It never touches a cancelled row.
//   · It never touches a CHANGE-ORDER row (change_order_id set): those bill a
//     specific agreed amount and are not a percentage of the contract.
//   · It SKIPS any project whose stored rows are off by more than $1 per row.
//     A dollar or two is rounding; a bigger gap means something else is wrong
//     and silently "fixing" it would erase the evidence.
//   · It leaves the LEDGER completely alone. Recorded payments are facts.
//
// Re-runnable: a project already summing to its contract is reported "ok" and
// written to zero times.
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Run with: node --env-file=.env.local scripts/fix-draw-rounding.mjs [--apply]')
  process.exit(1)
}
const APPLY = process.argv.includes('--apply')
const db = createClient(url, key, { auth: { persistSession: false } })

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

/** Largest-remainder split — the same rule as lib/allocate, inlined so this
 *  script has no build-time dependency on the app. */
function allocateRounded(values, target) {
  const goal = Math.round(target)
  const floors = values.map((v) => Math.floor(v))
  const sumFloors = floors.reduce((a, b) => a + b, 0)
  let remainder = goal - sumFloors
  const order = values
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  const out = [...floors]
  for (const { i } of order) {
    if (remainder <= 0) break
    out[i] += 1
    remainder -= 1
  }
  // A negative remainder (floors already over target) takes back from the
  // smallest fractions first.
  let over = -remainder
  for (let k = order.length - 1; k >= 0 && over > 0; k--) {
    const i = order[k].i
    if (out[i] > 0) {
      out[i] -= 1
      over -= 1
    }
  }
  return out
}

// ⛔ SOLD AND LATER ONLY. On an unsold job `bid_total` is an ESTIMATE that
// moves as the scope changes, so comparing draws to it says nothing — Kennedy
// showed as "off by $68,588" purely because it's a live 50/50 bid. Andrew:
// "Off what? the project isnt sold. that is the estimated price."
const POSTSOLD = ['sold', 'production', 'installed', 'complete']
const { data: projects, error } = await db
  .from('projects')
  .select('id, name, bid_total, stage')
  .in('stage', POSTSOLD)
  .order('name')
if (error) throw error

let fixed = 0
let ok = 0
let skipped = 0

for (const p of projects) {
  const contract = Math.round(Number(p.bid_total) || 0)
  if (contract <= 0) continue

  const { data: draws } = await db
    .from('cash_flow_receivables')
    .select('id, milestone_label, milestone_pct, amount, status, notes, change_order_id')
    .eq('project_id', p.id)
    .eq('type', 'receivable')
    .order('created_at')

  const rows = (draws || []).filter(
    (r) => r.status !== 'cancelled' && !r.change_order_id && Number(r.milestone_pct) > 0,
  )
  if (rows.length === 0) continue

  const sum = rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
  const drift = sum - contract
  if (Math.abs(drift) < 0.5) {
    ok++
    continue
  }

  // ⛔ ROUNDING ONLY. More than a dollar per row is not a rounding artefact.
  if (Math.abs(drift) > rows.length) {
    console.log(
      `SKIP ${p.name.slice(0, 44).padEnd(44)} off by ${money(drift)} across ${rows.length} row(s) — too big to be rounding, inspect it`,
    )
    skipped++
    continue
  }

  const exact = rows.map((r) => (contract * Number(r.milestone_pct)) / 100)
  const allocated = allocateRounded(exact, contract)

  console.log(`FIX  ${p.name.slice(0, 44).padEnd(44)} ${money(sum)} → ${money(contract)}`)
  for (let i = 0; i < rows.length; i++) {
    const before = Number(rows[i].amount) || 0
    if (before === allocated[i]) continue
    console.log(
      `       ${String(rows[i].milestone_label || '').slice(0, 34).padEnd(34)} ` +
        `${money(before)} → ${money(allocated[i])}`,
    )
    if (APPLY) {
      const { data, error: upErr } = await db
        .from('cash_flow_receivables')
        .update({ amount: allocated[i] })
        .eq('id', rows[i].id)
        .select('id')
      if (upErr) throw new Error(`${p.name}: ${upErr.message}`)
      // A zero-row update is a refusal, not a success.
      if (!data || data.length === 0) throw new Error(`${p.name}: update matched no rows`)
    }
  }
  fixed++
}

console.log(
  `\n${APPLY ? `${fixed} project(s) repaired` : `dry run — ${fixed} project(s) would change`}` +
    ` · ${ok} already correct · ${skipped} skipped for inspection` +
    (APPLY ? '' : '\npass --apply to write'),
)
