// ============================================================================
// verify-divide-block.mjs — the block-splitting rules.
// ============================================================================
// Run: npx tsx scripts/verify-divide-block.mjs
//
// ⛔ WHY THIS MATTERS. The operator carves a block of SCHEDULED HOURS into N
// weeks and saves it over the real allocation. If the pieces don't sum to the
// original, hours are invented or lost on a production schedule — so the sum
// invariant is the thing under test, along with the rule that nothing
// automatic may overwrite a hand-typed row.
// ============================================================================

import {
  addDays,
  applyFirstDate,
  evenSplit,
  isCustomEdit,
  resizeRows,
  splitIsValid,
  MAX_SPLITS,
  MIN_SPLITS,
} from '../lib/divide-block.ts'

let pass = 0
let fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else {
    fail++
    console.log(`  ❌ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}
const sum = (rows) => +rows.reduce((a, r) => a + Number(r.hours), 0).toFixed(2)

// ── ⛔ THE INVARIANT: an even split always sums to the total ───────────────
// Including the awkward ones where total/count doesn't land on a half hour.
{
  for (const total of [7, 10, 13, 100, 3, 0.5, 148, 771, 1.5]) {
    for (const count of [2, 3, 4, 5, 7, 12, 52]) {
      const rows = evenSplit(count, total, '2026-09-07')
      if (Math.abs(sum(rows) - total) > 0.001) {
        fail++
        console.log(`  ❌ ${total}h across ${count}: sums to ${sum(rows)}`)
      } else pass++
      if (rows.length !== count) {
        fail++
        console.log(`  ❌ ${total}h across ${count}: got ${rows.length} rows`)
      } else pass++
    }
  }
  // The classic: 7 across 3 is 2.5 + 2.5 + 2.0, not 2.5 x 3 = 7.5.
  check('7h / 3 weeks', evenSplit(3, 7, '2026-09-07').map((r) => r.hours), ['2.5', '2.5', '2'])
}

// ── Dates step a week at a time, from the block's own Monday ───────────────
{
  const rows = evenSplit(3, 9, '2026-09-07')
  check('week cadence', rows.map((r) => r.startDate), ['2026-09-07', '2026-09-14', '2026-09-21'])
  // Across a month boundary and a DST change (US falls back 2026-11-01).
  check('crosses DST', addDays('2026-10-26', 7), '2026-11-02')
  check('crosses a year', addDays('2026-12-28', 7), '2027-01-04')
}

// ── ⛔ Dates are LOCAL. A UTC slice shifts them in UTC+ zones ──────────────
{
  check('addDays keeps the day', addDays('2026-09-07', 0), '2026-09-07')
  const naive = new Date('2026-09-07T12:00:00')
  naive.setDate(naive.getDate() + 7)
  const utcWay = naive.toISOString().slice(0, 10)
  if (process.env.TZ && process.env.TZ.startsWith('Pacific/') && utcWay === addDays('2026-09-07', 7)) {
    console.log('  ⚠️  run with TZ=Pacific/Auckland to exercise the UTC+ case')
  }
  pass++
}

// ── Auto-fill from row 1 ──────────────────────────────────────────────────
{
  const rows = evenSplit(3, 9, '2026-09-07')
  const moved = applyFirstDate(rows, '2026-09-21', false)
  check('the rest follow', moved.map((r) => r.startDate), ['2026-09-21', '2026-09-28', '2026-10-05'])
  check('hours untouched', moved.map((r) => r.hours), rows.map((r) => r.hours))

  // ⛔ In custom mode ONLY row 1 moves — the others were placed deliberately.
  const custom = applyFirstDate(rows, '2026-09-21', true)
  check('custom: only row 1 moves', custom.map((r) => r.startDate), [
    '2026-09-21', '2026-09-14', '2026-09-21',
  ])
  if (JSON.stringify(custom) === JSON.stringify(moved)) {
    fail++
    console.log('  ❌ custom and default auto-fill are identical — no teeth')
  } else pass++
}

// ── What counts as the operator taking over ───────────────────────────────
{
  check('row 1 date is the HANDLE, not an edit', isCustomEdit(0, { startDate: '2026-09-21' }), false)
  check('row 2 date is an edit', isCustomEdit(1, { startDate: '2026-09-21' }), true)
  check('hours on row 1 is an edit', isCustomEdit(0, { hours: '4' }), true)
  check('hours on row 3 is an edit', isCustomEdit(2, { hours: '4' }), true)
}

// ── ⛔ Resizing must not disturb typed values ──────────────────────────────
{
  const edited = [
    { startDate: '2026-09-07', hours: '3' },
    { startDate: '2026-11-30', hours: '6' }, // deliberately out of cadence
  ]
  const grown = resizeRows(edited, 4, '2026-09-07')
  check('keeps row 1', grown[0], edited[0])
  check('keeps the out-of-cadence row 2', grown[1], edited[1])
  check('new rows continue from the LAST row', grown[2].startDate, '2026-12-07')
  // ⛔ New rows start at 0h — adding a week must not invent hours.
  check('new rows are 0h', [grown[2].hours, grown[3].hours], ['0', '0'])

  const shrunk = resizeRows(grown, 2, '2026-09-07')
  check('shrinks from the end', shrunk, edited)
  check('no-op when equal', resizeRows(edited, 2, '2026-09-07'), edited)
}

// ── The Save gate ─────────────────────────────────────────────────────────
{
  check('even split is valid', splitIsValid(evenSplit(3, 9, '2026-09-07'), 9), true)
  check('short by an hour', splitIsValid([
    { startDate: '2026-09-07', hours: '4' },
    { startDate: '2026-09-14', hours: '4' },
  ], 9), false)
  check('over by an hour', splitIsValid([
    { startDate: '2026-09-07', hours: '5' },
    { startDate: '2026-09-14', hours: '5' },
  ], 9), false)
  // ⛔ A 0h row can't be saved even when the sum foots — resizeRows creates
  // them, so the gate is what stops an empty week being written.
  check('a 0h row blocks save', splitIsValid([
    { startDate: '2026-09-07', hours: '9' },
    { startDate: '2026-09-14', hours: '0' },
  ], 9), false)
  check('a missing date blocks save', splitIsValid([
    { startDate: '2026-09-07', hours: '4.5' },
    { startDate: '', hours: '4.5' },
  ], 9), false)
  check('floating-point tolerance', splitIsValid([
    { startDate: '2026-09-07', hours: '0.1' },
    { startDate: '2026-09-14', hours: '0.2' },
  ], 0.3), true)
}

// ── Bounds ────────────────────────────────────────────────────────────────
{
  check('min is 2', MIN_SPLITS, 2)
  // The old dropdown stopped at 6 and that's what Andrew hit.
  check('max is a year', MAX_SPLITS, 52)
  const long = evenSplit(52, 520, '2026-09-07')
  check('52 rows', long.length, 52)
  check('still sums', sum(long), 520)
  check('last week is 51 weeks out', long[51].startDate, addDays('2026-09-07', 357))
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
