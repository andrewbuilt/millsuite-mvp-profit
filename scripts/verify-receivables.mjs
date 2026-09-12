// ============================================================================
// verify-receivables.mjs — pins the three bugs the old Receivables card had.
// ============================================================================
// Run: npx tsx scripts/verify-receivables.mjs
// (tsx, not node — it imports a .ts file. Plain node throws ERR_UNKNOWN_FILE_EXTENSION.)
//
// No credentials, no network: lib/receivables is pure on purpose.
// ============================================================================

import { buildReceivables, localToday } from '../lib/receivables.ts'

let pass = 0
let fail = 0

function check(name, got, want) {
  const ok = Math.abs(got - want) < 0.005
  if (ok) {
    pass++
  } else {
    fail++
    console.log(`  ❌ ${name}: got ${got}, want ${want}`)
  }
}

const TODAY = '2026-09-12'

// ── Bug 1: QuickBooks mode leaves amount_received at 0 forever ──────────────
// Built's real shape: a $26,227 contract invoice, $13,114 actually received
// and sitting in project_payments, amount_received never written because the
// org is on QB. The old card called the whole $26,227 receivable.
{
  const invoices = [
    { id: 'i1', projectId: 'p1', dueDate: '2026-09-30', total: 26227, amountReceived: 0, open: true },
  ]
  const ledger = new Map([['p1', 13114]])

  const withLedger = buildReceivables(invoices, ledger, TODAY)
  check('QB: outstanding is net of the ledger', withLedger.outstanding, 13113)

  const blind = buildReceivables(invoices, new Map(), TODAY)
  check('QB: ledger-blind would have said', blind.outstanding, 26227)
  if (blind.outstanding === withLedger.outstanding) {
    fail++
    console.log('  ❌ the ledger made no difference — the test has no teeth')
  } else {
    pass++
  }
}

// ── MAX, not sum: internal mode records the same dollar in both places ──────
{
  const invoices = [
    { id: 'i1', projectId: 'p1', dueDate: '2026-09-30', total: 10000, amountReceived: 4000, open: true },
  ]
  // The same $4,000, also logged in the ledger.
  const out = buildReceivables(invoices, new Map([['p1', 4000]]), TODAY)
  check('internal: $4k counted once, not twice', out.outstanding, 6000)

  // Ledger ahead of the invoice column — the ledger wins.
  const ahead = buildReceivables(invoices, new Map([['p1', 9000]]), TODAY)
  check('ledger ahead of the invoice wins', ahead.outstanding, 1000)
}

// ── Bug 2: a null due_date used to vanish entirely ──────────────────────────
{
  const invoices = [
    { id: 'i1', projectId: 'p1', dueDate: null, total: 5000, amountReceived: 0, open: true },
    { id: 'i2', projectId: 'p2', dueDate: '2026-09-01', total: 2000, amountReceived: 0, open: true },
  ]
  const out = buildReceivables(invoices, new Map(), TODAY)
  check('undated invoice is still counted', out.noDueDate.total, 5000)
  check('undated + overdue both in outstanding', out.outstanding, 7000)
  check('overdue bucket has the dated one', out.overdue.total, 2000)
  if (!out.hasUnbucketed) {
    fail++
    console.log('  ❌ hasUnbucketed should flag the undated row')
  } else pass++
}

// ── Beyond 30 days is owed money too — counted, and flagged ────────────────
{
  const invoices = [
    { id: 'i1', projectId: 'p1', dueDate: '2027-01-01', total: 8000, amountReceived: 0, open: true },
  ]
  const out = buildReceivables(invoices, new Map(), TODAY)
  check('far-future invoice lands in later', out.later.total, 8000)
  check('and is in outstanding', out.outstanding, 8000)
}

// ── Waterfall: one project, two invoices, one pot of cash ──────────────────
// The credit must be CONSUMED, not applied to each invoice.
{
  const invoices = [
    { id: 'old', projectId: 'p1', dueDate: '2026-08-01', total: 10000, amountReceived: 0, open: true },
    { id: 'new', projectId: 'p1', dueDate: '2026-10-01', total: 10000, amountReceived: 0, open: true },
  ]
  const out = buildReceivables(invoices, new Map([['p1', 10000]]), TODAY)
  check('waterfall: total owed is 10k, not 0', out.outstanding, 10000)
  check('waterfall: the OLD invoice is settled', out.overdue.total, 0)
  check('waterfall: the new one still stands', out.due30.total, 10000)
}

// ── Bucket boundaries ──────────────────────────────────────────────────────
{
  const invoices = [
    { id: 'a', projectId: null, dueDate: '2026-09-11', total: 100, amountReceived: 0, open: true },
    { id: 'b', projectId: null, dueDate: '2026-09-12', total: 200, amountReceived: 0, open: true },
    { id: 'c', projectId: null, dueDate: '2026-09-19', total: 400, amountReceived: 0, open: true },
    { id: 'd', projectId: null, dueDate: '2026-09-20', total: 800, amountReceived: 0, open: true },
    { id: 'e', projectId: null, dueDate: '2026-10-12', total: 1600, amountReceived: 0, open: true },
    { id: 'f', projectId: null, dueDate: '2026-10-13', total: 3200, amountReceived: 0, open: true },
  ]
  const out = buildReceivables(invoices, new Map(), TODAY)
  check('yesterday is overdue', out.overdue.total, 100)
  check('today is NOT overdue', out.due7.total, 200 + 400)
  check('day 8 falls to the 30-day bucket', out.due30.total, 800 + 1600)
  check('day 31 is later', out.later.total, 3200)
}

// ── An overpaid invoice never goes negative ────────────────────────────────
{
  const invoices = [
    { id: 'i1', projectId: 'p1', dueDate: '2026-09-01', total: 1000, amountReceived: 0, open: true },
  ]
  const out = buildReceivables(invoices, new Map([['p1', 2500]]), TODAY)
  check('overpayment floors at zero', out.outstanding, 0)
}

// ── A PAID invoice must still absorb its own cash ──────────────────────────
// ⛔ THE INVERSE BUG, caught in review. Load only the OPEN invoices and the
// paid one's money has nothing to attach to, so it spills onto what's still
// owed and the card cheerfully reports "nothing outstanding".
{
  const invoices = [
    { id: 'paid', projectId: 'p1', dueDate: '2026-08-01', total: 13114, amountReceived: 0, open: false },
    { id: 'open', projectId: 'p1', dueDate: '2026-10-01', total: 13113, amountReceived: 0, open: true },
  ]
  const ledger = new Map([['p1', 13114]])

  const out = buildReceivables(invoices, ledger, TODAY)
  check('settled invoice absorbs its own cash', out.outstanding, 13113)
  check('and is not itself listed', out.overdue.total, 0)

  // What it looked like when the paid row was filtered out of the query.
  const withoutPaid = buildReceivables([invoices[1]], ledger, TODAY)
  check('open-only would have erased the balance', withoutPaid.outstanding, 0)
  if (withoutPaid.outstanding === out.outstanding) {
    fail++
    console.log('  ❌ including the paid invoice made no difference — no teeth')
  } else pass++
}

// ── Receipts already allocated must NOT be re-poured ───────────────────────
// ⛔ Caught in review: the old max-then-pour credited the NEW invoice's
// payment to the OLD one. The total came out right, which is what hid it —
// but the buckets are the only thing the card renders.
{
  const invoices = [
    { id: 'old', projectId: 'p1', dueDate: '2026-08-01', total: 5000, amountReceived: 0, open: true },
    { id: 'new', projectId: 'p1', dueDate: '2026-10-01', total: 2000, amountReceived: 2000, open: true },
  ]
  const out = buildReceivables(invoices, new Map(), TODAY)
  check('the old invoice is fully overdue', out.overdue.total, 5000)
  check('the paid-off new one is settled', out.due30.total, 0)
  check('total owed', out.outstanding, 5000)
}

// ── Ledger surplus beyond the invoices still waterfalls oldest-first ───────
{
  const invoices = [
    { id: 'old', projectId: 'p1', dueDate: '2026-08-01', total: 5000, amountReceived: 1000, open: true },
    { id: 'new', projectId: 'p1', dueDate: '2026-10-01', total: 5000, amountReceived: 0, open: true },
  ]
  // $1,000 on the invoice + $3,500 total in the ledger ⇒ $2,500 loose.
  const out = buildReceivables(invoices, new Map([['p1', 3500]]), TODAY)
  check('surplus lands on the oldest', out.overdue.total, 5000 - 1000 - 2500)
  check('newer one untouched', out.due30.total, 5000)
  check('total owed', out.outstanding, 1500 + 5000)
}

// ── localToday is LOCAL, not UTC ───────────────────────────────────────────
// 2026-09-12 20:30 in New York is already 2026-09-13 in UTC. The old card
// used the UTC day and called same-day invoices overdue all evening.
{
  const evening = new Date(2026, 8, 12, 20, 30, 0)
  const local = localToday(evening)
  const utc = evening.toISOString().slice(0, 10)
  if (local !== '2026-09-12') {
    fail++
    console.log(`  ❌ localToday gave ${local}, want 2026-09-12`)
  } else pass++
  if (process.env.TZ === 'America/New_York' && utc === local) {
    console.log('  ⚠️  UTC and local agree here — run with TZ=America/New_York to see the drift')
  }
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
