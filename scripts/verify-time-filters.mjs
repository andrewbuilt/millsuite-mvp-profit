// ============================================================================
// verify-time-filters.mjs — the /time filter predicate and week maths.
// ============================================================================
// Run: npx tsx scripts/verify-time-filters.mjs
// No credentials — lib/time-filters is pure (that's why it exists).
//
// ⛔ WHAT'S WORTH PINNING. A time sheet gets reconciled against payroll, so a
// filter that quietly WIDENS its result is worse than one that returns
// nothing. And every date here is local: `toISOString().slice(0,10)` is the
// UTC day, which on a Sunday evening in New York puts an entry in next week.
// ============================================================================

import {
  chipRange,
  isoDate,
  isFilterActive,
  matchesTimeFilter,
  mondayOf,
  EMPTY_TIME_FILTER,
} from '../lib/time-filters.ts'

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

const entry = (over = {}) => ({
  projectId: 'p1',
  memberId: 'm1',
  day: '2026-09-09',
  haystack: 'murtagh bar face frames kaylin sanding',
  ...over,
})
const f = (over = {}) => ({ ...EMPTY_TIME_FILTER, ...over })

// ── mondayOf: Sunday belongs to the week that just ENDED ───────────────────
// Getting this backwards moves a Sunday's hours into next week's bar.
{
  check('Wed → Mon', isoDate(mondayOf(new Date(2026, 8, 9))), '2026-09-07')
  check('Mon → itself', isoDate(mondayOf(new Date(2026, 8, 7))), '2026-09-07')
  check('Sun → the Monday BEFORE', isoDate(mondayOf(new Date(2026, 8, 13))), '2026-09-07')
  check('Sat → the Monday before', isoDate(mondayOf(new Date(2026, 8, 12))), '2026-09-07')
  // Crossing a month and a year boundary.
  check('Jan 1 2027 (Fri)', isoDate(mondayOf(new Date(2027, 0, 1))), '2026-12-28')
}

// ── isoDate is LOCAL ───────────────────────────────────────────────────────
{
  // 2026-09-13 21:30 local. In UTC-negative zones toISOString() is the 14th.
  const evening = new Date(2026, 8, 13, 21, 30)
  check('local day, not UTC', isoDate(evening), '2026-09-13')
  if (process.env.TZ === 'America/New_York') {
    const utc = evening.toISOString().slice(0, 10)
    if (utc === '2026-09-13') {
      fail++
      console.log('  ❌ UTC and local agree — this test proves nothing in this TZ')
    } else pass++
  }
}

// ── chipRange ──────────────────────────────────────────────────────────────
{
  const wed = new Date(2026, 8, 9) // Wednesday
  check('no chip ⇒ no range', chipRange(null, wed), null)
  check('today', chipRange('today', wed), { from: '2026-09-09', to: '2026-09-09' })
  // ⛔ Mon..SUNDAY. A Mon–Fri range would hide Saturday's hours from a filter
  // with no explanation — logged time must never silently disappear.
  check('this week', chipRange('this_week', wed), { from: '2026-09-07', to: '2026-09-13' })
  check('last week', chipRange('last_week', wed), { from: '2026-08-31', to: '2026-09-06' })

  // From a Sunday, "this week" is the week that just ended.
  const sun = new Date(2026, 8, 13)
  check('this week from Sunday', chipRange('this_week', sun), { from: '2026-09-07', to: '2026-09-13' })

  // ⚠️ THE FETCH-WINDOW COUPLING: last week can reach 13 days back, which is
  // why /time loads 30 days and not 7. If this ever exceeds the window, the
  // chip silently returns nothing.
  const reach = Math.round(
    (new Date(2026, 8, 13) - new Date(chipRange('last_week', sun).from + 'T00:00:00')) / 86400000,
  )
  if (reach > 30) {
    fail++
    console.log(`  ❌ last week reaches ${reach} days back — past the 30-day fetch window`)
  } else pass++
}

// ── The predicate: everything AND-s ────────────────────────────────────────
{
  check('empty filter passes all', matchesTimeFilter(entry(), f()), true)
  check('project match', matchesTimeFilter(entry(), f({ projectId: 'p1' })), true)
  check('project miss', matchesTimeFilter(entry(), f({ projectId: 'p2' })), false)
  check('member match', matchesTimeFilter(entry(), f({ memberId: 'm1' })), true)
  check('member miss', matchesTimeFilter(entry(), f({ memberId: 'm2' })), false)
  check('exact date', matchesTimeFilter(entry(), f({ date: '2026-09-09' })), true)
  check('other date', matchesTimeFilter(entry(), f({ date: '2026-09-08' })), false)

  // Two filters that each pass individually must BOTH hold.
  check(
    'project AND member',
    matchesTimeFilter(entry(), f({ projectId: 'p1', memberId: 'm2' })),
    false,
  )
  // ⛔ The two date conditions STACK rather than replace. Sep 9 is inside
  // "this week" relative to the fixed now below, but outside "last week", so
  // combining them must exclude it.
  const NOW = new Date(2026, 8, 9) // Wednesday 2026-09-09
  check(
    'date AND matching chip',
    matchesTimeFilter(entry({ day: '2026-09-09' }), f({ date: '2026-09-09', chip: 'this_week' }), NOW),
    true,
  )
  check(
    'date AND non-matching chip',
    matchesTimeFilter(entry({ day: '2026-09-09' }), f({ date: '2026-09-09', chip: 'last_week' }), NOW),
    false,
  )
  // And the predicate must not read the wall clock — same inputs, same answer.
  check(
    'deterministic for a fixed now',
    matchesTimeFilter(entry({ day: '2026-09-02' }), f({ chip: 'last_week' }), NOW),
    true,
  )
}

// ── Text search spans fields and AND-s terms ───────────────────────────────
{
  check('single term', matchesTimeFilter(entry(), f({ text: 'murtagh' })), true)
  check('term from another field', matchesTimeFilter(entry(), f({ text: 'kaylin' })), true)
  check('two terms, different fields', matchesTimeFilter(entry(), f({ text: 'kaylin murtagh' })), true)
  check('one bad term kills it', matchesTimeFilter(entry(), f({ text: 'kaylin plywood' })), false)
  check('case-insensitive', matchesTimeFilter(entry(), f({ text: 'MURTAGH' })), true)
  check('whitespace only = no filter', matchesTimeFilter(entry(), f({ text: '   ' })), true)
}

// ── Unlinked logins ────────────────────────────────────────────────────────
// An entry whose login isn't on the roster has memberId null. It must still
// appear unfiltered, and must NOT match a specific person.
{
  const orphan = entry({ memberId: null })
  check('orphan shows unfiltered', matchesTimeFilter(orphan, f()), true)
  check('orphan excluded by a person filter', matchesTimeFilter(orphan, f({ memberId: 'm1' })), false)
}

// ── isFilterActive ─────────────────────────────────────────────────────────
{
  check('empty', isFilterActive(f()), false)
  check('whitespace text is not active', isFilterActive(f({ text: '  ' })), false)
  check('text', isFilterActive(f({ text: 'x' })), true)
  check('chip', isFilterActive(f({ chip: 'today' })), true)
  check('project', isFilterActive(f({ projectId: 'p1' })), true)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
