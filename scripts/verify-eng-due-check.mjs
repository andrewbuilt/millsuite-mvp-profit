// ============================================================================
// verify-eng-due-check.mjs — the end-of-day engineering check (2026-11-25)
// Hand-footed rules (lib/eng-due-check) + wiring greps.
// Run: npx tsx scripts/verify-eng-due-check.mjs
// ============================================================================
import fs from 'node:fs'
import { jobsToAsk, missedJobs, validNotYet, nextWorkday, CHECK_AT_MINUTES } from '../lib/eng-due-check.ts'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`) } else { fail++; console.log(`  ✗ ${m}`) } }

const T = '2026-11-25' // a Wednesday
const A = (project_id, member_id, firm_date, done_at = null) => ({ project_id, member_id, firm_date, done_at })
const assigns = [
  A('acme', 'hunter', T),            // due today
  A('laford', 'hunter', '2026-11-20'), // overdue
  A('later', 'hunter', '2026-12-03'),  // future
  A('nodate', 'hunter', null),         // never asked
  A('done', 'hunter', T, '2026-11-25T15:00:00Z'),
  A('olive', 'nicholas', T),         // someone else's
]

console.log('\njobsToAsk')
const before = jobsToAsk(assigns, [], 'hunter', T, CHECK_AT_MINUTES - 1)
ok(before.length === 1 && before[0].projectId === 'laford' && before[0].overdue, 'before 3:30 only the overdue job is asked')
const after = jobsToAsk(assigns, [], 'hunter', T, CHECK_AT_MINUTES)
ok(after.map((j) => j.projectId).join() === 'laford,acme', 'at 3:30 the due-today job joins, oldest due first')
ok(!after.some((j) => ['later', 'nodate', 'done', 'olive'].includes(j.projectId)), 'future, no-date, done and other people’s jobs are never asked')
const answered = jobsToAsk(assigns, [{ project_id: 'acme', check_date: T, answer: 'not_yet' }, { project_id: 'laford', check_date: '2026-11-24', answer: 'not_yet' }], 'hunter', T, 16 * 60)
ok(answered.map((j) => j.projectId).join() === 'laford', 'answered today = not asked again; answered YESTERDAY = asked again')
ok(jobsToAsk(assigns, [{ project_id: 'acme', check_date: T, answer: 'missed' }], 'hunter', T, 16 * 60).some((j) => j.projectId === 'acme'), "a 'missed' row doesn't count as an answer")

console.log('\nmissedJobs')
const m1 = missedJobs(assigns, [], T)
ok(m1.map((j) => j.projectId).join() === 'laford', 'only past-due, not-done jobs with no answer are missed (today isn’t over yet)')
ok(missedJobs(assigns, [{ project_id: 'laford', check_date: '2026-11-20', answer: 'missed' }], T).length === 0, 'one missed row per due day — the sweep never doubles up')
ok(missedJobs(assigns, [{ project_id: 'laford', check_date: '2026-11-21', answer: 'not_yet' }], T).length === 0, 'an answer on or after the due day = not missed')
ok(missedJobs(assigns, [{ project_id: 'laford', check_date: '2026-11-19', answer: 'not_yet' }], T).length === 1, 'an answer from BEFORE the due day doesn’t cover it')

console.log('\nvalidNotYet / nextWorkday')
ok(validNotYet('2026-11-26', 'waiting on appliance specs', T) === null, 'tomorrow + a reason is fine')
ok(validNotYet(T, 'x', T) !== null && validNotYet('2026-11-24', 'x', T) !== null, 'today or earlier is refused')
ok(validNotYet('2026-11-26', '   ', T) !== null && validNotYet(null, 'x', T) !== null, 'a reason and a date are both required')
ok(nextWorkday('2026-11-27') === '2026-11-30' && nextWorkday(T) === '2026-11-26', 'next workday skips the weekend')

console.log('\nwiring')
const read = (p) => fs.readFileSync(p, 'utf8')
const mig = read('db/migrations/138_eng_due_checks.sql')
ok(/CREATE TABLE IF NOT EXISTS public\.eng_due_checks/.test(mig) && /NOTIFY pgrst, 'reload schema';\s*$/.test(mig.trim()), '138 idempotent + schema reload')
ok(/ENABLE ROW LEVEL SECURITY/.test(mig) && /FOR SELECT TO authenticated/.test(mig) && !/FOR (ALL|INSERT|UPDATE)/.test(mig), '138: the shop can only READ its rows; writes are service-role')
ok(/UNIQUE INDEX IF NOT EXISTS eng_due_checks_project_day[\s\S]*\(project_id, check_date\)/.test(mig), '138: one row per job per day')
const srv = read('lib/eng-due-check-server.ts')
ok(/resolvePortalPm\(orgId\)/.test(srv), 'PM task goes to the same person portal questions do (Kaylin at BUILT)')
ok(/critical: true/.test(srv) && /No answer — is engineering done/.test(srv), 'no answer → a Critical task')
ok(/firm_date: newDate, priority:/.test(srv), 'not yet → new due date AND top of their list')
ok(/Only the engineer on this job can answer/.test(srv), 'only the assigned engineer (or an owner/admin) can answer')
const layout = read('app/(app)/layout.tsx')
ok(/<EngDueCheck \/>/.test(layout), 'the prompt is mounted in the app layout')
ok(!/onClick=\{onClose\}|aria-label="Close"/.test(read('components/engineering/EngDueCheck.tsx')), 'the prompt has no close button')

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
