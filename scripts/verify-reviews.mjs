// ============================================================================
// verify-reviews.mjs — employee reviews + notes (125, November item 4)
// ============================================================================
// Run: npx tsx scripts/verify-reviews.mjs     (pure + static, no database)
//
// PURE   — when a review's "coming up" task fires (7 days out, once, never
//          after it's held); the employee's next-review date.
// STATIC — the no-blindside RLS (worker reads own rows incl. offenses; only
//          managers write); the claim-before-create guard; where it's mounted;
//          and that review/offense text never reaches an API route, a report,
//          an export or the portal.
// ============================================================================

import fs from 'fs'
import { execSync } from 'child_process'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'unused'

let failures = 0
let checks = 0
const ok = (cond, msg) => {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

const { reviewTaskDue, reviewTaskKind, nextReviewDate, reviewComingUpDate, reviewsInWindow, NOTE_KIND_LABEL, REVIEW_TASK_LEAD_DAYS } = await import(
  '../lib/employee-reviews.ts'
)

console.log('PURE')
const T = '2026-11-03'
const r = (scheduled_at, extra = {}) => ({ scheduled_at, held_at: null, task_fired_at: null, dayof_task_fired_at: null, ...extra })
ok(REVIEW_TASK_LEAD_DAYS === 7, 'lead time is 7 days')
ok(reviewTaskDue(r('2026-11-10'), T), 'exactly 7 days out → fires')
ok(!reviewTaskDue(r('2026-11-11'), T), '8 days out → not yet')
ok(reviewTaskDue(r('2026-11-03'), T), 'today → fires')
// Nov batch 2: two tasks — 7 days out ('lead') and on the day ('dayof').
ok(reviewTaskKind(r('2026-11-10'), T) === 'lead', '7 days out → the lead task')
ok(reviewTaskKind(r('2026-11-03'), T) === 'dayof', 'on the day → the day-of task')
ok(reviewTaskKind(r('2026-11-03', { task_fired_at: '2026-10-27T00:00:00Z' }), T) === 'dayof', 'lead already fired → the day-of still fires')
ok(reviewTaskKind(r('2026-11-03', { task_fired_at: 'x', dayof_task_fired_at: 'y' }), T) === null, 'both fired → nothing')
ok(reviewTaskKind(r('2026-11-05', { task_fired_at: 'x' }), T) === null, 'lead fired, day not here yet → nothing')
ok(reviewTaskKind(r('2026-11-03', { held_at: '2026-11-03' }), T) === null, 'held on the day → no day-of task')
ok(reviewTaskDue(r('2026-10-20'), T), 'overdue and not held → still fires')
ok(!reviewTaskDue(r('2026-11-05', { task_fired_at: '2026-11-01T00:00:00Z' }), T), 'already fired → never twice')
ok(!reviewTaskDue(r('2026-11-05', { held_at: '2026-11-02' }), T), 'held → no task')
ok(!reviewTaskDue(r(null), T), 'no date → no task')
ok(reviewTaskDue(r('2026-12-01'), '2026-11-24'), 'crosses a month boundary correctly')
const revs = [
  { scheduled_at: '2026-12-01', held_at: null },
  { scheduled_at: '2026-11-20', held_at: null },
  { scheduled_at: '2026-11-10', held_at: '2026-11-10' },
  { scheduled_at: '2026-10-01', held_at: null },
]
ok(nextReviewDate(revs, T) === '2026-11-20', 'next review = soonest upcoming, not held, not past')
ok(nextReviewDate([], T) === null, 'nothing upcoming → null')
ok(reviewComingUpDate(revs, T) === null, '/me: Nov 20 is 17 days out → not "coming up" yet')
ok(reviewComingUpDate(revs, '2026-11-13') === '2026-11-20', '/me: 7 days out → "coming up"')
const win = reviewsInWindow(revs, T, 30)
ok(win.length === 2 && win[0].scheduled_at === '2026-11-20' && win[1].scheduled_at === '2026-12-01', '/team 30-day list: upcoming, not held, soonest first')
ok(reviewsInWindow(revs, T, 10).length === 0, '/team list respects the window')
ok(NOTE_KIND_LABEL.offense === 'Warning' && NOTE_KIND_LABEL.note === 'Note', '"offense" reads Warning')

console.log('STATIC')
const read = (f) => fs.readFileSync(f, 'utf8')
const mig = read('db/migrations/125_november_batch.sql')
for (const t of ['employee_reviews', 'employee_notes']) {
  ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(mig), `RLS on ${t}`)
  ok(
    new RegExp(`${t}_select[\\s\\S]*?is_org_manager\\(org_id\\)\\s*OR member_id::text IN \\(SELECT public\\.my_roster_member_ids\\(org_id\\)\\)`).test(mig),
    `${t}: managers read all, a worker reads their own`,
  )
  ok(
    new RegExp(`${t}_write ON public\\.${t} FOR ALL TO authenticated\\s*USING \\(org_id = public\\.current_org_id\\(\\) AND public\\.is_org_manager\\(org_id\\)\\)`).test(mig),
    `${t}: only managers write`,
  )
}
ok(!/employee_notes_select[^;]*kind/.test(mig), 'the worker\'s read never filters on kind — offenses included')
ok(/u\.role IN \('owner', 'admin'\)/.test(mig), 'manager = owner or admin')
ok(/m->>'user_id' = u\.id::text/.test(mig), 'own rows keyed on the roster ↔ login link')
const lib = read('lib/employee-reviews.ts')
ok(/\.update\(patch\)\s*\.eq\('id', r\.id\)\s*\.is\(stampCol, null\)[\s\S]*?if \(!claimed\?\.length\) continue[\s\S]*?createTask\(/.test(lib), 'each review task is claimed before it is created (no doubles)')
ok(/ADD COLUMN IF NOT EXISTS dayof_task_fired_at/.test(read('db/migrations/127_november_batch_2.sql')), '127 adds the day-of stamp')
ok(/<UpcomingReviews/.test(read('app/(app)/team/page.tsx')), '/team lists the next 30 days of reviews')
for (const f of ['components/team/ReviewsAndNotes.tsx', 'components/me/MyReviews.tsx'])
  ok(!/>\s*\{n\.kind\}\s*</.test(read(f)) && !/'Offense'/.test(read(f)), `${f}: no raw "offense" shown`)
ok(/createTask\(/.test(lib) && !/new scheduler|setInterval|cron/i.test(lib.replace(/^\/\/.*$/gm, '')), 'reuses createTask, no scheduler')
ok(/<ReviewsAndNotes/.test(read('app/(app)/team/page.tsx')), '/team expanded card has Reviews & notes')
ok(/<MyReviews orgId=\{orgId\} memberId=\{me\.id\}/.test(read('app/(app)/me/page.tsx')), '/me shows the employee their own')
ok(/fireDueReviewTasks\(org\.id\)/.test(read('app/(app)/pm/page.tsx')), '/pm fires due review tasks')
ok(/fireDueReviewTasks\(org\.id\)/.test(read('app/(app)/team/page.tsx')), '/team fires due review tasks')
const my = read('components/me/MyReviews.tsx')
ok(/n\.kind === 'offense'/.test(my) && !/filter\(\(n\) => n\.kind !== 'offense'\)/.test(my), '/me shows offenses, not just notes')
// Sensitive text stays on /team and /me.
const users = execSync(
  `grep -rlE "employee_reviews|employee_notes|lib/employee-reviews" app lib components --include='*.ts' --include='*.tsx' || true`,
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .sort()
const ALLOWED = [
  'components/team/UpcomingReviews.tsx', // dates + names only
  'app/(app)/pm/page.tsx', // fires tasks only — reads no review text
  'app/(app)/team/page.tsx',
  'components/me/MyReviews.tsx',
  'components/team/ReviewsAndNotes.tsx',
  'lib/employee-reviews.ts',
  'lib/team-lifecycle.ts', // head-only COUNT for the delete gate — reads no text
]
for (const f of users) ok(ALLOWED.includes(f), `review data read somewhere unexpected: ${f}`)
ok(/review/i.test(read('scripts/rls-audit.mjs')) && /employee_reviews employee_notes/.test(read('scripts/rls-audit.mjs')), 'the RLS audit lists both tables')

console.log(failures === 0 ? `\nPASS — ${checks} checks` : `\nFAIL — ${failures} of ${checks}`)
process.exit(failures === 0 ? 0 : 1)
