// ============================================================================
// verify-dept-mix.mjs — the LEARNED DEPARTMENT SPLIT (STATE 2026-11-06 item 3)
// ============================================================================
// Run: npx tsx scripts/verify-dept-mix.mjs     (no DB, no network)
//
// ⛔ ANDREW'S INVARIANT: a member's hours are NEVER counted twice — their
// dept fractions sum to exactly 1 (pinned, learned, even alike), so
// Σ(dept capacity) = Σ(member hours) to the minute, and switching the split
// on can only MOVE hours between departments. Asserted:
//   A. the split itself: pinned > learned (≥ 20h) > even, the threshold,
//      excluded depts + unassigned depts ignored, basis points sum to 10,000
//   B. per member, every source: Σ fractions = 1 exactly-ish (1e-12), Σ bp = 10,000
//   C. shop-wide, fuzzed rosters: total capacity with the learned split ===
//      total with the even split === Σ member hours (to well under a minute),
//      and PTO subtraction uses the same split (a full day off removes
//      exactly what that member added, dept by dept)
//   D. static: /capacity + /schedule feed the tracked minutes to BOTH the
//      capacity and the PTO call; /team can save the pin (team-merge)
// ============================================================================

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'stub-key-for-verify-script'

import fs from 'fs'
import path from 'path'
const { memberDeptMix, largestRemainder, MIX_GRID, LEARN_MIN_HOURS } = await import('../lib/dept-mix.ts')
const { deptDailyHoursByTeam, capacityReductionsByDay, memberDailyHours, memberMix } = await import('../lib/shop-rate-setup.ts')

let pass = 0
let fail = 0
const ok = (label, cond, detail) => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}${!cond && detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''}`)
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps
const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0)

const CNC = 'cnc', ENG = 'eng', ASM = 'asm', INS = 'ins', MGMT = 'mgmt'
const member = (id, depts, extra = {}) => ({
  id, name: id, annual_comp: 0, billable: true, dept_assignments: depts, tasks_enabled: true, active: true, user_id: `u-${id}`, ...extra,
})

// ── A. the split ───────────────────────────────────────────────────────────
{
  const hunter = member('hunter', [CNC, ENG])
  const learned = memberDeptMix(hunter, [CNC, ENG], { [CNC]: 64 * 60, [ENG]: 36 * 60 })
  ok('learned: Hunter 64h CNC / 36h Eng → 64% / 36%', learned.source === 'learned' && learned.shares[0][1] === 0.64 && learned.shares[1][1] === 0.36, learned)
  ok('learned: 8h day → CNC 5.12h + Eng 2.88h = 8h', near(8 * 0.64, 5.12) && near(8 * 0.64 + 8 * 0.36, 8))
  const thin = memberDeptMix(hunter, [CNC, ENG], { [CNC]: (LEARN_MIN_HOURS - 1) * 60 })
  ok(`under ${LEARN_MIN_HOURS}h tracked → even, says why`, thin.source === 'even' && thin.shares.every(([, f]) => f === 0.5) && near(thin.trackedHours, LEARN_MIN_HOURS - 1), thin)
  const edge = memberDeptMix(hunter, [CNC, ENG], { [CNC]: LEARN_MIN_HOURS * 60 })
  ok(`exactly ${LEARN_MIN_HOURS}h → learned (all CNC → CNC 100%, Eng 0%)`, edge.source === 'learned' && edge.shares[0][1] === 1 && edge.shares[1][1] === 0, edge)
  const pinned = memberDeptMix({ ...hunter, dept_split: { [ENG]: 100 } }, [CNC, ENG], { [CNC]: 100 * 60 })
  ok('pinned wins over learned ("Eng 100%")', pinned.source === 'pinned' && pinned.shares[0][1] === 0 && pinned.shares[1][1] === 1, pinned)
  const unpinned = memberDeptMix({ ...hunter, dept_split: null }, [CNC, ENG], { [CNC]: 100 * 60 })
  ok('unpin → learning resumes', unpinned.source === 'learned')
  const pinOddSum = memberDeptMix({ ...hunter, dept_split: { [CNC]: 30, [ENG]: 30 } }, [CNC, ENG])
  ok('a pin that doesn\'t sum to 100 is normalised (30/30 → 50/50)', pinOddSum.shares.every(([, f]) => f === 0.5))
  const stalePin = memberDeptMix({ ...hunter, dept_split: { [ASM]: 100 } }, [CNC, ENG])
  ok('a pin only on depts they\'re no longer in → ignored (even)', stalePin.source === 'even')
  const offRoster = memberDeptMix(hunter, [CNC, ENG], { [CNC]: 30 * 60, [INS]: 500 * 60 })
  ok('tracked time in a dept they aren\'t assigned to is ignored (Install 500h)', offRoster.source === 'learned' && offRoster.shares[0][1] === 1 && near(offRoster.trackedHours, 30))
  const boss = member('boss', [ENG, MGMT])
  const ex = memberMix(boss, new Set([MGMT]), { boss: { [ENG]: 10 * 60, [MGMT]: 200 * 60 } })
  ok('management (excluded) takes no share and its hours don\'t count toward learning', ex.shares.length === 1 && ex.shares[0][0] === ENG && ex.shares[0][1] === 1 && near(ex.trackedHours, 10), ex)
  ok('no depts → no shares', memberDeptMix(member('x', []), []).shares.length === 0)
  const thirds = largestRemainder([1, 1, 1])
  ok('largest remainder: thirds → 3334/3333/3333, Σ 10,000', thirds.join() === '3334,3333,3333')
  ok('even stays 1/n to the bit (pre-change behaviour)', memberDeptMix(member('t', [CNC, ENG, ASM]), [CNC, ENG, ASM]).shares.every(([, f]) => f === 1 / 3))
}

// ── B + C. invariant, fuzzed ───────────────────────────────────────────────
let seed = 7
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const DEPTS = [CNC, ENG, ASM, INS, MGMT]
let worstMember = 0
let worstShop = 0
let worstPto = 0
let sources = { pinned: 0, learned: 0, even: 0 }
for (let trial = 0; trial < 300; trial++) {
  const team = []
  const tracked = {}
  const n = 1 + Math.floor(rand() * 9)
  for (let i = 0; i < n; i++) {
    const depts = DEPTS.filter(() => rand() < 0.45)
    const m = member(`m${i}`, depts, {
      hours_per_week: [40, 32, 37.5, 45, 33][Math.floor(rand() * 5)],
      billable: rand() > 0.1,
      active: rand() > 0.05,
      dept_split: rand() < 0.2 ? Object.fromEntries(depts.filter(() => rand() < 0.6).map((d) => [d, Math.round(rand() * 100)])) : null,
    })
    team.push(m)
    if (rand() < 0.8) tracked[m.id] = Object.fromEntries(DEPTS.filter(() => rand() < 0.6).map((d) => [d, Math.round(rand() * 3000)]))
  }
  const excluded = new Set(rand() < 0.5 ? [MGMT] : [])

  // B. per member
  for (const m of team) {
    const mix = memberMix(m, excluded, tracked)
    if (mix.shares.length === 0) continue
    sources[mix.source]++
    const s = mix.shares.reduce((a, [, f]) => a + f, 0)
    worstMember = Math.max(worstMember, Math.abs(s - 1))
    if (mix.source !== 'even') {
      const bp = mix.shares.reduce((a, [, f]) => a + Math.round(f * MIX_GRID), 0)
      if (bp !== MIX_GRID) worstMember = Infinity
    }
  }

  // C. shop-wide: learned vs even vs Σ member hours
  const counting = team.filter((m) => m.billable && m.active !== false && m.dept_assignments.some((d) => !excluded.has(d)))
  const memberHours = counting.reduce((a, m) => a + memberDailyHours(m, 40), 0)
  const withLearn = sum(deptDailyHoursByTeam(team, 40, excluded, tracked))
  const evenOnly = sum(deptDailyHoursByTeam(team.map((m) => ({ ...m, dept_split: null })), 40, excluded))
  worstShop = Math.max(worstShop, Math.abs(withLearn - memberHours), Math.abs(evenOnly - memberHours))

  // C. PTO: everyone takes the same day off → every dept goes to exactly 0.
  const day = '2026-11-10'
  const ptos = team.map((m) => ({ override_date: day, team_member_id: m.id, department_id: null, reason: 'PTO', hours_reduction: 0 }))
  const cap = deptDailyHoursByTeam(team, 40, excluded, tracked)
  const red = capacityReductionsByDay(ptos, team, 40, excluded, tracked)[day] || {}
  for (const d of Object.keys(cap)) worstPto = Math.max(worstPto, Math.abs(cap[d] - (red[d] || 0)))
}
ok(`per member: Σ fractions = 1 (worst |Σ−1| ${worstMember.toExponential(1)}); pinned/learned Σ bp = 10,000`, worstMember < 1e-12, worstMember)
ok(`shop-wide, 300 fuzzed rosters: Σ dept capacity = Σ member hours, learned AND even (worst ${(worstShop * 60).toExponential(1)} min)`, worstShop * 60 < 1e-6, worstShop)
ok(`PTO subtracts with the same split: whole shop off → every dept exactly 0 (worst ${worstPto.toExponential(1)}h)`, worstPto < 1e-9, worstPto)
ok('the fuzz exercised all three sources', sources.pinned > 0 && sources.learned > 0 && sources.even > 0, sources)

// The headline, by hand: Hunter CNC+Eng (64/36 learned) + Trent CNC-only.
{
  const team = [member('hunter', [CNC, ENG]), member('trent', [CNC])]
  const tracked = { hunter: { [CNC]: 64 * 60, [ENG]: 36 * 60 } }
  const even = deptDailyHoursByTeam(team, 40)
  const learned = deptDailyHoursByTeam(team, 40, undefined, tracked)
  ok('by hand — even: CNC 12h / Eng 4h', near(even[CNC], 12) && near(even[ENG], 4), even)
  ok('by hand — learned: CNC 13.12h / Eng 2.88h (16h either way)', near(learned[CNC], 13.12) && near(learned[ENG], 2.88) && near(sum(even), sum(learned)), learned)
  const half = capacityReductionsByDay([{ override_date: 'd', team_member_id: 'hunter', department_id: null, hours_reduction: 4 }], team, 40, undefined, tracked).d
  ok('by hand — Hunter 4h PTO comes off 64/36: CNC 2.56h, Eng 1.44h', near(half[CNC], 2.56) && near(half[ENG], 1.44), half)
}

// ── D. static ──────────────────────────────────────────────────────────────
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const cap = read('app/(app)/capacity/page.tsx')
ok('/capacity: capacity + both PTO calls get the tracked minutes', /deptDailyHoursByTeam\(team, orgHrsPerWeek, excludedDepts, trackedMix\)/.test(cap) && (cap.match(/capacityReductionsByDay\([^)]*, trackedMix\)/g) || []).length === 2)
const sch = read('app/(app)/schedule/page.tsx')
ok('/schedule: capacity + PTO get the same tracked minutes', /deptDailyHoursByTeam\([^)]*, mixMinutes\)/.test(sch) && /capacityReductionsByDay\([^\n]*, mixMinutes\)/.test(sch))
const lib = read('lib/shop-rate-setup.ts')
ok('the split has ONE source: no "/ depts.length" left in the capacity math', !/\/ depts\.length/.test(lib))
ok('/team can save a pin (dept_split is a mergeable field)', /dept_split: true/.test(read('lib/team-merge.ts')))

console.log(`\n${fail ? 'FAIL' : 'PASS'} — ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
