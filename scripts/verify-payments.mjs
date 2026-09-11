// ============================================================================
// scripts/verify-payments.mjs — calendar guard for the payments pages
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
// Bucketing and reconciliation moved to lib/payment-ledger when payments
// became their own rows; see scripts/verify-payment-ledger.mjs. This file is
// now purely the CALENDAR guard, which is the part that silently breaks.
// ============================================================================

import {
  parseLocalDate,
  formatLocalDate,
  addMonths,
  daysInMonth,
  monthId,
  monthOf,
  rescheduleTo,
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

ck('outstanding statuses', ['projected', 'invoiced', 'received', 'cancelled'].map((s) => isOutstanding(row({ status: s }))), [true, true, false, false])

console.log(bad ? `\n${bad} FAILING` : '\nall payment-date cases pass')
process.exit(bad ? 1 : 0)
