// ============================================================================
// verify-capacity-dept-sums.mjs — a month's dept rows add up to its booked line
// ============================================================================
//   npx tsx scripts/verify-capacity-dept-sums.mjs          # pure + static
//   npx tsx scripts/verify-capacity-dept-sums.mjs --live   # + prod, READ-ONLY
// Andrew 2026-11-04: Nov showed Eng 187% · CNC 294% · Assembly 357% · Finish
// 286% under a 95% month. Split slices carried the whole job's dept hours.
// ============================================================================
import fs from 'fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub'
const { sliceDeptHours, scaleDeptHours, mergeDeptHours, sumDeptHours } = await import('../lib/capacity-math.ts')
let bad = 0, n = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.log('  ✗ ' + m) } }
const near = (a, b) => Math.abs(a - b) < 0.01

console.log('PURE')
const kinser = { hours_allocated: 315, department_hours: { eng: 200, cnc: 146, asm: 600 } } // 946 whole job
const s1 = sliceDeptHours(kinser)
ok(near(sumDeptHours(s1), 315), 'a split slice\'s dept hours sum to ITS hours (Kinser 946 → 315)')
ok(near(s1.eng / s1.asm, 200 / 600), 'the mix is kept')
ok(JSON.stringify(sliceDeptHours({ hours_allocated: 40, department_hours: { a: 30, b: 10 } })) === JSON.stringify({ a: 30, b: 10 }), 'a consistent row is untouched')
ok(Object.keys(sliceDeptHours({ hours_allocated: 40, department_hours: null })).length === 0, 'no map → no dept hours')
const half = scaleDeptHours({ a: 100, b: 50 }, 75)
ok(near(half.a, 50) && near(half.b, 25), 'even split: each slice gets its share of the mix')
const merged = mergeDeptHours([kinser, { ...kinser }, { hours_allocated: 316, department_hours: kinser.department_hours }])
ok(near(sumDeptHours(merged), 946), 'remove-split: merged map = the whole job again')

console.log('STATIC')
const cap = fs.readFileSync('app/(app)/capacity/page.tsx', 'utf8')
ok(/const sliceDepts = sliceDeptHours\(alloc\)/.test(cap), 'month dept rows read the slice\'s dept hours')
ok(/departmentHours: sliceDeptHours\(a\)/.test(cap) && /sliceDeptHours\(allocation\)\[d\.id\]/.test(cap), 'cards + side pane read the slice too')
ok(/scaleDeptHours\(deptHours, evenHrs\)/.test(cap), 'even split writes each slice\'s share')
ok(/department_hours: mergeDeptHours\(groupAllocs\)/.test(cap), 'remove-split merges dept hours')
ok(/A split job refreshes as a GROUP/.test(cap), 'refresh on a split refreshes the group by share')
ok(!/Object\.entries\(alloc\.department_hours\)/.test(cap), 'no raw department_hours read left in the month math')

if (process.argv.includes('--live')) {
  console.log('LIVE (read-only)')
  const { createClient } = await import('@supabase/supabase-js')
  const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')] }))
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: al } = await sb.from('project_month_allocations').select('org_id, month_date, hours_allocated, department_hours, projects(stage, orgs(name))').gte('month_date', '2026-10-01')
  const months = {}
  let raw = 0
  for (const a of al || []) {
    if (['new_lead', 'fifty_fifty', 'ninety_percent'].includes(a.projects?.stage)) continue
    const k = `${a.projects?.orgs?.name || a.org_id} ${a.month_date.slice(0, 7)}`
    const m = (months[k] ||= { booked: 0, deptRaw: 0, deptFixed: 0, hasMap: true })
    m.booked += Number(a.hours_allocated) || 0
    m.deptRaw += sumDeptHours(a.department_hours)
    m.deptFixed += sumDeptHours(sliceDeptHours(a))
    if (!a.department_hours || sumDeptHours(a.department_hours) <= 0) m.hasMap = false
    if (Math.abs(sumDeptHours(a.department_hours) - a.hours_allocated) > 0.5 && sumDeptHours(a.department_hours) > 0) raw++
  }
  console.log(`  ${raw} stored rows still carry a mismatched map (read-corrected; data untouched)`)
  for (const [k, m] of Object.entries(months).sort()) {
    if (k.startsWith('Built')) console.log(`  ${k}: booked ${Math.round(m.booked)}h · dept rows before ${Math.round(m.deptRaw)}h → now ${Math.round(m.deptFixed)}h`)
    if (m.hasMap) ok(Math.abs(m.deptFixed - m.booked) < 1, `${k}: dept rows add up to the booked line`)
  }
}
console.log(bad ? `\nFAIL — ${bad} of ${n}` : `\nPASS — ${n} checks`)
process.exit(bad ? 1 : 0)
