// ============================================================================
// verify-payments-board.mjs — the board shows each dollar exactly once.
// ============================================================================
// Run: npx tsx scripts/verify-payments-board.mjs
//
// ⛔ THE COMPLAINT THIS ENCODES. Andrew, looking at September: the grey cards
// summed past $100,000 while the header said RECEIVED $49,075, and every
// fully-paid draw appeared TWICE — once as a grey "paid in full" schedule card
// in the month it was SCHEDULED, once as a green receipt card in the month the
// money LANDED. "I don't want to see both."
//
// Two invariants come out of that, and they are the whole point of this file:
//
//   1. A month's settled cards sum EXACTLY to its Received header. The header
//      is summed from the ledger and the cards are built by attribution, so
//      the two are computed by different code — if they agree, the money is
//      being shown once and in the right month.
//
//   2. Every dollar of the ledger is attributed exactly once. Applied slices
//      plus unapplied slices equal the payment, for every payment.
// ============================================================================

import {
  buildPaymentsView,
  reconcileProject,
  reconcileEverything,
} from '../lib/payment-ledger.ts'

let pass = 0
let fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else {
    fail++
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
  }
}

const draw = (id, label, amount, expectedDate, sortOrder) => ({
  id,
  projectId: 'p1',
  projectName: 'Schiller',
  label,
  amount,
  expectedDate,
  status: 'projected',
  sortOrder,
  createdAt: '2026-09-03',
})
const pay = (id, amount, paymentDate, projectId = 'p1') => ({
  id,
  projectId,
  amount,
  paymentDate,
  method: null,
  reference: null,
  notes: null,
})
const M = (year, month) => ({ year, month })

// ── Schiller, the real job ──────────────────────────────────────────────────
// $49,075 contract, 50/25/25, all three paid — the job that looked like its
// deposit had been deleted.
console.log('\nSchiller: 50/25/25, fully paid')
const schillerDraws = [
  draw('d1', 'Deposit', 24538, '2026-07-15', 0),
  draw('d2', 'Production kickoff', 12269, '2026-08-15', 1),
  draw('d3', 'Final', 12268, '2026-09-15', 2),
]
// ⚠️ The cash landed in SEPTEMBER, months after the first two draws were due.
const schillerPays = [
  pay('e1', 24538, '2026-09-02'),
  pay('e2', 12269, '2026-09-10'),
  pay('e3', 12268, '2026-09-20'),
]
const rec = reconcileProject(schillerDraws, schillerPays, 49075)
check('all three draws are paid', rec.draws.map((d) => d.state), ['paid', 'paid', 'paid'])
check('nothing is unapplied', rec.unapplied.length, 0)
check('no credit', rec.credit, 0)
// Attribution: each payment covered exactly its own draw.
check('deposit was paid by e1', rec.draws[0].applied.map((a) => a.entry.id), ['e1'])
check('kickoff was paid by e2', rec.draws[1].applied.map((a) => a.entry.id), ['e2'])
check('final was paid by e3', rec.draws[2].applied.map((a) => a.entry.id), ['e3'])

const view = buildPaymentsView(rec.draws, schillerPays, [M(2026, 6), M(2026, 7), M(2026, 8)], M(2026, 8))
const [jul, aug, sep] = view.months
// ⛔ THE FIX: the draws were SCHEDULED in July/August but the money LANDED in
// September, so that is where the cards are. July and August are empty.
check('July has no cards', jul.settledCards.length, 0)
check('August has no cards', aug.settledCards.length, 0)
check('September has three', sep.settledCards.length, 3)
check('one card per draw, not two', sep.settledCards.map((c) => c.drawLabel), [
  'Deposit',
  'Production kickoff',
  'Final',
])
check('each says Paid', sep.settledCards.map((c) => c.completesDraw), [true, true, true])
// ⛔ INVARIANT 1. Header is summed from the ledger; cards are built by
// attribution. They must agree.
check(
  'the cards sum to the Received header',
  sep.settledCards.reduce((s, c) => s + c.amount, 0),
  sep.receivedTotal,
)
check('and that is the contract', sep.receivedTotal, 49075)
// Nothing grey is left over.
check('no outstanding draws anywhere', view.months.every((m) => m.outstanding.length === 0), true)
check('nothing overdue', view.overdue.length, 0)
check('nothing undated', view.unscheduled.length, 0)

// ── A payment that spans two draws ──────────────────────────────────────────
console.log('\none cheque covering a draw and a half')
const spanDraws = [draw('s1', 'Deposit', 10000, '2026-09-15', 0), draw('s2', 'Final', 10000, '2026-10-15', 1)]
const spanRec = reconcileProject(spanDraws, [pay('x1', 15000, '2026-09-05')], 20000)
check('deposit is paid', spanRec.draws[0].state, 'paid')
check('final is partial', spanRec.draws[1].state, 'partial')
check('the deposit took 10,000 of it', spanRec.draws[0].applied[0].amount, 10000)
check('the final took the other 5,000', spanRec.draws[1].applied[0].amount, 5000)
// ⛔ INVARIANT 2: the slices reconstruct the payment exactly.
check(
  'the slices sum to the cheque',
  spanRec.draws.flatMap((d) => d.applied).reduce((s, a) => s + a.amount, 0) +
    spanRec.unapplied.reduce((s, u) => s + u.amount, 0),
  15000,
)
const spanView = buildPaymentsView(spanRec.draws, [pay('x1', 15000, '2026-09-05')], [M(2026, 8), M(2026, 9)], M(2026, 8))
check('two cards — one per draw', spanView.months[0].settledCards.length, 2)
check('the month still foots', spanView.months[0].settledCards.reduce((s, c) => s + c.amount, 0), 15000)
// ⚠️ The partial card must NOT claim the draw is paid, and must admit it shows
// a slice of a larger cheque.
const partialCard = spanView.months[0].settledCards.find((c) => c.drawLabel === 'Final')
check('the partial card does not say Paid', partialCard.completesDraw, false)
check('it knows the draw is bigger', partialCard.drawScheduled, 10000)
check('it admits it is part of a payment', partialCard.partialEntry, true)
// And the half-paid draw is STILL a schedule card in its own month.
check('the partial draw is still outstanding in October', spanView.months[1].outstanding.length, 1)
check('for the unpaid half only', spanView.months[1].needed, 5000)

// ── A draw paid across two months ───────────────────────────────────────────
console.log('\none draw, two months of payments')
const twoMonthDraws = [draw('t1', 'Deposit', 10000, '2026-09-15', 0)]
const twoMonthPays = [pay('y1', 4000, '2026-09-20'), pay('y2', 6000, '2026-10-05')]
const tmRec = reconcileProject(twoMonthDraws, twoMonthPays, 10000)
const tmView = buildPaymentsView(tmRec.draws, twoMonthPays, [M(2026, 8), M(2026, 9)], M(2026, 9))
// ⛔ ONE CARD PER MONTH, NOT ONE CARD TOTAL. A single card would put October's
// money in September and break the footing — the exact bug being fixed.
check('September card', tmView.months[0].settledCards.map((c) => c.amount), [4000])
check('October card', tmView.months[1].settledCards.map((c) => c.amount), [6000])
check('September foots', tmView.months[0].receivedTotal, 4000)
check('October foots', tmView.months[1].receivedTotal, 6000)
// The draw IS fully paid, so both cards may say so.
check('the draw is paid', tmRec.draws[0].state, 'paid')

// ── An overpayment ──────────────────────────────────────────────────────────
console.log('\noverpayment keeps its own card')
const overRec = reconcileProject([draw('o1', 'Only draw', 5000, '2026-09-15', 0)], [pay('z1', 5000, '2026-09-01'), pay('z2', 800, '2026-09-02')], 5000)
check('credit is surfaced', overRec.credit, 800)
check('and it is unapplied, not hidden in a draw', overRec.unapplied.map((u) => u.amount), [800])
const overView = buildPaymentsView(
  overRec.draws,
  [pay('z1', 5000, '2026-09-01'), pay('z2', 800, '2026-09-02')],
  [M(2026, 8)],
  M(2026, 8),
  overRec.unapplied.map((u) => ({ ...u, projectId: 'p1', projectName: 'Schiller' })),
)
check('two cards: the draw and the overpayment', overView.months[0].settledCards.length, 2)
check('the overpayment has no draw label', overView.months[0].settledCards.find((c) => c.amount === 800).drawLabel, null)
check('the month still foots', overView.months[0].settledCards.reduce((s, c) => s + c.amount, 0), 5800)

// ── A project with payments but NO draws ────────────────────────────────────
console.log('\npayments on a project with no schedule')
// ⛔ reconcileAll used to iterate the DRAWS, so this project contributed
// nothing and its money vanished from the board entirely.
const noSched = reconcileEverything([], [pay('n1', 9000, '2026-09-08', 'p9')], { p9: 40000 }, { p9: 'Leonard' })
check('no draws', noSched.draws.length, 0)
check('but the money survives', noSched.unapplied.map((u) => u.amount), [9000])
check('with its project name', noSched.unapplied[0].projectName, 'Leonard')
const nsView = buildPaymentsView(noSched.draws, [pay('n1', 9000, '2026-09-08', 'p9')], [M(2026, 8)], M(2026, 8), noSched.unapplied)
check('and it renders', nsView.months[0].settledCards.map((c) => c.amount), [9000])
check('month foots', nsView.months[0].receivedTotal, 9000)

// ── Rounding: the $1 rule still holds ───────────────────────────────────────
console.log('\nthe Murtagh half-dollar')
// Contract $26,227; deposit stored $13,114; client paid the true half.
const murtagh = reconcileProject(
  [draw('m1', 'Deposit', 13114, '2026-09-15', 0), draw('m2', 'Final', 13113, '2026-10-15', 1)],
  [pay('p1', 13113.5, '2026-09-05')],
  26227,
)
check('the deposit counts as paid, not $1 outstanding', murtagh.draws[0].state, 'paid')
const mView = buildPaymentsView(murtagh.draws, [pay('p1', 13113.5, '2026-09-05')], [M(2026, 8)], M(2026, 8))
check('no phantom $1 schedule card', mView.months[0].outstanding.length, 0)
check('one settled card', mView.months[0].settledCards.length, 1)
check('for what actually arrived', mView.months[0].settledCards[0].amount, 13113.5)

// ── The $1 spill ────────────────────────────────────────────────────────────
console.log('\na sub-dollar spill does not become its own card')
// ⛔ MURTAGH, FROM THE REAL DATABASE. The deposit row is $13,113 and the client
// paid $13,114, so a dollar overflowed onto the next draw and rendered as a
// green card reading "$1 of $6,557" — i.e. "the client paid one dollar toward
// the kickoff". Same phantom-$1 card Andrew rejected in 634c0eb, relocated.
const spill = reconcileProject(
  [draw('sp1', 'Deposit', 13113, '2026-05-15', 0), draw('sp2', 'Production kickoff', 6557, '2026-06-15', 1)],
  [pay('m1', 13114, '2026-05-18')],
  19670,
)
check('the dollar does land on the next draw internally', spill.draws[1].applied[0].amount, 1)
const spillView = buildPaymentsView(spill.draws, [pay('m1', 13114, '2026-05-18')], [M(2026, 4)], M(2026, 8))
check('but there is only ONE card', spillView.months[0].settledCards.length, 1)
check('for the deposit', spillView.months[0].settledCards[0].drawLabel, 'Deposit')
// ⛔ AND IT IS NOT DROPPED — the month still foots, which is the whole point.
check('carrying the whole payment', spillView.months[0].settledCards[0].amount, 13114)
check('month foots', spillView.months[0].receivedTotal, 13114)
// ⚠️ A REAL part-payment is NOT a crumb and keeps its own card.
const realPartial = reconcileProject(
  [draw('r1', 'Deposit', 1000, '2026-09-15', 0), draw('r2', 'Final', 1000, '2026-10-15', 1)],
  [pay('r', 1600, '2026-09-05')],
  2000,
)
const rpView = buildPaymentsView(realPartial.draws, [pay('r', 1600, '2026-09-05')], [M(2026, 8)], M(2026, 8))
check('a $600 part-payment still gets its own card', rpView.months[0].settledCards.length, 2)

// ── Ordering ────────────────────────────────────────────────────────────────
console.log('\npayments apply oldest first')
// ⚠️ Entries arriving out of order must not change the attribution — the
// waterfall fills the oldest draw first, so it has to read the oldest payment
// first or "Paid {date}" names the wrong cheque.
const shuffled = reconcileProject(
  [draw('a1', 'Deposit', 1000, '2026-09-15', 0), draw('a2', 'Final', 1000, '2026-10-15', 1)],
  [pay('late', 1000, '2026-10-01'), pay('early', 1000, '2026-09-01')],
  2000,
)
check('the deposit was settled by the EARLY payment', shuffled.draws[0].applied[0].entry.id, 'early')
check('the final by the late one', shuffled.draws[1].applied[0].entry.id, 'late')

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
