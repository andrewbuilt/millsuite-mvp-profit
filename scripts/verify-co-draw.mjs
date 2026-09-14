// ============================================================================
// verify-co-draw.mjs — where an approved change order's draw lands.
// ============================================================================
// Run: npx tsx scripts/verify-co-draw.mjs
// No credentials — lib/payment-schedule is pure.
//
// ⛔ WHY THIS MATTERS MORE THAN IT LOOKS. `reconcileAll` waterfalls received
// money over a project's draws IN SORT ORDER. A change-order row that lands at
// the FRONT soaks up payments that belong to earlier draws and marks them
// unpaid — money attaching to the wrong draw, which is the same class of bug
// as the drag-reorder one (634c0eb). And `sort_order` has no column: it lives
// in `notes` as `order:N`, so it's easy to get silently wrong.
// ============================================================================

import { coDrawSlot } from '../lib/payment-schedule.ts'

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

const row = (order, date) => ({
  notes: order === null ? null : `order:${order}`,
  expected_date: date,
})

// ── The ordinary schedule ──────────────────────────────────────────────────
{
  const rows = [row(0, '2026-05-01'), row(1, '2026-06-01'), row(2, '2026-07-01')]
  const slot = coDrawSlot(rows)
  check('sorts after the last draw', slot.order, 3)
  check('inherits the final draw date', slot.expectedDate, '2026-07-01')
}

// ── ⛔ Order comes from the MARKER, not the array position ─────────────────
// Rows arrive in whatever order PostgREST returns them. Reading position
// instead of `order:N` would put the CO in the middle of the waterfall.
{
  const shuffled = [row(2, '2026-07-01'), row(0, '2026-05-01'), row(1, '2026-06-01')]
  const slot = coDrawSlot(shuffled)
  check('unsorted input still lands last', slot.order, 3)
  check('and takes the highest-order date', slot.expectedDate, '2026-07-01')

  // Proof the test has teeth: array-position logic would have said 3 here too,
  // so use a case where the two disagree.
  const gappy = [row(7, '2026-09-01'), row(0, '2026-05-01')]
  check('respects a gap in the markers', coDrawSlot(gappy).order, 8)
  check('not the row count', coDrawSlot(gappy).order !== gappy.length, true)
}

// ── A second change order stacks after the first ───────────────────────────
{
  const rows = [row(0, '2026-05-01'), row(1, '2026-06-01'), row(2, '2026-06-01')]
  const slot = coDrawSlot(rows)
  check('CO #2 lands after CO #1', slot.order, 3)
}

// ── Hand-made schedules with no markers ────────────────────────────────────
{
  const rows = [row(null, '2026-05-01'), row(null, '2026-06-01')]
  const slot = coDrawSlot(rows)
  check('falls back to the count', slot.order, 2)
  check('and takes the last row date', slot.expectedDate, '2026-06-01')
}

// ── Mixed: some marked, some not ───────────────────────────────────────────
{
  const rows = [row(0, '2026-05-01'), row(null, '2026-06-01'), row(1, '2026-07-01')]
  check('markers win over unmarked rows', coDrawSlot(rows).order, 2)
}

// ── ⛔ An undated final draw stays undated ─────────────────────────────────
// Inventing a date would put money in a month nobody chose. Null is a real
// answer — the card lands in the "No date set" tray to be placed by hand.
{
  const rows = [row(0, '2026-05-01'), row(1, null)]
  const slot = coDrawSlot(rows)
  check('order still advances', slot.order, 2)
  check('date stays null', slot.expectedDate, null)
}

// ── Degenerate input never throws ──────────────────────────────────────────
{
  check('empty list', coDrawSlot([]), { order: 0, expectedDate: null })
  check('undefined', coDrawSlot(undefined), { order: 0, expectedDate: null })
  check('junk notes', coDrawSlot([{ notes: 'hello', expected_date: '2026-05-01' }]).order, 1)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
