// ============================================================================
// scripts/verify-payments.mjs — which month does this draw land in?
// ============================================================================
//   TZ=America/New_York npx tsx scripts/verify-payments.mjs
//   TZ=UTC             npx tsx scripts/verify-payments.mjs
//   TZ=Pacific/Auckland npx tsx scripts/verify-payments.mjs
//
// No --env-file and no network: it imports lib/payment-schedule, which is pure
// for exactly this reason. (It first imported lib/payments, which builds a
// Supabase client at module scope — so this threw "supabaseUrl is required"
// before the first assertion, and the guard silently wasn't running.)
//
// ⛔ RUN IT IN A NEGATIVE-OFFSET TZ AT LEAST ONCE. That is the whole point.
//
// `expected_date` is a DATE column — bare 'YYYY-MM-DD'. `new Date('2026-09-01')`
// parses it as UTC midnight, which in America/New_York is 2026-08-31 20:00
// LOCAL, so `.getMonth()` says August. A draw silently renders one month early,
// the shortfall lands in the wrong column, and it only ever reproduces for
// shops west of Greenwich — which is all of Andrew's. The cases below fail
// loudly under TZ if anyone reintroduces `new Date(str)`.
//
// The rest pins the two things this page is actually for: "needed this month"
// (by expected_date) and "what came in this month" (by received_date), which
// are NOT the same bucket when a draw is paid late.
// ============================================================================

import {
  parseLocalDate,
  formatLocalDate,
  addMonths,
  daysInMonth,
  monthId,
  monthOf,
  rescheduleTo,
  cashMonthOf,
  buildPaymentsView,
  isOutstanding,
} from '../lib/payment-schedule.ts'

let bad = 0
const ck = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`)
  if (!ok) console.log(`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`)
}

console.log(`(TZ = ${Intl.DateTimeFormat().resolvedOptions().timeZone}, offset ${-new Date().getTimezoneOffset() / 60}h)\n`)

// ── The trap ───────────────────────────────────────────────────────────────
// The first of the month is the dangerous case: any negative offset pushes it
// into the previous month.
for (const [s, y, m, d] of [
  ['2026-09-01', 2026, 8, 1],
  ['2026-01-01', 2026, 0, 1],
  ['2026-12-31', 2026, 11, 31],
  ['2026-03-01', 2026, 2, 1],
]) {
  const parsed = parseLocalDate(s)
  ck(`${s} parses as local ${y}-${m + 1}-${d}`, [parsed.getFullYear(), parsed.getMonth(), parsed.getDate()], [y, m, d])
  ck(`${s} buckets into the right month`, monthId(monthOf(parsed)), s.slice(0, 7))
}

// Round-trip: parse then format must be the identity, in every timezone.
for (const s of ['2026-01-01', '2026-06-15', '2026-12-31', '2027-02-28']) {
  ck(`round-trips ${s}`, formatLocalDate(parseLocalDate(s)), s)
}

// Garbage in must not become a plausible date.
for (const s of [null, undefined, '', 'tomorrow', '2026-13-01', '2026-02-31', '26-01-01']) {
  ck(`rejects ${JSON.stringify(s)}`, parseLocalDate(s), null)
}

// ── Month arithmetic ───────────────────────────────────────────────────────
ck('addMonths rolls the year forward', addMonths({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 })
ck('addMonths rolls the year back', addMonths({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 })
ck('addMonths handles a big jump', addMonths({ year: 2026, month: 5 }, 14), { year: 2027, month: 7 })
ck('addMonths handles a big negative jump', addMonths({ year: 2026, month: 5 }, -14), { year: 2025, month: 3 })
ck('addMonths(0) is identity', addMonths({ year: 2026, month: 3 }, 0), { year: 2026, month: 3 })
ck('Feb 2028 is a leap month', daysInMonth({ year: 2028, month: 1 }), 29)
ck('Feb 2026 is not', daysInMonth({ year: 2026, month: 1 }), 28)

// ── Drag between months: clamp, never roll ─────────────────────────────────
const row = (o = {}) => ({
  id: 'r1', projectId: 'p1', projectName: 'Kennedy', clientName: 'K', stage: 'production',
  label: 'Deposit', amount: 1000, status: 'projected', expectedDate: null, receivedDate: null, ...o,
})

// The 31st into a 30-day month. Unclamped this becomes Dec 1 — the card leaps
// out of the column the operator just dropped it into.
ck(
  '31st → November clamps to the 30th',
  rescheduleTo(row({ expectedDate: '2026-10-31' }), { year: 2026, month: 10 }),
  '2026-11-30',
)
ck(
  '31st → February clamps to the 28th',
  rescheduleTo(row({ expectedDate: '2026-01-31' }), { year: 2026, month: 1 }),
  '2026-02-28',
)
ck(
  '31st → February 2028 clamps to the 29th (leap)',
  rescheduleTo(row({ expectedDate: '2026-01-31' }), { year: 2028, month: 1 }),
  '2028-02-29',
)
ck(
  'an ordinary day is preserved',
  rescheduleTo(row({ expectedDate: '2026-03-15' }), { year: 2026, month: 6 }),
  '2026-07-15',
)
ck(
  'an undated draw lands on the 1st',
  rescheduleTo(row({ expectedDate: null }), { year: 2026, month: 6 }),
  '2026-07-01',
)
// Whatever we compute must land in the month the operator dropped it in.
for (const day of ['2026-01-29', '2026-01-30', '2026-01-31']) {
  for (let m = 0; m < 12; m++) {
    const out = rescheduleTo(row({ expectedDate: day }), { year: 2026, month: m })
    if (monthId(monthOf(parseLocalDate(out))) !== monthId({ year: 2026, month: m })) {
      bad++
      console.log(`FAIL ${day} → month ${m} landed in ${out}`)
    }
  }
}
ck('every day/month combination lands in the target month', true, true)

// ── The two dates are not the same bucket ──────────────────────────────────
// A draw expected in August but PAID in September is September cash.
const late = row({ id: 'late', status: 'received', expectedDate: '2026-08-20', receivedDate: '2026-09-03' })
ck('a late payment counts in the month it ARRIVED', monthId(cashMonthOf(late)), '2026-09')

// A received row that never got stamped still counts — falling back beats
// money disappearing from the totals.
const unstamped = row({ status: 'received', expectedDate: '2026-08-20', receivedDate: null })
ck('received-but-unstamped falls back to expected', monthId(cashMonthOf(unstamped)), '2026-08')

ck('outstanding statuses', ['projected', 'invoiced', 'received', 'cancelled'].map((s) => isOutstanding(row({ status: s }))), [true, true, false, false])

// ── The view ───────────────────────────────────────────────────────────────
const MONTHS = [
  { year: 2026, month: 8 },  // Sep
  { year: 2026, month: 9 },  // Oct
  { year: 2026, month: 10 }, // Nov
]
const ROWS = [
  row({ id: 'a', amount: 10000, expectedDate: '2026-09-10' }),
  row({ id: 'b', amount: 5000, expectedDate: '2026-09-25', status: 'invoiced' }),
  row({ id: 'c', amount: 7000, expectedDate: '2026-10-01' }),
  row({ id: 'd', amount: 3000, status: 'received', expectedDate: '2026-09-05', receivedDate: '2026-09-06' }),
  row({ id: 'e', amount: 9999, status: 'cancelled', expectedDate: '2026-09-15' }),
  row({ id: 'f', amount: 2500, expectedDate: null }),                      // unscheduled
  row({ id: 'g', amount: 4000, expectedDate: '2026-07-01' }),              // overdue
  row({ id: 'h', amount: 1234, expectedDate: '2027-05-01' }),              // beyond window
]
const TODAY = { year: 2026, month: 8 } // September — the window starts here
const v = buildPaymentsView(ROWS, MONTHS, TODAY)

ck('September needed = 10000 + 5000', v.months[0].needed, 15000)
ck('September received = 3000', v.months[0].receivedTotal, 3000)
ck('October needed = 7000', v.months[1].needed, 7000)
ck('November is empty', [v.months[2].needed, v.months[2].receivedTotal], [0, 0])
ck('cancelled never appears', v.months[0].outstanding.some((r) => r.id === 'e'), false)
ck('undated lands in the tray', v.unscheduled.map((r) => r.id), ['f'])
ck('a past-due draw is surfaced, not dropped', v.overdue.map((r) => r.id), ['g'])
ck('beyond-window is simply not shown', JSON.stringify(v).includes('"h"'), false)

// "every unpaid draw appears exactly once" — the acceptance criterion.
const placed = [
  ...v.months.flatMap((m) => [...m.outstanding, ...m.received]),
  ...v.unscheduled,
  ...v.overdue,
].map((r) => r.id)
ck('no draw appears twice', placed.length, new Set(placed).size)
ck(
  'every non-cancelled, in-range draw is placed exactly once',
  placed.sort(),
  ['a', 'b', 'c', 'd', 'f', 'g'],
)

// Sorted soonest-first inside a month, so the next thing due reads first.
ck('a month sorts by date', v.months[0].outstanding.map((r) => r.id), ['a', 'b'])

// ── "Past due" is relative to TODAY, not to the window ─────────────────────
// Paging forward must not repaint this month's un-due draws as overdue.
const PAGED_FWD = [
  { year: 2026, month: 9 },
  { year: 2026, month: 10 },
  { year: 2026, month: 11 },
]
const vf = buildPaymentsView(ROWS, PAGED_FWD, TODAY)
ck(
  'paging forward does NOT mark this month past due',
  vf.overdue.map((r) => r.id),
  ['g'], // only the genuinely-late July draw
)
ck(
  "September's draws are simply off-window, not red",
  vf.overdue.some((r) => ['a', 'b', 'd'].includes(r.id)),
  false,
)

// Paging BACKWARD must not hide a genuinely late draw among ordinary cards,
// and must still place every row exactly once.
const PAGED_BACK = [
  { year: 2026, month: 5 },
  { year: 2026, month: 6 },
  { year: 2026, month: 7 },
]
const vb = buildPaymentsView(ROWS, PAGED_BACK, TODAY)
const placedBack = [
  ...vb.months.flatMap((m) => [...m.outstanding, ...m.received]),
  ...vb.unscheduled,
  ...vb.overdue,
].map((r) => r.id)
ck('paging back still places each row once', placedBack.length, new Set(placedBack).size)
ck('the July draw sits in its own column when visible', vb.months[1].outstanding.map((r) => r.id), ['g'])
ck('and is not ALSO in the past-due tray', vb.overdue.map((r) => r.id), [])

console.log(bad ? `\n${bad} FAILING` : '\nall payments cases pass')
process.exit(bad ? 1 : 0)
