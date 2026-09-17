// ============================================================================
// verify-drift.mjs — stored draws vs the contract, and how it's reported.
// ============================================================================
// Run: npx tsx scripts/verify-drift.mjs   (no DB, no network)
//
// ⛔ WHY. Drift is a number that is WRONG IN TWO OPPOSITE DIRECTIONS if the
// caller isn't careful, and neither failure raises anything:
//
//   1. A project with NO CONTRACT VALUE arrives with contractTotal = 0
//      (`loadOrgPayments` builds totals with `Number(bid_total) || 0`), so
//      `storedSum - 0` reports the ENTIRE SCHEDULE as drift. UT - Public Arts
//      on prod would read "$27,425 over the contract" when the truth is that
//      nobody recorded a contract. That blames the schedule for a missing
//      project total.
//   2. A project with NO DRAWS has storedSum = 0, so the arithmetic reports its
//      whole contract as drift — putting every un-scheduled job in the drift
//      tray as well as the "No payment schedule" tray, with a scarier number.
//      ~$600k of contracts are in that state.
//
// ⚠️ Every check below was confirmed to FAIL when the thing it guards was
// deliberately broken. A guard that has never gone red is not a guard.
// ============================================================================

import {
  DRIFT_EPS,
  driftsWorthShowing,
  reconcileEverything,
  reconcileProject,
} from '../lib/payment-ledger.ts'
import fs from 'fs'
import path from 'path'

let pass = 0
const fails = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b, eps = 0.005) => Math.abs(a - b) < eps

const draw = (projectId, projectName, id, amount, order) => ({
  id,
  projectId,
  projectName,
  clientName: null,
  stage: 'sold',
  label: `Draw ${order}`,
  amount,
  expectedDate: null,
  status: 'projected',
  sortOrder: order,
  createdAt: '2026-01-01',
})

// ── 1. THE ARITHMETIC ────────────────────────────────────────────────────────
{
  const r = reconcileProject(
    [draw('p1', 'Towers', 'a', 100_000, 0), draw('p1', 'Towers', 'b', 108_136, 1)],
    [],
    205_662,
  )
  check('drift = storedSum − contract', near(r.drift, 2474), `${r.drift}`)
  check('storedSum is exposed, not reconstructed', near(r.storedSum, 208_136), `${r.storedSum}`)
  check('a schedule that foots has no drift',
    near(reconcileProject([draw('p', 'X', 'a', 500, 0)], [], 500).drift, 0))
  const under = reconcileProject([draw('p', 'X', 'a', 400, 0)], [], 500)
  check('draws short of contract drift NEGATIVE', under.drift < 0, `${under.drift}`)
}

// ── 2. ⛔ NO DRAWS IS NOT DRIFT ──────────────────────────────────────────────
// The "No payment schedule" tray owns these. If they leak in here they appear
// twice, the second time reported as a huge mismatch.
{
  const { driftByProject } = reconcileEverything(
    [],
    [{ id: 'e1', projectId: 'ghost', amount: 5_000, paymentDate: '2026-02-01' }],
    { ghost: 80_000 },
    { ghost: 'Leonard' },
  )
  check('⛔ a project with NO draws is absent from driftByProject',
    driftByProject.length === 0, JSON.stringify(driftByProject))
}

// ── 3. ⛔ NO CONTRACT VALUE IS NOT "ZERO DRIFT" AND NOT "HUGE DRIFT" ─────────
{
  const { driftByProject } = reconcileEverything(
    [draw('ut', 'UT - Public Arts', 'a', 27_425, 0)],
    [],
    { ut: 0 }, // exactly what `Number(bid_total) || 0` produces
  )
  const ut = driftByProject.find((d) => d.projectId === 'ut')
  check('the project is present', !!ut)
  check('⛔ contractKnown is FALSE when the contract is 0', ut && ut.contractKnown === false)
  check('its storedSum is still reported', ut && near(ut.storedSum, 27_425))
  // It must be SHOWN — a missing contract is a real problem — but shown as a
  // missing contract, which is the UI's job. The flag is how it knows.
  const shown = driftsWorthShowing(driftByProject)
  check('an unknown contract IS worth showing', shown.length === 1)
  check('⛔ and it sorts FIRST, ahead of mere dollar gaps', shown[0].projectId === 'ut')
}

// ── 4. A GENUINELY BALANCED SCHEDULE IS NOT SHOWN ───────────────────────────
{
  const { driftByProject } = reconcileEverything(
    [draw('ok', 'Schiller', 'a', 24_537.5, 0), draw('ok', 'Schiller', 'b', 24_537.5, 1)],
    [],
    { ok: 49_075 },
  )
  check('a footing schedule is tracked', driftByProject.length === 1)
  check('…but not surfaced', driftsWorthShowing(driftByProject).length === 0)
}

// ── 5. ⚠️ THE $1 ROUNDING ERA DOESN'T SHOUT ─────────────────────────────────
// Every generated schedule used to be $1 off. A tray that flags $1 is a tray
// people learn to close.
{
  const { driftByProject } = reconcileEverything(
    [draw('r', 'Hunt', 'a', 10_000.5, 0)],
    [],
    { r: 10_000 },
  )
  check('a sub-$1 gap is below the threshold', Math.abs(driftByProject[0].drift) < DRIFT_EPS)
  check('…and is not surfaced', driftsWorthShowing(driftByProject).length === 0)
  const { driftByProject: big } = reconcileEverything(
    [draw('r', 'Hunt', 'a', 10_100, 0)],
    [],
    { r: 10_000 },
  )
  check('a $100 gap IS surfaced', driftsWorthShowing(big).length === 1)
}

// ── 6. ORDERING PUTS THE BIGGEST MONEY FIRST ────────────────────────────────
{
  const rows = [
    draw('small', 'Small', 'a', 1_200, 0),
    draw('big', 'Big', 'b', 50_000, 0),
  ]
  const { driftByProject } = reconcileEverything(rows, [], { small: 1_000, big: 30_000 })
  const shown = driftsWorthShowing(driftByProject)
  check('larger gaps sort first', shown[0].projectId === 'big', shown.map((d) => d.projectId).join(','))
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. THE UI GUARD — both surfaces must branch on contractKnown.
// ═════════════════════════════════════════════════════════════════════════════
const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const board = strip(read('app/(app)/payments/page.tsx'))
const ledger = strip(read('components/project/ProjectPaymentLedger.tsx'))

check('the board asks the lib which drifts are worth showing',
  board.includes('driftsWorthShowing(driftByProject)'))
check('⛔ the board branches on contractKnown', /!d\.contractKnown\s*\?/.test(board))
check('the board names the no-contract case', board.includes('No contract value'))
check('the board links to the project, it does not offer to fix it',
  board.includes('href={`/projects/${d.projectId}`}') && !board.includes('Fix schedule'))

check('⛔ the project ledger branches on a missing contract',
  /contractTotal\s*<=\s*0\s*\?/.test(ledger))
check('the project ledger uses the shared threshold', ledger.includes('DRIFT_EPS'))
check('⛔ it prints the real stored sum, not contractTotal + drift',
  ledger.includes('money(recon.storedSum)') && !ledger.includes('contractTotal + recon.drift'))

console.log('\n══ drift ══\n')
console.log(`  ${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`)
if (fails.length) {
  for (const f of fails) console.log(`   ⛔ ${f}`)
  console.log('')
  process.exit(1)
}
console.log('')
