// ============================================================================
// verify-sales-goal.mjs — the monthly cash target.
// ============================================================================
// Run: npx tsx scripts/verify-sales-goal.mjs
// No credentials, no network: lib/sales-goal is pure on purpose.
// ============================================================================

import {
  computeGoal,
  deriveMonthlyFixed,
  goalProgress,
  suggestMaterialPct,
  MAX_COMBINED_PCT,
} from '../lib/sales-goal.ts'

let pass = 0
let fail = 0

function check(name, got, want) {
  const ok =
    typeof got === 'number' && typeof want === 'number'
      ? Math.abs(got - want) < 0.02
      : got === want
  if (ok) pass++
  else {
    fail++
    console.log(`  ❌ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}

// ── The arithmetic, done by hand ───────────────────────────────────────────
// $40,000/mo fixed, 30% material, 20% profit ⇒ divisor 0.5 ⇒ $80,000.
{
  const g = computeGoal({ monthlyFixed: 40000, materialPct: 30, profitPct: 20 })
  check('status', g.status, 'ok')
  check('goal', g.amount, 80000)

  // Sanity: at that revenue the split actually covers the fixed cost.
  const material = 80000 * 0.3
  const profit = 80000 * 0.2
  check('revenue − material − profit = fixed', 80000 - material - profit, 40000)
}

// A second, less round one: $18,750 fixed, 32% / 18% ⇒ divisor 0.5 ⇒ $37,500.
{
  const g = computeGoal({ monthlyFixed: 18750, materialPct: 32, profitPct: 18 })
  check('goal 2', g.amount, 37500)
}

// ── ⛔ The divisor guard ───────────────────────────────────────────────────
{
  check('100% is impossible', computeGoal({ monthlyFixed: 20000, materialPct: 60, profitPct: 40 }).status, 'impossible')
  check('over 100% is impossible', computeGoal({ monthlyFixed: 20000, materialPct: 80, profitPct: 40 }).status, 'impossible')
  check('at the cap is impossible', computeGoal({ monthlyFixed: 20000, materialPct: 70, profitPct: 20 }).status, 'impossible')
  check('just under the cap is fine', computeGoal({ monthlyFixed: 20000, materialPct: 70, profitPct: 19.9 }).status, 'ok')
  // Negative gets its OWN state — see the block further down.
  check('negative is not "impossible"', computeGoal({ monthlyFixed: 20000, materialPct: -5, profitPct: 20 }).status, 'negative')

  // The thing the guard exists to prevent ever reaching a screen.
  const g = computeGoal({ monthlyFixed: 20000, materialPct: 60, profitPct: 40 })
  if (!Number.isFinite(g.amount)) {
    fail++
    console.log('  ❌ a non-finite amount escaped the guard')
  } else pass++
  check('cap is where the comment says', MAX_COMBINED_PCT, 90)
}

// ── Unset vs zero ─────────────────────────────────────────────────────────
// ⛔ 0% material is a REAL answer (a shop that buys nothing). Only null is
// "not set up" — testing falsiness here would treat a legitimate 0 as unset.
{
  check('null material ⇒ unset', computeGoal({ monthlyFixed: 40000, materialPct: null, profitPct: 20 }).status, 'unset')
  check('null profit ⇒ unset', computeGoal({ monthlyFixed: 40000, materialPct: 30, profitPct: null }).status, 'unset')
  check('both null ⇒ unset', computeGoal({ monthlyFixed: 40000, materialPct: null, profitPct: null }).status, 'unset')

  const zeros = computeGoal({ monthlyFixed: 40000, materialPct: 0, profitPct: 0 })
  check('0/0 is set up, not unset', zeros.status, 'ok')
  check('0/0 ⇒ goal is just the fixed cost', zeros.amount, 40000)
}

// ── No fixed costs ────────────────────────────────────────────────────────
{
  check('no overhead ⇒ no_fixed', computeGoal({ monthlyFixed: 0, materialPct: 30, profitPct: 20 }).status, 'no_fixed')
  check('and no bogus $0 target', computeGoal({ monthlyFixed: 0, materialPct: 30, profitPct: 20 }).amount, 0)
}

// ── deriveMonthlyFixed ────────────────────────────────────────────────────
{
  check('annual ÷ 12', deriveMonthlyFixed(120000, 360000), 40000)
  check('nothing set up ⇒ 0', deriveMonthlyFixed(0, 0), 0)
  check('overhead only', deriveMonthlyFixed(60000, 0), 5000)
}

// ── suggestMaterialPct — weighted by price ────────────────────────────────
{
  check('no jobs ⇒ null', suggestMaterialPct([]), null)
  check('zero-price jobs ⇒ null', suggestMaterialPct([{ price: 0, materialCost: 500 }]), null)

  // One job: 3,000 of 10,000 = 30%.
  check('single job', suggestMaterialPct([{ price: 10000, materialCost: 3000 }]), 30)

  // ⛔ WEIGHTED, NOT A MEAN OF PERCENTAGES. A $200k job at 30% next to a $5k
  // job at 80%: the weighted answer is 31.2%, the naive average is 55% —
  // which would tell a shop to price for a cost structure it doesn't have.
  const jobs = [
    { price: 200000, materialCost: 60000 },
    { price: 5000, materialCost: 4000 },
  ]
  check('weighted by price', suggestMaterialPct(jobs), +(((64000 / 205000) * 100).toFixed(1)))
  const naive = (30 + 80) / 2
  if (Math.abs(suggestMaterialPct(jobs) - naive) < 1) {
    fail++
    console.log('  ❌ suggestion matches the naive mean — weighting is not happening')
  } else pass++
}

// ── ⛔ Consumables, DERIVED from material × markup ─────────────────────────
// Andrew's call 2026-09-12. The app prices a job four ways; the goal split
// was three. No fourth setting — consumables already ride on material
// (`consumablesCost = materialCost × markup`), so the goal does the same.
{
  // STATE's worked example: $40k fixed, 30% material, 20% profit ⇒ $80,000
  // with no consumables. A 7-point consumable share ⇒ ~$93,023. Seven points
  // of a 30% material share is a 23.333% markup.
  const without = computeGoal({ monthlyFixed: 40000, materialPct: 30, profitPct: 20 })
  check('no markup ⇒ the old number', without.amount, 80000)
  check('and no consumables line', without.consumablesPct, 0)

  const with7 = computeGoal({
    monthlyFixed: 40000,
    materialPct: 30,
    profitPct: 20,
    consumableMarkupPct: 23.3333,
  })
  check('7 points of consumables', with7.consumablesPct, 7)
  check('the worked example reproduces', with7.amount, 93023.26)

  // ⛔ The acceptance criterion from the spec: 0 markup must not move a goal
  // that was already set up.
  const zero = computeGoal({
    monthlyFixed: 40000, materialPct: 30, profitPct: 20, consumableMarkupPct: 0,
  })
  check('0% markup is unchanged', zero.amount, 80000)

  // A missing markup defaults to 0, NOT to pricing's 10 — a caller that
  // forgets must not silently inflate the target.
  check('omitted markup ⇒ unchanged', without.amount, zero.amount)

  // The app's default markup is 10%: 30% material ⇒ 3 points.
  const ten = computeGoal({
    monthlyFixed: 40000, materialPct: 30, profitPct: 20, consumableMarkupPct: 10,
  })
  check('10% markup ⇒ 3 points', ten.consumablesPct, 3)
  check('10% markup goal', ten.amount, +(40000 / 0.47).toFixed(2))

  // Consumables ride on MATERIAL, so 0% material means 0 consumables even
  // with a markup set.
  const noMaterial = computeGoal({
    monthlyFixed: 40000, materialPct: 0, profitPct: 20, consumableMarkupPct: 25,
  })
  check('no material ⇒ no consumables', noMaterial.consumablesPct, 0)
  check('no material goal', noMaterial.amount, 50000)
}

// ── ⛔ The cap must include the DERIVED points ─────────────────────────────
// Otherwise three inputs that each look reasonable can drive the divisor to
// zero through the back door.
{
  // 60% material + 20% profit = 80, under the cap. But a 40% markup adds 24
  // more points ⇒ 104 total.
  const sneaky = computeGoal({
    monthlyFixed: 40000, materialPct: 60, profitPct: 20, consumableMarkupPct: 40,
  })
  check('derived points count toward the cap', sneaky.status, 'impossible')

  // Without the markup the very same inputs are fine — proving the guard is
  // reacting to the derivation, not to the raw inputs.
  const fine = computeGoal({ monthlyFixed: 40000, materialPct: 60, profitPct: 20 })
  check('same inputs, no markup ⇒ ok', fine.status, 'ok')
  if (sneaky.status === fine.status) {
    fail++
    console.log('  ❌ the cap ignores derived consumables — no teeth')
  } else pass++
}

// ── ⛔ The blind viewer ────────────────────────────────────────────────────
// Team comp is owner-only in the database, so a manager's derived fixed cost
// is overhead ALONE — a plausible, smaller, entirely wrong number. Measured
// at 4× on a test org before this guard existed.
{
  const owner = computeGoal({ monthlyFixed: 40000, materialPct: 30, profitPct: 20, fixedIsKnown: true })
  const admin = computeGoal({ monthlyFixed: 10000, materialPct: 30, profitPct: 20, fixedIsKnown: false })
  check('owner sees the goal', owner.amount, 80000)
  check('a blind viewer gets no number', admin.status, 'blind')
  check('and certainly not a small one', admin.amount, 0)

  // Without the flag, the old behaviour — which is what we must not ship.
  const unguarded = computeGoal({ monthlyFixed: 10000, materialPct: 30, profitPct: 20 })
  check('unflagged still computes (default true)', unguarded.status, 'ok')
  if (unguarded.amount === owner.amount) {
    fail++
    console.log('  ❌ the blind case is indistinguishable — no teeth')
  } else pass++

  // An override makes it shareable: the number no longer depends on payroll.
  const shared = computeGoal({ monthlyFixed: 40000, materialPct: 30, profitPct: 20, fixedIsKnown: true })
  check('a pinned override is shareable', shared.amount, 80000)
}

// ── Negative percentages get their own state ──────────────────────────────
// The "impossible" copy computes a residual and calls it too small; for a
// negative that residual is over 100%, so the sentence contradicted itself.
{
  check('negative material', computeGoal({ monthlyFixed: 20000, materialPct: -5, profitPct: 20 }).status, 'negative')
  check('negative profit', computeGoal({ monthlyFixed: 20000, materialPct: 30, profitPct: -1 }).status, 'negative')
}

// ── A suggestion the goal can't use is no suggestion ──────────────────────
{
  check('bills over the contract ⇒ null', suggestMaterialPct([{ price: 10000, materialCost: 12000 }]), null)
  check('at the cap ⇒ null', suggestMaterialPct([{ price: 100, materialCost: 90 }]), null)
  check('just under the cap is fine', suggestMaterialPct([{ price: 100, materialCost: 89 }]), 89)
}

// ── goalProgress ──────────────────────────────────────────────────────────
{
  const half = goalProgress(40000, 80000)
  check('half way', half.pct, 50)
  check('half way tone', half.tone, 'red')
  check('70% is amber', goalProgress(56000, 80000).tone, 'amber')
  check('100% is green', goalProgress(80000, 80000).tone, 'green')

  const over = goalProgress(90000, 80000)
  check('over goal keeps the real pct', over.pct, 112.5)
  check('but the bar stops at 100', over.width, 100)
  check('no goal ⇒ no divide by zero', goalProgress(5000, 0).pct, 0)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
