// ============================================================================
// verify-task-critical-seen.mjs — Critical + unseen badges + task modal (133)
// ============================================================================
// Run: npx tsx scripts/verify-task-critical-seen.mjs     (pure + static)
// ============================================================================
import fs from 'fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub'
const { comparePriority, groupTasks, isUnseenBy, OFFERED_PICKS } = await import('../lib/tasks.ts')
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
for (const f of ['components/tasks/TasksPanel.tsx', 'components/tasks/ProjectTaskButton.tsx', 'app/(app)/tasks/page.tsx', 'app/(app)/pm/page.tsx'])
  ok(/seenBy: /.test(read(f)), `${f}: creator's own new task starts seen`)
const lib = read('lib/tasks.ts')
ok(/need_by, critical, seen_by(, description)?`/.test(lib), 'critical + seen_by ride the top column rung')
const mig = read('db/migrations/133_tasks_critical_seen.sql')
ok(/ADD COLUMN critical boolean NOT NULL DEFAULT false/.test(mig) && /ADD COLUMN seen_by jsonb/.test(mig), '133 adds both columns')
ok(/UPDATE public\.tasks SET seen_by = COALESCE\(assignee_ids/.test(mig), '133 backfills existing tasks as seen (no badge flood)')
ok(/NOTIFY pgrst, 'reload schema'/.test(mig) && /IF NOT EXISTS/.test(mig), '133 idempotent + reloads schema')

console.log(bad ? `\nFAIL — ${bad} of ${n}` : `\nPASS — ${n} checks`)
process.exit(bad ? 1 : 0)
