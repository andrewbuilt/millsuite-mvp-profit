// verify-capacity-round2.mjs — capacity round 2 (2026-11-04), static wiring
// Run: node scripts/verify-capacity-round2.mjs   (the math is proven in
// verify-pto-capacity.mjs's "128" block; this proves the pages use it)
import fs from 'fs'
const read = (f) => fs.readFileSync(f, 'utf8')
let bad = 0, n = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m) } }
const cap = read('app/(app)/capacity/page.tsx')
const sch = read('app/(app)/schedule/page.tsx')
const mig = read('db/migrations/128_dept_counts_in_capacity.sql')
ok(/ADD COLUMN counts_in_capacity boolean NOT NULL DEFAULT true/.test(mig) && /IF NOT EXISTS/.test(mig) && /NOTIFY pgrst/.test(mig), '128 adds the flag, first-run backfill only')
ok(/allDepartments\.filter\(\(d\) => d\.counts_in_capacity !== false\)/.test(cap), '/capacity reads counting depts only')
ok(/deptDailyHoursByTeam\(team, orgHrsPerWeek, excludedDepts, trackedMix\)/.test(cap), '/capacity splits members over counting depts (learned split fed in)')
ok((cap.match(/capacityReductionsByDay\([^)]*excludedDepts, trackedMix\)/g) || []).length === 2, '/capacity reductions use the same split (both calls)')
ok(/if \(excludedDepts\.has\(deptId\)\)/.test(cap), 'management hours never count as load')
ok(/deptDailyHoursByTeam\(setup\.team, orgHpw, excludedDeptsRef\.current, mixMinutes\)/.test(sch) && /excludedDeptsRef\.current, mixMinutes\)$/m.test(sch.split('capacityReductionsByDay(')[1]?.split('\n')[0] || ''), '/schedule uses the same exclusion')
ok(!/deptLens|setDeptLens|Next 3 mo/.test(cap), 'the top dept chips are gone')
ok(/setOpenMonths/.test(cap) && /openMonths\.has\(m\.month\) && \(/.test(cap), 'month headers collapse/expand, several at once')
ok(/departments\.map\(\(d\) => \{\s*const cap = m\.deptCapacity\[d\.id\]/.test(cap), 'expanded header = one row per dept, from the month\'s own dept capacity')
ok(/tracked \{Math\.round\(m\.trackedHours\)\} of booked/.test(cap), 'collapsed header keeps tracked vs booked')
ok(/if \(seq !== loadSeq\.current\) return/.test(cap) && /const \[tracked, mixMinutes\] = await Promise\.all\(\[\s*loadTrackedByMonth\(practice\)/.test(cap), 'one batched load, stale loads dropped (no partial paint)')
ok(/\{m\.effectiveWorkingDays\}d/.test(cap), 'working days on the header')
for (const f of ['app/(app)/pm/page.tsx', 'app/(app)/tasks/page.tsx', 'components/tasks/ProjectTaskButton.tsx', 'components/tasks/TasksPanel.tsx'])
  ok(/<TitleTextarea[\s\S]{0,900}?What needs doing/.test(read(f)), `new-task field autogrows: ${f}`)
console.log(bad ? `FAIL — ${bad} of ${n}` : `PASS — ${n} checks`)
process.exit(bad ? 1 : 0)
