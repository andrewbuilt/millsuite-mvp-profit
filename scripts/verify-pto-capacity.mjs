// ============================================================================
// scripts/verify-pto-capacity.mjs — approved PTO really comes off capacity
// ============================================================================
//   npx tsx scripts/verify-pto-capacity.mjs           # pure checks
//   npx tsx scripts/verify-pto-capacity.mjs --live    # + prod before/after (READ-ONLY)
//
// October batch item 7. Approving PTO writes one capacity_overrides row per
// weekday (lib/pto.approvePtoRequest, hours_reduction = the member's daily
// hours). Before this batch /capacity only took PTO off the shop TOTAL (never
// a dept) and /schedule never read the rows at all. Both now go through
// `capacityReductionsByDay`, which takes each day off the member's depts in
// the SAME even split `deptDailyHoursByTeam` added them with. These checks
// pin that symmetry; --live prints the numbers for the real roster without
// writing anything.
// ============================================================================

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub-key-for-verify-script'

const { capacityReductionsByDay, deptDailyHoursByTeam, memberDailyHours } = await import(
  '../lib/shop-rate-setup.ts'
)
const { weekdaysInRange } = await import('../lib/pto.ts')

let bad = 0
const near = (a, b) => Math.abs(a - b) < 1e-9
const ck = (label, actual, expected) => {
  const ok = near(actual, expected)
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` — got ${actual}, wanted ${expected}`}`)
}
const sumDay = (r, date) => Object.values(r[date] || {}).reduce((a, b) => a + b, 0)

const A = 'dept-assembly'
const I = 'dept-install'
const team = [
  { id: 'hunter', name: 'Hunter', billable: true, active: true, dept_assignments: [A] },
  { id: 'evan', name: 'Evan', billable: true, active: true, dept_assignments: [A, I] },
  { id: 'kay', name: 'Kaylin', billable: false, active: true, dept_assignments: [A] },
  { id: 'pt', name: 'Part-timer', billable: true, active: true, hours_per_week: 32, dept_assignments: [I] },
  { id: 'gone', name: 'Former', billable: true, active: false, dept_assignments: [A] },
]
const pto = (member, date, hours = 8, reason = 'PTO') => ({
  override_date: date,
  team_member_id: member,
  department_id: null,
  reason,
  hours_reduction: hours,
})

const daily = deptDailyHoursByTeam(team, 40)
ck('base: assembly = Hunter 8 + Evan 4', daily[A], 12)
ck('base: install = Evan 4 + part-timer 6.4', daily[I], 10.4)

let r = capacityReductionsByDay([pto('hunter', '2026-10-20')], team, 40)
ck('single-dept member: assembly −8', r['2026-10-20'][A], 8)
ck('single-dept member: install untouched', r['2026-10-20'][I] || 0, 0)

r = capacityReductionsByDay([pto('evan', '2026-10-20')], team, 40)
ck('two-dept member: assembly −4 (his share)', r['2026-10-20'][A], 4)
ck('two-dept member: install −4 (his share)', r['2026-10-20'][I], 4)
ck('two-dept member: shop total −8 (his whole day)', sumDay(r, '2026-10-20'), 8)

r = capacityReductionsByDay([pto('kay', '2026-10-20')], team, 40)
ck('non-billable: removes nothing (never counted)', sumDay(r, '2026-10-20'), 0)
r = capacityReductionsByDay([pto('gone', '2026-10-20')], team, 40)
ck('inactive: removes nothing', sumDay(r, '2026-10-20'), 0)
r = capacityReductionsByDay([pto('nobody', '2026-10-20')], team, 40)
ck('off-roster member: removes nothing', sumDay(r, '2026-10-20'), 0)

r = capacityReductionsByDay([pto('pt', '2026-10-20', 0)], team, 40)
ck('hours_reduction 0 → member daily hours (32/5)', r['2026-10-20'][I], 6.4)
r = capacityReductionsByDay([pto('pt', '2026-10-20', 24)], team, 40)
ck('oversized row capped at the member\'s own day', r['2026-10-20'][I], 6.4)

r = capacityReductionsByDay(
  [{ override_date: '2026-11-26', team_member_id: null, department_id: null, reason: 'Thanksgiving', hours_reduction: 0 },
   pto('hunter', '2026-11-26')],
  team,
  40,
)
ck('company holiday: assembly loses its whole day', r['2026-11-26'][A], 12)
ck('holiday + PTO same day: no double subtraction', sumDay(r, '2026-11-26'), 12 + 10.4)

r = capacityReductionsByDay(
  [{ override_date: '2026-10-21', team_member_id: null, department_id: I, reason: 'Van down', hours_reduction: 0 }],
  team,
  40,
)
ck('dept-scoped holiday: only that dept', sumDay(r, '2026-10-21'), 10.4)

r = capacityReductionsByDay([pto('hunter', '2026-10-20', 8, 'Reassigned to Install')], team, 40)
ck('"Reassigned to" rows remove nothing', sumDay(r, '2026-10-20'), 0)

// A full approved week, written exactly the way approvePtoRequest writes it.
const hunter = team[0]
const days = weekdaysInRange('2026-10-19', '2026-10-25')
ck('approve writes 5 weekday rows for a Mon–Sun request', days.length, 5)
r = capacityReductionsByDay(
  days.map((d) => pto('hunter', d, memberDailyHours(hunter, 40))),
  team,
  40,
)
const weekOut = days.reduce((s, d) => s + (r[d]?.[A] || 0), 0)
ck('a PTO week: assembly weekly cap 60 → 20 (−Hunter\'s 40)', daily[A] * 5 - weekOut, 20)

// ── Live, read-only ──────────────────────────────────────────────────────────
if (process.argv.includes('--live')) {
  const fs = await import('node:fs')
  const { createClient } = await import('@supabase/supabase-js')
  const env = Object.fromEntries(
    fs
      .readFileSync('.env.local', 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=')
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]
      }),
  )
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
  const { data: orgs, error: orgErr } = await sb
    .from('orgs')
    .select('id, name, team_members, billable_hours_inputs')
  if (orgErr) console.log('orgs read failed:', orgErr.message)
  const { data: depts } = await sb.from('departments').select('id, name, org_id').eq('active', true)
  for (const org of orgs || []) {
    // Same defaults normalizeTeamMembers applies (billable is opt-out).
    const t = (Array.isArray(org.team_members) ? org.team_members : []).map((m) => ({
      ...m,
      billable: m.billable !== false,
      dept_assignments: Array.isArray(m.dept_assignments) ? m.dept_assignments : [],
    }))
    const billable = t.filter((m) => m.billable && m.active !== false && m.dept_assignments.length)
    if (billable.length === 0) continue
    const hpw = Number(org.billable_hours_inputs?.hrs_per_week) || 40
    const base = deptDailyHoursByTeam(t, hpw)
    const deptName = Object.fromEntries((depts || []).filter((d) => d.org_id === org.id).map((d) => [d.id, d.name]))
    console.log(`\n── ${org.name} (live, read-only) ──`)

    // 1) Synthetic: one week off for the first billable member.
    const m = billable[0]
    const wk = weekdaysInRange('2026-10-19', '2026-10-23')
    const sim = capacityReductionsByDay(
      wk.map((d) => pto(m.id, d, memberDailyHours(m, hpw))),
      t,
      hpw,
    )
    console.log(`If ${m.name} (${memberDailyHours(m, hpw)}h/day) takes Oct 19–23 off:`)
    for (const dId of m.dept_assignments) {
      const out = wk.reduce((s, d) => s + (sim[d]?.[dId] || 0), 0)
      const before = (base[dId] || 0) * 5
      console.log(`  ${deptName[dId] || dId}: ${before.toFixed(1)}h/wk → ${(before - out).toFixed(1)}h/wk`)
    }

    // 2) Real: approved time off already on the books, next 8 weeks.
    const today = new Date().toISOString().slice(0, 10)
    const until = new Date(Date.now() + 56 * 86400000).toISOString().slice(0, 10)
    const { data: ovs } = await sb
      .from('capacity_overrides')
      .select('override_date, team_member_id, department_id, reason, hours_reduction')
      .eq('org_id', org.id)
      .gte('override_date', today)
      .lte('override_date', until)
    const real = capacityReductionsByDay(ovs || [], t, hpw)
    const dates = Object.keys(real).sort()
    console.log(`On the books (${(ovs || []).length} override rows, next 8 weeks):`)
    if (dates.length === 0) console.log('  none')
    for (const d of dates) {
      const parts = Object.entries(real[d]).map(
        ([dId, h]) => `${deptName[dId] || dId} ${(base[dId] || 0).toFixed(1)}→${((base[dId] || 0) - h).toFixed(1)}h`,
      )
      console.log(`  ${d}: ${parts.join(' · ')}`)
    }
  }
}

console.log(bad === 0 ? '\nALL PASS' : `\n${bad} FAILED`)
process.exit(bad === 0 ? 0 : 1)
