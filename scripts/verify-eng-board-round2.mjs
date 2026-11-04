// ============================================================================
// verify-eng-board-round2.mjs — engineering board round 2 (STATE 2026-11-05)
// ============================================================================
// Run: npx tsx scripts/verify-eng-board-round2.mjs     (no DB, no network)
//
//   1. OVER: tracked ≥ budget never removes a strip — it stays, one day on
//      today, flagged over with the right "Nh over".
//   2. BOARD HOURS: a strip burns against board_hours (total incl. tracked),
//      not the estimate; the pool keeps the remainder (Batia 163.7 → 40 on
//      the board, 123.7 in the pool); null = v1 behaviour exactly.
//   3. PINNED START: a sideways-dragged strip packs from its start day at the
//      full daily hours, OVERLAPPING another strip (deliberate overbooking —
//      the day header goes over); NOTHING auto-moves.
//   4. Static: migration 131 additive + idempotent, Engineering done is the
//      only exit (done assignments filtered), the board wires both axes.
// ============================================================================

import fs from 'fs'
import path from 'path'
import { packLane, workdaysFrom, poolRemainder, stripBudget, shiftWorkdays } from '../lib/eng-board-math.ts'

let pass = 0
let fail = 0
const ok = (label, cond, detail) => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${!cond && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''}`)
}

// A fixed Monday so the arithmetic is by hand.
const today = '2026-11-09'
const horizon = workdaysFrom(today, 40)
const [mon, tue, wed, thu, fri] = horizon
const lane = { memberId: 'h', dailyHours: 8, outByDay: {}, trackedByDay: {} }
const strip = (projectId, priority, estHours, trackedHours, extra = {}) => ({
  projectId, memberId: 'h', priority, estHours, trackedHours, divisions: null, firmDate: null, ...extra,
})

// ── 1. OVER ────────────────────────────────────────────────────────────────
{
  const L = packLane(lane, [strip('murtagh', 1, 2, 5), strip('chancey', 2, 16, 0)], today, horizon)
  const m = L.strips.find((s) => s.projectId === 'murtagh')
  ok('over: Murtagh (2h est, 5h tracked) is still a strip', !!m)
  ok('over: flagged over, 3h over, 0 remaining', m.over && Math.abs(m.overBy - 3) < 1e-9 && m.remaining === 0, m)
  ok('over: one day wide, on today', m.start === today && m.end === today)
  ok('over: plans no hours (the next strip starts today at full day)', Object.keys(m.days).length === 0 && L.strips[1].days[mon] === 8)
  const exact = packLane(lane, [strip('x', 1, 4, 4)], today, horizon).strips[0]
  ok('over: exactly at budget reads over (at budget), still on the board', exact.over && exact.overBy === 0 && exact.start === today)
  const not = packLane(lane, [strip('y', 1, 4, 3.5)], today, horizon).strips[0]
  ok('not over with 0.5h left', !not.over && not.remaining === 0.5)
}

// ── 2. BOARD HOURS ─────────────────────────────────────────────────────────
{
  ok('budget: null board hours = the estimate', stripBudget(163.7, null) === 163.7)
  ok('budget: board hours win', stripBudget(163.7, 40) === 40)
  const L = packLane(lane, [strip('batia', 1, 163.7, 0, { boardHours: 40 })], today, horizon)
  const b = L.strips[0]
  ok('Batia 40h on the board → 40h strip, Mon–Fri at 8h, drawings by Friday', b.remaining === 40 && b.start === mon && b.end === fri && b.budget === 40, b)
  ok('pool keeps 163.7 − 40 = 123.7h', Math.abs(poolRemainder(163.7, 0, 40) - 123.7) < 1e-9)
  ok('pool after 10h tracked on a 40h budget is still 123.7h', Math.abs(poolRemainder(163.7, 10, 40) - 123.7) < 1e-9)
  ok('pool is empty when the board budget is the estimate (null)', poolRemainder(163.7, 0, null) === 0)
  const burned = packLane(lane, [strip('batia', 1, 163.7, 12, { boardHours: 40 })], today, horizon).strips[0]
  ok('tracked burns against board hours: 40 − 12 = 28h left', burned.remaining === 28)
  const over = packLane(lane, [strip('batia', 1, 163.7, 45, { boardHours: 40 })], today, horizon).strips[0]
  ok('past board hours → over by 5h (even though the estimate has 118h left)', over.over && Math.abs(over.overBy - 5) < 1e-9)
  // v1 parity: no board hours, no start → identical to before.
  const v1 = packLane(lane, [strip('k', 1, 24, 8)], today, horizon).strips[0]
  ok('v1 parity: 24h est, 8h tracked → 16h over Mon–Tue', v1.remaining === 16 && v1.start === mon && v1.end === tue && !v1.pinned && !v1.over)
}

// ── 3. PINNED START (horizontal drag) ──────────────────────────────────────
{
  // Chancey auto-packs Mon–Wed (24h). Murtagh (8h) dragged BACK onto Tue,
  // over Chancey: both render, Tuesday reads 16/8, Chancey doesn't move.
  const L = packLane(lane, [strip('chancey', 1, 24, 0), strip('murtagh', 2, 8, 0, { startDate: tue })], today, horizon)
  const c = L.strips.find((s) => s.projectId === 'chancey')
  const m = L.strips.find((s) => s.projectId === 'murtagh')
  ok('pinned: Murtagh sits on Tuesday, 8h, marked placed', m.pinned && m.start === tue && m.end === tue && m.days[tue] === 8, m)
  ok('pinned: nothing auto-moves — Chancey still Mon–Wed at 8h', c.days[mon] === 8 && c.days[tue] === 8 && c.days[wed] === 8 && !c.days[thu], c.days)
  ok('pinned: Tuesday header reads 16/8 (red)', L.load[tue].planned === 16 && L.load[tue].cap === 8)
  const later = packLane(lane, [strip('m2', 1, 8, 0, { startDate: tue }), strip('c2', 2, 24, 0)], today, horizon)
  ok('pinned: an auto strip BEHIND it in priority still packs from today (not shoved)', later.strips.find((s) => s.projectId === 'c2').start === mon)
  // Deliberate overbooking: two pinned strips on the same day both render.
  const O = packLane(lane, [strip('a', 1, 8, 0, { startDate: fri }), strip('b', 2, 8, 0, { startDate: fri })], today, horizon)
  ok('overbooking: two strips pinned to Friday both keep it', O.strips.every((s) => s.days[fri] === 8))
  ok('overbooking: Friday header reads 16/8 (red), nothing moved', O.load[fri].planned === 16 && O.load[fri].cap === 8)
  const past = packLane(lane, [strip('p', 1, 8, 0, { startDate: '2026-11-02' })], today, horizon).strips[0]
  ok('a pinned start in the past places from today', past.start === today)
  const div = packLane(lane, [strip('d', 1, 8, 0, { startDate: fri, divisions: [{ date: wed, hours: 8 }] })], today, horizon).strips[0]
  ok('a divided plan ignores start_date (its days are its placement)', !div.pinned && div.days[wed] === 8)
  ok('shiftWorkdays skips the weekend (Fri +1 = Mon, Mon −1 = Fri)', shiftWorkdays(fri, 1) === horizon[5] && shiftWorkdays(horizon[5], -1) === fri)
}

// ── 4. Static ──────────────────────────────────────────────────────────────
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const mig = read('db/migrations/131_eng_board_round2.sql')
ok('131: board_hours, start_date, done_at — all IF NOT EXISTS, schema reload', ['board_hours', 'start_date', 'done_at'].every((c) => new RegExp(`ADD COLUMN IF NOT EXISTS ${c}`).test(mig)) && /NOTIFY pgrst, 'reload schema'/.test(mig))
ok('131: no backfill / UPDATE (null = v1, nothing moves)', !/\bUPDATE\b/i.test(mig.replace(/--.*$/gm, '')))
const board = read('components/engineering/EngBoard.tsx')
ok('board: done assignments are off the lanes (!a.done_at)', /filter\(\(a\) => !a\.done_at && engineerIds/.test(board))
ok('board: strips no longer leave at 0h (no "✓ done" on a zero-remaining chip)', !/s\.remaining <= 0\.05/.test(board))
ok('board: a strip drop carries row + day column (both axes)', /onDrop\(posAt\(e\.clientX, e\.clientY\)\)/.test(board) && /patch\.priority = priorityBetween/.test(board) && /patch\.start_date =/.test(board))
ok('board: Engineering done button wired to api.setDone', /Engineering done/.test(board) && /api\.setDone\(/.test(board))
const lib = read('lib/eng-board.ts')
ok('lib: setEngineeringDone logs a project_events row', /eventType: args\.done \? 'engineering_done'/.test(lib))

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
