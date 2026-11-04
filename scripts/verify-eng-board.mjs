// ============================================================================
// verify-eng-board.mjs — hand-footed proofs of the engineering board's packing
// (lib/eng-board-math) + wiring greps for /engineering.
// Run: npx tsx scripts/verify-eng-board.mjs
// Dates: 2026-11-02 is a Monday.
// ============================================================================
import fs from 'fs'
import { packLane, workdaysFrom, evenDivide, eatDivisions, priorityBetween, divisionsMatch } from '../lib/eng-board-math.ts'

let pass = 0, fail = 0
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.log('  ✗', msg) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const MON = '2026-11-02', TUE = '2026-11-03', WED = '2026-11-04', THU = '2026-11-05', FRI = '2026-11-06', MON2 = '2026-11-09'
const lane = (over = {}) => ({ memberId: 'h', dailyHours: 8, outByDay: {}, trackedByDay: {}, ...over })
const strip = (id, est, tracked = 0, extra = {}) => ({ projectId: id, memberId: 'h', priority: 1, estHours: est, trackedHours: tracked, divisions: null, firmDate: null, ...extra })
const H = (from) => workdaysFrom(from, 40)

console.log('Packing')
{
  const r = packLane(lane(), [strip('k', 24)], MON, H(MON)).strips[0]
  ok(eq(r.days, { [MON]: 8, [TUE]: 8, [WED]: 8 }) && r.end === WED, '24h job at 8h/day spans Mon–Wed (by Wed)')
}
{
  const r = packLane(lane(), [strip('k', 24, 8)], MON, H(MON)).strips[0]
  ok(r.remaining === 16 && eq(r.days, { [MON]: 8, [TUE]: 8 }), '8h tracked on an earlier day → 16h over Mon–Tue')
}
{
  const r = packLane(lane({ trackedByDay: { [MON]: 8 } }), [strip('k', 24, 8)], MON, H(MON)).strips[0]
  ok(eq(r.days, { [TUE]: 8, [WED]: 8 }), '8h tracked TODAY → today is spent, 16h over Tue–Wed')
}
{
  const p = packLane(lane(), [strip('a', 12, 0, { priority: 1 }), strip('b', 10, 0, { priority: 2 })], MON, H(MON))
  const [a, b] = p.strips
  ok(eq(a.days, { [MON]: 8, [TUE]: 4 }) && eq(b.days, { [TUE]: 4, [WED]: 6 }), 'priority order: A 12h then B 10h (B by Wed)')
  ok(p.load[TUE].planned === 8 && p.load[WED].planned === 6, 'day headers sum both strips (Tue 8/8, Wed 6/8)')
}
{
  const p = packLane(lane(), [strip('a', 12, 0, { priority: 2 }), strip('b', 10, 0, { priority: 1 })], MON, H(MON))
  ok(p.strips[0].projectId === 'b' && p.strips[0].end === TUE, 'reorder: B first now finishes Tue')
}
{
  const r = packLane(lane({ outByDay: { [WED]: 8 } }), [strip('k', 24)], MON, H(MON)).strips[0]
  ok(eq(r.days, { [MON]: 8, [TUE]: 8, [THU]: 8 }), 'a day off (PTO/holiday) is skipped')
}
{
  const r = packLane(lane({ outByDay: { [TUE]: 4 } }), [strip('k', 16)], MON, H(MON)).strips[0]
  ok(eq(r.days, { [MON]: 8, [TUE]: 4, [WED]: 4 }), 'half-day PTO packs 4h that day')
}
{
  const r = packLane(lane(), [strip('k', 40)], THU, H(THU)).strips[0]
  ok(r.days[FRI] === 8 && r.days[MON2] === 8 && !('2026-11-07' in r.days), 'weekends skipped')
}

console.log('Divide')
{
  ok(eq(evenDivide(16, [TUE, WED, THU]).map((d) => d.hours), [5.5, 5.5, 5]), 'even split 16h over 3 days = 5.5 / 5.5 / 5')
  const div = [{ date: TUE, hours: 5.5 }, { date: WED, hours: 5.5 }, { date: THU, hours: 5 }]
  const p = packLane(lane(), [strip('kinser', 16, 0, { priority: 2, divisions: div }), strip('other', 8, 0, { priority: 1 })], TUE, H(TUE))
  const k = p.strips.find((s) => s.projectId === 'kinser'), o = p.strips.find((s) => s.projectId === 'other')
  ok(eq(k.days, { [TUE]: 5.5, [WED]: 5.5, [THU]: 5 }), 'divided Kinser keeps its days')
  ok(eq(o.days, { [TUE]: 2.5, [WED]: 2.5, [THU]: 3 }) && o.end === THU, 'another strip fits beside it (2.5 / 2.5 / 3)')
  ok([TUE, WED, THU].every((d) => p.load[d].planned === 8), 'day headers read 8/8 each')
  const eaten = packLane(lane(), [strip('kinser', 16, 3, { divisions: div })], TUE, H(TUE)).strips[0]
  ok(eq(eaten.days, { [TUE]: 2.5, [WED]: 5.5, [THU]: 5 }), 'tracked time eats a divided strip from the left')
  const rolled = eatDivisions([{ date: MON, hours: 4 }, { date: TUE, hours: 4 }], 8, TUE)
  ok(eq(rolled.days, [{ date: TUE, hours: 4 }]) && rolled.rollForward === 4 && rolled.after === TUE, 'unworked past day rolls forward')
  const r2 = packLane(lane(), [strip('x', 8, 0, { divisions: [{ date: MON, hours: 4 }, { date: TUE, hours: 4 }] })], TUE, H(TUE)).strips[0]
  ok(eq(r2.days, { [TUE]: 4, [WED]: 4 }), '…and lands after the last divided day')
  ok(divisionsMatch(div, 16) && !divisionsMatch(div, 17), 'sum gate')
  ok(eq(evenDivide(14.6, [TUE, WED, THU]).map((d) => d.hours), [5, 5, 4.6]), 'even split foots exactly (14.6 → 5 / 5 / 4.6)')
  const typed = packLane(lane(), [strip('x', 16.2, 0, { divisions: div })], TUE, H(TUE)).strips[0]
  ok(eq(Object.fromEntries(Object.entries(typed.days).map(([k, v]) => [k, Math.round(v * 100) / 100])), { [TUE]: 5.5, [WED]: 5.5, [THU]: 5.2 }) && typed.end === THU, 'a sub-half-hour gate difference lands on the last day, no sliver')
}

console.log('Firm dates')
{
  const r = packLane(lane(), [strip('t', 24, 0, { firmDate: TUE })], MON, H(MON)).strips[0]
  ok(r.atRisk && r.end === WED, 'packs to Wed against a firm Tue → at risk')
  const r2 = packLane(lane(), [strip('t', 24, 0, { firmDate: WED })], MON, H(MON)).strips[0]
  ok(!r2.atRisk, 'makes a firm Wed → not at risk')
  const r3 = packLane(lane(), [strip('t', 24, 24, { firmDate: MON })], MON, H(MON)).strips[0]
  ok(!r3.atRisk && r3.remaining === 0, 'finished work is never at risk')
}

console.log('Rail')
ok(priorityBetween(1, 2) === 1.5 && priorityBetween(null, 1) === 0 && priorityBetween(3, null) === 4, 'priorityBetween')

console.log('Wiring')
const read = (p) => fs.readFileSync(p, 'utf8')
const page = read('app/(app)/engineering/page.tsx')
ok(/clockIn\(/.test(page) && /from '@\/lib\/worker-time'/.test(page), 'timer runs lib/worker-time clockIn (same as /me)')
ok(read('lib/reserved-slugs.ts').includes("'engineering'"), "'engineering' reserved")
ok(read('components/top-nav.tsx').includes("href: '/engineering'"), 'nav: Projects ▾ Engineering')
ok(/loadProjectsLaborHours/.test(read('lib/eng-board.ts')) && /byDept\.eng/.test(read('lib/eng-board.ts')), 'est eng hours come from the estimate rollup')
ok(read('scripts/rls-audit.mjs').includes('eng_assignments'), 'rls-audit covers eng_assignments')
ok(/from '@\/lib\/schedule-style'/.test(read('app/(app)/schedule/page.tsx')) && /from '@\/lib\/schedule-style'/.test(read('components/engineering/EngBoard.tsx')), 'both boards share lib/schedule-style tokens')
const mig = read('db/migrations/129_eng_assignments.sql')
ok(/IF NOT EXISTS/.test(mig) && /ENABLE ROW LEVEL SECURITY/.test(mig) && /NOTIFY pgrst/.test(mig), '129 idempotent + RLS + reload')

console.log(`\n${fail ? '❌ FAIL' : 'PASS'} — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
