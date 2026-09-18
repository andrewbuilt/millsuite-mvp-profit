// ============================================================================
// scripts/verify-task-past-due.mjs — the "Past due · Nd" clock is calendar math
// ============================================================================
//   npx tsx scripts/verify-task-past-due.mjs
//
// pastDueDays (migration 112) decides whether a red chip appears on a task,
// and calendar-day math is exactly where off-by-ones live: "entered yesterday
// at 11pm, looked at 8am" is nine elapsed hours but must read 1d, because the
// question is how many mornings the task survived — not how long it's been.
// These checks pin that, plus every guard that suppresses the chip (wrong
// bucket, completed, no stamp, garbage stamp, clock skew).
//
// `now` is passed explicitly everywhere so the checks don't depend on when
// they run.
// ============================================================================

// lib/tasks pulls in the browser supabase client, which throws at import
// without env. Stubbed BEFORE a dynamic import (a static import would hoist
// above the stub); no query ever runs — pastDueDays is pure.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub-key-for-verify-script'

const { pastDueDays } = await import('../lib/tasks.ts')

let bad = 0
const ck = (label, actual, expected) => {
  const ok = actual === expected
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — got ${actual}, wanted ${expected}`}`)
}

const t = (overrides) => ({
  bucket: 'today',
  done_at: null,
  bucket_changed_at: null,
  ...overrides,
})

// A fixed vantage point: Friday Sep 18 2026, 8:00 in local time.
const now = new Date(2026, 8, 18, 8, 0, 0)

// ── The clock itself ────────────────────────────────────────────────────────
ck(
  'entered earlier today → 0 (not past due)',
  pastDueDays(t({ bucket_changed_at: new Date(2026, 8, 18, 6, 30).toISOString() }), now),
  0,
)
ck(
  'entered yesterday morning → 1',
  pastDueDays(t({ bucket_changed_at: new Date(2026, 8, 17, 9, 0).toISOString() }), now),
  1,
)
ck(
  'entered yesterday 11:59pm, viewed 8am — nine hours elapsed, still 1 morning',
  pastDueDays(t({ bucket_changed_at: new Date(2026, 8, 17, 23, 59).toISOString() }), now),
  1,
)
ck(
  'entered 12:01am today — same calendar day, 0 even though the row is "old" tonight',
  pastDueDays(t({ bucket_changed_at: new Date(2026, 8, 18, 0, 1).toISOString() }), now),
  0,
)
ck(
  'entered five days ago → 5',
  pastDueDays(t({ bucket_changed_at: new Date(2026, 8, 13, 15, 0).toISOString() }), now),
  5,
)
ck(
  'entered last month → 33',
  pastDueDays(t({ bucket_changed_at: new Date(2026, 7, 16, 12, 0).toISOString() }), now),
  33,
)
// DST: US spring-forward 2026 is Mar 8. Mar 7 → Mar 9 spans a 23-hour day;
// floor() of the millisecond difference would read 1, not 2.
ck(
  'across a spring-forward day — calendar days, not elapsed/24h',
  pastDueDays(
    t({ bucket_changed_at: new Date(2026, 2, 7, 12, 0).toISOString() }),
    new Date(2026, 2, 9, 8, 0),
  ),
  2,
)

// ── Everything that suppresses the chip ─────────────────────────────────────
ck(
  'not in Today (this_week) → 0 regardless of age',
  pastDueDays(
    t({ bucket: 'this_week', bucket_changed_at: new Date(2026, 8, 1).toISOString() }),
    now,
  ),
  0,
)
ck(
  'completed → 0 regardless of age (archive rows never carry the chip)',
  pastDueDays(
    t({
      done_at: new Date(2026, 8, 17).toISOString(),
      bucket_changed_at: new Date(2026, 8, 1).toISOString(),
    }),
    now,
  ),
  0,
)
ck('null stamp (pre-112) → 0 — a guessed chip is worse than none', pastDueDays(t({}), now), 0)
ck(
  'garbage stamp → 0, not NaN days',
  pastDueDays(t({ bucket_changed_at: 'not-a-date' }), now),
  0,
)
ck(
  'future stamp (clock skew) → 0, never a negative count',
  pastDueDays(t({ bucket_changed_at: new Date(2026, 8, 20, 9, 0).toISOString() }), now),
  0,
)

console.log(bad === 0 ? '\nAll checks passed.' : `\n${bad} CHECK(S) FAILED.`)
process.exit(bad === 0 ? 0 : 1)
