// ============================================================================
// scripts/verify-payment-ledger.mjs — the draws must always add up
// ============================================================================
//   npx tsx scripts/verify-payment-ledger.mjs        (no credentials needed)
//
// Andrew's requirement, verbatim: "we need all of the draw payments to add up
// to the total. we need flexibility in case someone pays out of order. it
// should just log the payment and adjust the final payments."
//
// So the invariant under test is one line, and almost every case below is a
// different way of trying to break it:
//
//     received + sum(outstanding) == contract total        (always)
//
// The cases that matter are the ones Built OS got wrong: someone pays an
// amount nobody projected, pays early, pays twice, overpays, or a change order
// moves the total after the schedule was authored.
// ============================================================================

import {
  reconcileProject,
  reconcileAll,
  defaultDrawDates,
  buildPaymentsView,
} from '../lib/payment-ledger.ts'

let bad = 0
const ck = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`)
}

const draw = (id, amount) => ({
  id, projectId: 'p1', projectName: 'Kennedy', clientName: 'K', stage: 'production',
  label: id, amount, status: 'projected', expectedDate: null, receivedDate: null,
})
const pay = (amount, paymentDate = '2026-09-01') => ({
  id: `pay-${amount}-${paymentDate}`, projectId: 'p1', amount, paymentDate,
  method: null, reference: null, notes: null,
})

/** THE invariant. Everything else is detail. */
function checkAddsUp(label, r) {
  const sum = r.received + r.draws.reduce((s, d) => s + d.outstanding, 0)
  // Credit is money beyond the contract; it isn't owed to the schedule.
  const expected = r.contractTotal + r.credit
  const ok = Math.abs(sum - expected) < 0.01
  if (!ok) {
    bad++
    console.log(`FAIL ${label} — received ${r.received} + outstanding ${sum - r.received} != ${expected}`)
  } else {
    console.log(`ok   ${label} adds up (${r.received} in, ${(sum - r.received).toFixed(2)} to go)`)
  }
}

// 50 / 25 / 25 on a $100,000 job — the ordinary shape.
const SCHEDULE = [draw('deposit', 50000), draw('rough', 25000), draw('final', 25000)]
const TOTAL = 100000

// ── Nothing paid ───────────────────────────────────────────────────────────
let r = reconcileProject(SCHEDULE, [], TOTAL)
ck('nothing paid: received 0', r.received, 0)
ck('nothing paid: remaining is the whole contract', r.remaining, TOTAL)
ck('nothing paid: every draw open', r.draws.map((d) => d.state), ['open', 'open', 'open'])
checkAddsUp('nothing paid', r)

// ── Exact payment ──────────────────────────────────────────────────────────
r = reconcileProject(SCHEDULE, [pay(50000)], TOTAL)
ck('exact deposit: first draw paid', r.draws.map((d) => d.state), ['paid', 'open', 'open'])
ck('exact deposit: remaining', r.remaining, 50000)
checkAddsUp('exact deposit', r)

// ── ⛔ THE BUILT OS CASE: they paid something nobody projected ──────────────
r = reconcileProject(SCHEDULE, [pay(37500)], TOTAL)
ck('odd amount: deposit is PARTIAL', r.draws[0].state, 'partial')
ck('odd amount: deposit covered 37,500', r.draws[0].covered, 37500)
ck('odd amount: 12,500 still owed on it', r.draws[0].outstanding, 12500)
ck('odd amount: later draws untouched', r.draws.map((d) => d.scheduled), [50000, 25000, 25000])
checkAddsUp('odd amount', r)

// Two odd payments that together overshoot the first draw.
r = reconcileProject(SCHEDULE, [pay(37500), pay(20000, '2026-09-15')], TOTAL)
ck('overflow: deposit paid, rough partial', r.draws.map((d) => d.state), ['paid', 'partial', 'open'])
ck('overflow: rough covered 7,500', r.draws[1].covered, 7500)
checkAddsUp('two odd payments', r)

// ── Out of order: they paid the final draw early ───────────────────────────
// Waterfall applies it to the deposit — a known, accepted consequence. What
// must NOT break is the total.
r = reconcileProject(SCHEDULE, [pay(25000)], TOTAL)
ck('out of order: still only 25,000 in', r.received, 25000)
checkAddsUp('paid out of order', r)

// ── ⛔ CHANGE ORDER: the total moves after the schedule was authored ────────
// This is the case that is silently broken today — nothing updates draws when
// a CO lands. The FINAL draw must absorb it (Andrew's call).
r = reconcileProject(SCHEDULE, [pay(50000)], 120000)
ck('CO +20k: final draw absorbs it', r.draws[2].scheduled, 45000)
ck('CO +20k: earlier draws untouched', r.draws.slice(0, 2).map((d) => d.scheduled), [50000, 25000])
ck('CO +20k: drift is reported, not hidden', r.drift, -20000)
ck('CO +20k: remaining', r.remaining, 70000)
checkAddsUp('change order raises the total', r)

// A CO that REDUCES the total shrinks from the end, and may not touch a draw
// that's already been paid.
r = reconcileProject(SCHEDULE, [pay(50000)], 80000)
ck('CO −20k: final draw shrinks to 5,000', r.draws[2].scheduled, 5000)
ck('CO −20k: the PAID deposit is untouched', r.draws[0].scheduled, 50000)
ck('CO −20k: paid deposit stays paid', r.draws[0].state, 'paid')
checkAddsUp('change order lowers the total', r)

// A reduction big enough to eat past the last draw walks backwards.
r = reconcileProject(SCHEDULE, [pay(50000)], 60000)
ck('big cut: last draw to zero', r.draws[2].scheduled, 0)
ck('big cut: middle draw absorbs the rest', r.draws[1].scheduled, 10000)
ck('big cut: paid deposit still untouched', r.draws[0].scheduled, 50000)
checkAddsUp('big reduction', r)

// ── Overpayment ────────────────────────────────────────────────────────────
r = reconcileProject(SCHEDULE, [pay(100000), pay(5000, '2026-10-01')], TOTAL)
ck('overpaid: every draw paid', r.draws.map((d) => d.state), ['paid', 'paid', 'paid'])
ck('overpaid: nothing outstanding', r.draws.map((d) => d.outstanding), [0, 0, 0])
ck('overpaid: surfaced as credit, not a negative draw', r.credit, 5000)
ck('overpaid: remaining clamps at 0', r.remaining, 0)
checkAddsUp('overpaid', r)

// ── Refunds / corrections (negative entries) ───────────────────────────────
r = reconcileProject(SCHEDULE, [pay(50000), pay(-10000, '2026-10-01')], TOTAL)
ck('refund: nets to 40,000 received', r.received, 40000)
ck('refund: deposit falls back to partial', r.draws[0].state, 'partial')
checkAddsUp('refund', r)

// ── Cents ──────────────────────────────────────────────────────────────────
r = reconcileProject([draw('a', 3333), draw('b', 3333), draw('c', 3334)], [pay(1234.56)], 10000)
ck('cents: received to the penny', r.received, 1234.56)
checkAddsUp('a payment with cents', r)

r = reconcileProject(SCHEDULE, [pay(0.01), pay(0.02, '2026-09-02')], TOTAL)
ck('tiny payments sum exactly', r.received, 0.03)
checkAddsUp('tiny payments', r)

// ── Degenerate shapes ──────────────────────────────────────────────────────
r = reconcileProject([], [pay(5000)], TOTAL)
ck('no schedule is flagged, not rendered as $0', r.empty, true)
ck('no schedule still counts the money', r.received, 5000)

r = reconcileProject([draw('only', 100000)], [pay(40000)], TOTAL)
ck('single draw: partial', r.draws[0].state, 'partial')
checkAddsUp('single draw', r)

r = reconcileProject(SCHEDULE, [], 0)
ck('zero-value contract does not explode', r.remaining, 0)

// ── Fuzz: the invariant must hold for anything ─────────────────────────────
// Deterministic pseudo-random (no Math.random — reproducible failures).
let seed = 12345
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
let fuzzBad = 0
for (let i = 0; i < 500; i++) {
  const n = 1 + Math.floor(rnd() * 5)
  const ds = Array.from({ length: n }, (_, j) => draw(`d${j}`, Math.round(rnd() * 50000)))
  const ps = Array.from({ length: Math.floor(rnd() * 4) }, (_, j) =>
    pay(Math.round(rnd() * 60000 * 100) / 100, `2026-09-0${(j % 9) + 1}`),
  )
  const total = Math.round(rnd() * 150000)
  const rr = reconcileProject(ds, ps, total)
  const sum = rr.received + rr.draws.reduce((s, d) => s + d.outstanding, 0)
  if (Math.abs(sum - (rr.contractTotal + rr.credit)) > 0.01) {
    fuzzBad++
    if (fuzzBad <= 3) {
      console.log(`FAIL fuzz #${i}: total=${total} draws=${ds.map((d) => d.amount)} pays=${ps.map((p) => p.amount)}`)
      console.log(`     received=${rr.received} outstanding=${sum - rr.received} credit=${rr.credit}`)
    }
  }
  // No draw may ever go negative, and none may be scheduled below what's paid.
  for (const d of rr.draws) {
    if (d.scheduled < -0.01 || d.outstanding < -0.01) {
      fuzzBad++
      if (fuzzBad <= 3) console.log(`FAIL fuzz #${i}: negative draw ${JSON.stringify(d)}`)
    }
  }
}
bad += fuzzBad
ck('500 random schedules all add up, no negative draws', fuzzBad, 0)

// ── Default dates: one month apart (Andrew's call, not completion-derived) ──
ck(
  'three draws, one month apart',
  defaultDrawDates(new Date(2026, 8, 15), 3),
  ['2026-09-15', '2026-10-15', '2026-11-15'],
)
ck(
  'starting on the 31st clamps instead of skipping February',
  defaultDrawDates(new Date(2026, 0, 31), 3),
  ['2026-01-31', '2026-02-28', '2026-03-31'],
)
ck('year rollover', defaultDrawDates(new Date(2026, 11, 1), 3), ['2026-12-01', '2027-01-01', '2027-02-01'])
ck('zero draws', defaultDrawDates(new Date(2026, 0, 1), 0), [])

// ── The board: derived draws + receipts, bucketed by month ─────────────────
// "Received this month" is now the sum of LEDGER ENTRIES dated that month, NOT
// a status flag on a draw. These cases pin that, plus the two trays.
const MONTHS = [
  { year: 2026, month: 8 },  // Sep
  { year: 2026, month: 9 },  // Oct
  { year: 2026, month: 10 }, // Nov
]
const TODAY = { year: 2026, month: 8 }
const dated = (id, amount, expectedDate) => ({ ...draw(id, amount), expectedDate })

// $100k job: 50k Sep, 25k Oct, 25k no date. 30k paid in September.
const BOARD_DRAWS = [dated('a', 50000, '2026-09-10'), dated('b', 25000, '2026-10-05'), dated('c', 25000, null)]
const BOARD_PAYS = [pay(30000, '2026-09-06')]
const rec = reconcileProject(BOARD_DRAWS, BOARD_PAYS, 100000)
const view = buildPaymentsView(rec.draws, BOARD_PAYS, MONTHS, TODAY)

ck('needed in Sep is what REMAINS on that draw, not its face value', view.months[0].needed, 20000)
ck('received in Sep comes from the LEDGER', view.months[0].receivedTotal, 30000)
ck('the receipt is listed', view.months[0].received.map((e) => e.amount), [30000])
ck('Oct needs its full draw', view.months[1].needed, 25000)
ck('the undated draw sits in the tray', view.unscheduled.map((d) => d.row.id), ['c'])

// A fully-paid draw drops off the board — its cash shows as a receipt instead.
const paidOff = reconcileProject([dated('x', 10000, '2026-09-10')], [pay(10000, '2026-09-11')], 10000)
const v2 = buildPaymentsView(paidOff.draws, [pay(10000, '2026-09-11')], MONTHS, TODAY)
ck('a fully-paid draw is not still "needed"', v2.months[0].needed, 0)
ck('and is not rendered as an outstanding card', v2.months[0].outstanding.length, 0)
ck('but its money is on the board', v2.months[0].receivedTotal, 10000)

// Past due is relative to TODAY, not the window.
const lateDraw = reconcileProject([dated('old', 5000, '2026-07-01')], [], 5000)
const v3 = buildPaymentsView(lateDraw.draws, [], MONTHS, TODAY)
ck('a July draw is past due in September', v3.overdue.map((d) => d.row.id), ['old'])
const PAGED = [{ year: 2026, month: 9 }, { year: 2026, month: 10 }, { year: 2026, month: 11 }]
const v4 = buildPaymentsView(rec.draws, BOARD_PAYS, PAGED, TODAY)
ck('paging forward does NOT make this month past due', v4.overdue.length, 0)

// ── ⛔ THE MURTAGH BAR REGRESSION (live bug, 2026-09-11) ────────────────────
// Contract $26,227 — an ODD number. Half is $13,113.50, but the deposit draw
// was stored ROUNDED to $13,114 when the schedule was saved. The client paid
// the true half. That 50c gap is a rounding artifact, not a debt — and at a
// $0.005 tolerance it came back `partial` and rendered as a phantom card
// reading "$1" with the badge "$13,114 of $13,114 in".
const MUR = [draw('Deposit', 13114), draw('Production kickoff', 6557), draw('Final', 6556)]
const mur = reconcileProject(MUR, [pay(13113.5, '2026-05-18')], 26227)
ck('sub-dollar rounding residue counts as PAID, not a $1 partial', mur.draws[0].state, 'paid')
ck('the phantom never reaches the board', buildPaymentsView(mur.draws, [], MONTHS, TODAY).months[0].outstanding.length, 0)
// A real part-payment must still read partial — the tolerance is a dollar,
// not a licence to round away actual debt.
const real = reconcileProject(MUR, [pay(10000, '2026-05-18')], 26227)
ck('a genuine partial payment is still partial', real.draws[0].state, 'partial')
ck('and still owes the balance', real.draws[0].outstanding, 3114)

// ── ⛔ ORDER INDEPENDENCE — the "it changes when I move the card" bug ───────
// The waterfall must follow the AUTHORED schedule. Dragging a card changes
// `expectedDate`, and that must NOT change which draw a payment settled.
// ⛔ Goes through reconcileAll, which is where the SORT lives — that's the
// code that was ordering by expectedDate. Testing reconcileProject alone would
// pass trivially, because it takes the array already ordered.
const ordered = (o0, o1, o2) => [
  { ...draw('Deposit', 13114), sortOrder: 0, createdAt: '2026-01-01', expectedDate: o0 },
  { ...draw('Production kickoff', 6557), sortOrder: 1, createdAt: '2026-01-02', expectedDate: o1 },
  { ...draw('Final', 6556), sortOrder: 2, createdAt: '2026-01-03', expectedDate: o2 },
]
const PAID = [pay(13113.5, '2026-05-18')]
const TOT = { p1: 26227 }

const natural = reconcileAll(ordered('2026-09-01', '2026-10-01', '2026-11-01'), PAID, TOT)
// The deposit dragged to LAST by date, and the array handed over shuffled —
// exactly what the board does after a drag.
const dragged = reconcileAll(
  [...ordered('2026-12-01', '2026-09-01', '2026-09-01')].reverse(),
  PAID,
  TOT,
)
const key = (list) =>
  list.map((d) => `${d.row.label}:${d.state}:${d.outstanding}`).sort()

ck('moving a card does not change which draw is paid', key(dragged), key(natural))
ck(
  'the deposit stays the settled one no matter where it sits',
  natural.find((d) => d.row.label === 'Deposit').state,
  'paid',
)
ck(
  'even after being dragged to December',
  dragged.find((d) => d.row.label === 'Deposit').state,
  'paid',
)
// A row with no order:N must sort LAST, never hijack the deposit slot.
const unlabelled = reconcileAll(
  [
    { ...draw('Mystery', 5000), sortOrder: Number.MAX_SAFE_INTEGER, createdAt: null, expectedDate: '2026-01-01' },
    ...ordered('2026-09-01', '2026-10-01', '2026-11-01'),
  ],
  PAID,
  { p1: 31227 },
)
ck(
  'an unordered row sorts last, not first',
  unlabelled.find((d) => d.row.label === 'Deposit').state,
  'paid',
)

console.log(bad ? `\n${bad} FAILING` : '\nall payment-ledger cases pass')
process.exit(bad ? 1 : 0)
