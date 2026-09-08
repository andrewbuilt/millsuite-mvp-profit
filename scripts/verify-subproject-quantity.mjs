// ============================================================================
// scripts/verify-subproject-quantity.mjs — the (TYP) × N multiplier (097)
// ============================================================================
//   npx tsx --env-file=.env.local scripts/verify-subproject-quantity.mjs
//
// (the --env-file is only because lib/estimate-lines pulls in lib/supabase,
//  which builds a client at import time; nothing here touches the network)
//
// Guards the two properties that make this safe to ship:
//   1. quantity 1 leaves EVERY existing subproject priced exactly as before —
//      the migration defaults to 1, so it must be provably a no-op.
//   2. cost and hours scale linearly, and margin % does NOT move (it's a
//      percentage; marking up four cabinets is the same rate as one).
//
// Plus the bad inputs: 0 / negative / fractional / NaN must not zero, negate
// or fractionally price a real subproject.
// ============================================================================

import { computeSubprojectRollup } from '../lib/estimate-lines.ts'

const ctx = { shopRate: 80, consumableMarkupPct: 10, profitMarginPct: 35 }

/** One freeform line: price is the price, lands in customCost. */
const line = (over, hours) => ({
  id: 'l1',
  subproject_id: 's1',
  description: 'Base cabinet',
  quantity: 3.5,
  unit: 'lf',
  unit_price_override: over,
  dept_hour_overrides: hours,
  item_id: null,
  finish_specs: [],
  material_description: null,
  spec_label: null,
  sort_order: 0,
})

const LINES = [line(1000, { assembly: 10, finish: 2 })]
const items = new Map()
const opts = new Map()

let bad = 0
const ck = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`)
}

const base = computeSubprojectRollup(LINES, items, opts, ctx)
const omitted = computeSubprojectRollup(LINES, items, opts, ctx) // no qty arg
const one = computeSubprojectRollup(LINES, items, opts, ctx, 1)
const four = computeSubprojectRollup(LINES, items, opts, ctx, 4)

// 1 — the no-op guarantee
ck('omitting quantity === passing 1', omitted.subtotal, one.subtotal)
ck('quantity 1 is unchanged from base', one.subtotal, base.subtotal)
ck('quantity 1 hours unchanged', one.totalHours, base.totalHours)

// 2 — linear scaling
ck('subtotal x4', four.subtotal, base.subtotal * 4)
ck('customCost x4', four.customCost, base.customCost * 4)
ck('total x4', Math.round(four.total), Math.round(base.total * 4))
ck('totalHours x4', four.totalHours, base.totalHours * 4)
ck('assembly hours x4', four.hoursByDept.assembly, base.hoursByDept.assembly * 4)

// margin is a RATE — four cabinets are marked up at the same percentage
ck('margin % does not move', Math.round(four.marginPct), Math.round(base.marginPct))

// install is not part of this rollup at all — that's what keeps it unscaled
ck('installCost stays 0 in the rollup', four.installCost, 0)

// 3 — bad input must never zero, negate or fractionally price a subproject
for (const [label, q] of [['0', 0], ['-4', -4], ['NaN', NaN], ['undefined', undefined]]) {
  const r = computeSubprojectRollup(LINES, items, opts, ctx, q)
  ck(`quantity ${label} falls back to 1`, r.subtotal, base.subtotal)
}
const frac = computeSubprojectRollup(LINES, items, opts, ctx, 2.6)
ck('fractional 2.6 rounds to 3 (no part-cabinets)', frac.subtotal, base.subtotal * 3)

console.log(bad ? `\n${bad} FAILING` : '\nall subproject-quantity cases pass')
process.exit(bad ? 1 : 0)
