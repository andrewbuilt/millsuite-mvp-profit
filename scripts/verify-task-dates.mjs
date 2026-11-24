// ============================================================================
// verify-task-dates.mjs — TASKS GET REAL TIME (migration 132)
// ============================================================================
// Run: npx tsx scripts/verify-task-dates.mjs     (pure + static, fake clock)
// Replaces verify-task-past-due.mjs (the retired bucket_changed_at clock).
// ============================================================================
import fs from 'fs'
import { execSync } from 'child_process'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub'
const { needByForPick, taskGroup, groupDropDate, pickForNeedBy, pastDueDays, groupTasks, addDaysISO } = await import('../lib/tasks.ts')
let bad = 0, n = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m) } }

console.log('PURE — a "Next week" task walks through time on its own')
const WED = '2026-11-11'
const nb = needByForPick('next_week', WED)
ok(nb === '2026-11-20', `Next week on Wed 11-11 stamps next Friday (got ${nb})`)
ok(taskGroup(nb, WED) === 'next_week', 'reads Next week today')
ok(taskGroup(nb, '2026-11-16') === 'this_week', 'reads This week on Monday')
ok(taskGroup(nb, '2026-11-20') === 'today', 'reads Today on the Friday')
ok(taskGroup(nb, '2026-11-21') === 'overdue', 'reads Overdue the Saturday after')
ok(pastDueDays({ need_by: nb, done_at: null }, '2026-11-21') === 1, 'overdue chip = 1 day past')
ok(pastDueDays({ need_by: nb, done_at: null }, '2026-11-25') === 5, '…5 days past on Wednesday')
ok(pastDueDays({ need_by: nb, done_at: '2026-11-22T00:00:00Z' }, '2026-11-25') === 0, 'done → no chip')
ok(pastDueDays({ need_by: null, done_at: null }, '2026-11-25') === 0, 'Someday → never overdue')

console.log('PURE — picks')
ok(needByForPick('today', WED) === WED, 'Today = today')
ok(needByForPick('this_week', WED) === '2026-11-13', 'This week = this Friday')
ok(needByForPick('this_week', '2026-11-14') === '2026-11-15', 'This week on Saturday = Sunday (Friday is gone)')
ok(needByForPick('this_week', '2026-11-13') === '2026-11-15', 'This week on Friday = Sunday (not Today)')
ok(needByForPick('this_week', '2026-11-15') === '2026-11-15', 'This week on Sunday = today (no later day this week)')
ok(taskGroup(needByForPick('this_week', '2026-11-14'), '2026-11-14') === 'this_week', '…and it still reads This week')
ok(needByForPick('two_weeks', WED) === '2026-11-25', 'In 2 weeks = +14d')
ok(needByForPick('someday', WED) === null, 'Someday = no date')
ok(taskGroup('2026-12-01', WED) === 'later', 'past next week = Later')
ok(taskGroup(null, WED) === 'someday', 'null = Someday')

console.log('PURE — drag restamps; chip and date agree')
const later = groupDropDate('later', WED)
ok(later === '2026-11-25' && pickForNeedBy(later, WED) === 'two_weeks', 'Today → Later drop stamps +14 and lights "In 2 weeks"')
ok(pickForNeedBy(groupDropDate('this_week', WED), WED) === 'this_week', 'This week drop lights This week')
ok(groupDropDate('someday', WED) === null, 'Someday drop clears the date')
for (const g of ['today', 'this_week', 'next_week', 'later', 'someday'])
  for (const d of ['2026-11-09', '2026-11-11', '2026-11-13', '2026-11-14', '2026-11-15'])
    ok(
      taskGroup(groupDropDate(g, d), d) === g || (g === 'this_week' && d === '2026-11-15' && taskGroup(groupDropDate(g, d), d) === 'today'),
      `dropping on ${g} on ${d} lands in ${g}`,
    )

console.log('PURE — grouping + order')
const g = groupTasks([
  { id: 'a', need_by: '2026-11-13', sort_order: 0 },
  { id: 'b', need_by: '2026-11-12', sort_order: 5 },
  { id: 'c', need_by: '2026-11-12', sort_order: 1 },
  { id: 'd', need_by: '2026-11-01', sort_order: 0 },
  { id: 'e', need_by: null, sort_order: 0 },
], WED)
ok(g.overdue.map((t) => t.id).join() === 'd' && g.someday.map((t) => t.id).join() === 'e', 'groups computed')
ok(g.this_week.map((t) => t.id).join() === 'c,b,a', 'inside a group: need_by ascending, then manual order')

console.log('BACKFILL — SQL formula = needByForPick, every weekday')
for (let i = 0; i < 7; i++) {
  const today = addDaysISO('2026-11-09', i) // Mon … Sun
  const mon = '2026-11-09'
  const sqlThis = addDaysISO(mon, 4) > today ? addDaysISO(mon, 4) : addDaysISO(mon, 6) > today ? addDaysISO(mon, 6) : today
  ok(sqlThis === needByForPick('this_week', today), `this_week backfill on ${today}`)
  ok(addDaysISO(mon, 11) === needByForPick('next_week', today), `next_week backfill on ${today}`)
}

console.log('STATIC')
const mig = fs.readFileSync('db/migrations/132_tasks_need_by.sql', 'utf8')
ok(/ADD COLUMN need_by date NULL/.test(mig) && /IF NOT EXISTS/.test(mig) && /NOTIFY pgrst/.test(mig), '132: column + one-time backfill, idempotent')
ok(/WHEN 'this_week' THEN CASE WHEN mon \+ 4 > current_date THEN mon \+ 4 WHEN mon \+ 6 > current_date THEN mon \+ 6 ELSE current_date END/.test(mig) && /WHEN 'next_week' THEN mon \+ 11/.test(mig), '132 backfill matches the app\'s picks')
const readers = execSync(`grep -rnE "\\.bucket\\b|BUCKET_LABEL|TASK_BUCKETS|bucket_changed_at" app components lib || true`, { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter((l) => !l.startsWith('lib/tasks.ts') && !/receivables|ReceivablesCard/.test(l))
ok(readers.length === 0, `nothing outside lib/tasks reads the stored bucket${readers.length ? ':\n    ' + readers.join('\n    ') : ''}`)
const lib = fs.readFileSync('lib/tasks.ts', 'utf8')
ok(/update\.bucket = legacyBucketFor\(patch\.need_by\)/.test(lib) && /bucket: legacyBucketFor\(/.test(lib), 'the NOT NULL bucket is still written (derived) on create + update')
for (const f of ['components/tasks/TasksPanel.tsx', 'app/(app)/tasks/page.tsx', 'components/tasks/ProjectTaskButton.tsx', 'components/tasks/TaskRow.tsx'])
  // (2026-11-24: ProjectTaskButton creates through NewTaskModal, which carries the NeedByPicker.)
  ok(/NeedByPicker|groupTasks|groupDropDate|NewTaskModal/.test(fs.readFileSync(f, 'utf8')), `${f} uses the date model`)
ok(/\['overdue', 'today'\]\.includes\(taskGroup/.test(fs.readFileSync('app/(app)/pm/page.tsx', 'utf8')), "/pm Today = due today + overdue")

console.log(bad ? `\nFAIL — ${bad} of ${n}` : `\nPASS — ${n} checks`)
process.exit(bad ? 1 : 0)
