// ============================================================================
// verify-task-critical-seen.mjs — Critical + unseen badges + task modal (133)
// ============================================================================
// Run: npx tsx scripts/verify-task-critical-seen.mjs     (pure + static)
// ============================================================================
import fs from 'fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub'
const { comparePriority, groupTasks, isUnseenBy, OFFERED_PICKS, taskAfterPost, findMentions, mentionHandle, formatCommentAt } = await import('../lib/tasks.ts')
let bad = 0, n = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m) } }
const read = (f) => fs.readFileSync(f, 'utf8')
const T = (id, need_by, critical = false, sort_order = 0) => ({ id, need_by, critical, sort_order })

console.log('PURE — priority order: Critical, then oldest need_by, undated last')
const sorted = [T('later', '2026-11-30'), T('none', null), T('old', '2026-11-02'), T('crit', '2026-11-20', true), T('today', '2026-11-12')]
  .sort(comparePriority).map((t) => t.id)
ok(sorted.join() === 'crit,old,today,later,none', `order = ${sorted.join()}`)
const g = groupTasks([T('a', '2026-11-12'), T('b', '2026-11-12', true)], '2026-11-12')
ok(g.today[0].id === 'b', 'Critical sorts first inside its group')

console.log('PURE — unseen = mine, open, not in seen_by')
ok(isUnseenBy({ assignee_ids: ['m1'], seen_by: [], done_at: null }, 'm1'), 'assigned, never opened → unseen')
ok(!isUnseenBy({ assignee_ids: ['m1'], seen_by: ['m1'], done_at: null }, 'm1'), 'opened → seen')
ok(!isUnseenBy({ assignee_ids: ['m2'], seen_by: [], done_at: null }, 'm1'), 'not mine → not counted')
ok(!isUnseenBy({ assignee_ids: ['m1'], seen_by: [], done_at: 'x' }, 'm1'), 'done → not counted')
ok(!isUnseenBy({ assignee_ids: ['m1'], seen_by: [], done_at: null }, null), 'unlinked login → nothing')

console.log('STATIC — picker, badge, modal, migration')
ok(OFFERED_PICKS.join() === 'today,this_week,next_week', 'pickers offer Today · This week · Next week (no In 2 weeks / Someday)')
const picker = read('components/tasks/NeedByPicker.tsx')
ok(/Critical/.test(picker) && /onChange\(today, true\)/.test(picker) && !/PICK_LABEL\.someday|TASK_PICKS/.test(picker), 'NeedByPicker: Critical stamps today; no Someday chip')
const nav = read('components/tasks/TasksNavButton.tsx')
ok(/unseenCount/.test(nav) && /criticalCount/.test(nav) && /bg-\[#DC2626\]/.test(nav) && !/openCount/.test(nav), 'nav: blue = unseen, red = critical, no open-count badge')
const prov = read('components/tasks/TasksProvider.tsx')
ok(/isUnseenBy\(t, myAssigneeId\)/.test(prov) && /markTaskSeen\(/.test(prov), 'provider computes unseen + persists seen')
const row = read('components/tasks/TaskRow.tsx')
ok(/createPortal\(/.test(row) && /role="dialog"/.test(row) && /markSeen\(task\)/.test(row), 'TaskRow: detail is a portaled modal; opening marks seen')
ok(/critical\b[\s\S]{0,40}orgId\)/.test(row) || /need_by: d, critical/.test(row), 'modal picker writes need_by + critical together')
const pm = read('app/(app)/pm/page.tsx')
ok(/t\.critical \|\| \['overdue', 'today'\]/.test(pm) && /\.sort\(comparePriority\)/.test(pm), '/pm: Critical (any date) + today + overdue, priority-sorted')
// 2026-11-24: every create goes through NewTaskModal (TaskRow.tsx), which is
// where the creator's own new task starts seen.
for (const f of ['components/tasks/TasksPanel.tsx', 'components/tasks/ProjectTaskButton.tsx', 'app/(app)/tasks/page.tsx', 'app/(app)/pm/page.tsx'])
  ok(/<NewTaskModal/.test(read(f)) && !/createTask\(/.test(read(f)) && /seenBy: myAssigneeId \? \[myAssigneeId\] : \[\]/.test(row), `${f}: creates through the modal; creator's own new task starts seen`)
const lib = read('lib/tasks.ts')
ok(/need_by, critical, seen_by(, description)?`/.test(lib), 'critical + seen_by ride the top column rung')
const mig = read('db/migrations/133_tasks_critical_seen.sql')
ok(/ADD COLUMN critical boolean NOT NULL DEFAULT false/.test(mig) && /ADD COLUMN seen_by jsonb/.test(mig), '133 adds both columns')
ok(/UPDATE public\.tasks SET seen_by = COALESCE\(assignee_ids/.test(mig), '133 backfills existing tasks as seen (no badge flood)')
ok(/NOTIFY pgrst, 'reload schema'/.test(mig) && /IF NOT EXISTS/.test(mig), '133 idempotent + reloads schema')

console.log('PURE — posting an update re-alerts (task updates round, 2026-11-24)')
const post = taskAfterPost({ assignee_ids: ['m1', 'm2', 'm3'], seen_by: ['m1', 'm2', 'm3'] }, 'm1', [])
ok(post.seen_by.join() === 'm1', `post clears others from seen_by, keeps poster (got ${post.seen_by.join()})`)
ok(post.assignee_ids.join() === 'm1,m2,m3', 'post with no mention leaves assignees alone')
ok(isUnseenBy({ ...post, done_at: null }, 'm2') && !isUnseenBy({ ...post, done_at: null }, 'm1'), 'others light up, the poster does not')
const men = taskAfterPost({ assignee_ids: ['m1'], seen_by: ['m1'] }, 'm1', ['m4', 'm1', 'm4'])
ok(men.assignee_ids.join() === 'm1,m4', `@mention adds a non-assignee once (got ${men.assignee_ids.join()})`)
ok(isUnseenBy({ ...men, done_at: null }, 'm4'), 'the @mentioned person lights up')
ok(taskAfterPost({ assignee_ids: ['m1'], seen_by: ['m1'] }, null, []).seen_by.length === 0, 'unlinked poster → nobody kept as seen')

console.log('PURE — @mention matching + timestamp')
const R = [{ id: 'h', name: 'Hunter Cole' }, { id: 'mr', name: 'Matt Reyes' }, { id: 'mo', name: 'Matt Olsen' }, { id: 'mw', name: 'Matthew Vance' }]
ok(mentionHandle(R[0], R) === 'Hunter' && mentionHandle(R[1], R) === 'Matt Reyes', 'picker inserts first name; full name when the first name is shared')
const ids = (b) => findMentions(b, R).map((m) => m.id).join()
ok(ids('ok @Hunter, done') === 'h' && ids('@hunter') === 'h', 'first name matches, any case, before punctuation')
ok(ids('ask @Matt') === '' && ids('ask @Matt Olsen today') === 'mo', 'ambiguous first name alone matches nobody; the full name does')
ok(ids('@Matthew') === 'mw' && ids('@Hunters') === '', 'a mention must end on a word boundary')
ok(ids('mail hunter@Hunter.com') === '', 'an email address is not a mention')
const m0 = findMentions('hi @Matt Reyes!', R)[0]
ok(m0 && 'hi @Matt Reyes!'.slice(m0.start, m0.end) === '@Matt Reyes', 'the range covers the whole token')
ok(formatCommentAt(new Date(2026, 10, 24, 14, 41, 9).toISOString(), new Date(2026, 10, 24)) === 'Nov 24, 2:41 PM', `timestamp has the time, no seconds (got ${formatCommentAt(new Date(2026, 10, 24, 14, 41, 9).toISOString(), new Date(2026, 10, 24))})`)

console.log('STATIC — composer, post, create-in-modal')
ok(/postTaskUpdate\(\{/.test(row) && !/addComment\(/.test(row), 'the modal posts through postTaskUpdate')
ok(/await addComment\(input\)[\s\S]{0,900}select\('assignee_ids, seen_by'\)[\s\S]{0,900}taskAfterPost\([\s\S]{0,500}\.select\('id'\)[\s\S]{0,120}data\.length === 0/.test(lib), 'postTaskUpdate: addComment, re-read, write, zero rows = failure')
ok(/disabled=\{!body\.trim\(\) \|\| posting\}/.test(row) && /e\.metaKey \|\| e\.ctrlKey/.test(row) && !/Enter to post/.test(row), 'composer: Post button (disabled while empty), Cmd/Ctrl+Enter, plain Enter is a newline')
ok(/formatCommentAt\(c\.created_at\)/.test(row) && /data-mention/.test(row), 'updates show the time; mentions render as tokens')
ok(!fs.existsSync('components/tasks/TitleTextarea.tsx'), 'no second composer left: the inline create field is deleted')

console.log(bad ? `\nFAIL — ${bad} of ${n}` : `\nPASS — ${n} checks`)
process.exit(bad ? 1 : 0)
