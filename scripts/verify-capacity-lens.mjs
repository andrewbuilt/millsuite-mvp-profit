// verify-capacity-lens.mjs — Nov batch 2 C (static; the page math is inline)
// Run: node scripts/verify-capacity-lens.mjs
import fs from 'fs'
const s = fs.readFileSync('app/(app)/capacity/page.tsx', 'utf8')
let bad = 0, n = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m) } }
ok(/if \(deptLens\) totalCapacity = deptCapacity\[deptLens\]/.test(s), 'lens swaps capacity for the dept\'s')
ok(/const soldAllocated = deptLens \? lensSold : shopSold/.test(s), 'lens swaps sold hours for the dept\'s')
ok(/hours: deptLens \? Number\(a\.department_hours\?\.\[deptLens\]\)/.test(s), 'cards show the dept\'s hours under a lens')
ok(/!deptLens \|\| \(Number\(a\.department_hours\?\.\[deptLens\]\) \|\| 0\) > 0/.test(s), 'cards with no hours in the dept drop out')
ok(/deptLens, trackedByMonth\]\)/.test(s), 'months memo recomputes on lens + tracked')
ok(/const deptChips = departments\.map/.test(s) && /Next 3 mo/.test(s), 'chips show each dept\'s next-3-months %')
ok(/from\('time_entries'\)[\s\S]*?\.eq\('org_id', org!\.id\)/.test(s) && /tracked \{Math\.round\(m\.trackedHours\)\} of booked/.test(s), 'tracked vs booked on current/past months')
ok(/m\.isPastOrCurrent &&/.test(s), 'future months show no tracked bar')
ok(/totalHours=\{Object\.values\(m\.deptAllocated\)/.test(s), 'all-dept strip stays whole-shop')
ok(/\{m\.effectiveWorkingDays\}d/.test(s), '#1 working days on the month header')
console.log(bad ? `FAIL — ${bad} of ${n}` : `PASS — ${n} checks`)
process.exit(bad ? 1 : 0)
