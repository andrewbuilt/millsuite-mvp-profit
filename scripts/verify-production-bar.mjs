// ============================================================================
// verify-production-bar.mjs — the production progress connector.
// ============================================================================
// Run: node scripts/verify-production-bar.mjs
//
// ⛔ WHY THIS EXISTS. Andrew, 2026-09-12: "it seems like the production status
// isnt working… i thought we built this already but its not working anymore."
// It WAS built (wave-3 item 4, `1ae267b`). Two things were wrong, and neither
// was the bar itself:
//
//   1. The project page fed it `proj.actualMinutes`, the sum over SUBPROJECTS,
//      which comes from a query filtered `.in('subproject_id', …)`. Clocking
//      in only requires a PROJECT — /time gates its button on `timerProjectId`
//      alone and inserts `subproject_id: timerSubprojectId || null` — so every
//      hour logged without picking a sub was invisible here. /projects used
//      the project-level loader all along and showed a bigger number.
//   2. "No estimate" and "nothing tracked yet" both drew a plain gray
//      connector, so there was no way to tell which one you were looking at.
//
// This pins the ARITHMETIC and the state machine. The rendering is a 2px line
// and has to be looked at; this is the part that can rot silently.
// ============================================================================

let pass = 0
let fail = 0

function check(name, got, want) {
  const ok = typeof got === 'number' && typeof want === 'number'
    ? Math.abs(got - want) < 0.01
    : got === want
  if (ok) pass++
  else {
    fail++
    console.log(`  ❌ ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
  }
}

// Mirrors StageStrip's computation exactly. Kept in step by the assertions
// below plus the comment in the component pointing here.
function bar({ cover, estimatedHours, actualMinutes }) {
  const estHours = estimatedHours ?? 0
  const showProgress = cover === 'production' && estHours > 0
  const actualHours = (actualMinutes ?? 0) / 60
  const pct = showProgress ? (actualHours / estHours) * 100 : 0
  return {
    showProgress,
    unestimated: cover === 'production' && estHours <= 0,
    pct,
    over: pct > 100,
    width: Math.min(100, Math.max(0, pct)),
    tone: pct > 100 ? 'red' : 'green',
  }
}

// ── The ordinary case ──────────────────────────────────────────────────────
{
  // 100 estimated hours, 62 tracked ⇒ 62%, green.
  const b = bar({ cover: 'production', estimatedHours: 100, actualMinutes: 62 * 60 })
  check('62% of estimate', b.pct, 62)
  check('green', b.tone, 'green')
  check('bar is drawn', b.showProgress, true)
}

// ── Over estimate: red, and capped so it can't paint past the next pip ─────
{
  const b = bar({ cover: 'production', estimatedHours: 100, actualMinutes: 137 * 60 })
  check('137%', b.pct, 137)
  check('red', b.tone, 'red')
  check('over flag', b.over, true)
  check('width capped at 100', b.width, 100)
}

// ── ⛔ No estimate: no bar, and DISTINGUISHABLE from 0% ────────────────────
{
  const none = bar({ cover: 'production', estimatedHours: 0, actualMinutes: 40 * 60 })
  check('no estimate ⇒ no bar', none.showProgress, false)
  check('no estimate ⇒ flagged', none.unestimated, true)
  check('and NOT a silent 0%', none.pct, 0)

  const zero = bar({ cover: 'production', estimatedHours: 100, actualMinutes: 0 })
  check('nothing tracked ⇒ bar at 0', zero.pct, 0)
  check('but the bar IS drawn', zero.showProgress, true)
  // The two states must be tellable apart — that ambiguity is the bug.
  if (none.unestimated === zero.unestimated) {
    fail++
    console.log('  ❌ "no estimate" and "0% tracked" are indistinguishable again')
  } else pass++
}

// ── Only in production ─────────────────────────────────────────────────────
{
  for (const cover of ['bidding', 'sold', 'installed', 'complete']) {
    const b = bar({ cover, estimatedHours: 100, actualMinutes: 50 * 60 })
    check(`${cover} draws no bar`, b.showProgress, false)
    check(`${cover} is not flagged unestimated`, b.unestimated, false)
  }
}

// ── ⛔ The bug: subproject-summed minutes vs the project total ─────────────
// A job with 40 hours clocked, 25 of them without a subproject picked.
{
  const subSummed = 15 * 60
  const projectTotal = 40 * 60

  const wrong = bar({ cover: 'production', estimatedHours: 100, actualMinutes: subSummed })
  const right = bar({ cover: 'production', estimatedHours: 100, actualMinutes: projectTotal })

  check('what the page used to show', wrong.pct, 15)
  check('what is actually tracked', right.pct, 40)
  if (wrong.pct === right.pct) {
    fail++
    console.log('  ❌ the two sources agree — this test has no teeth')
  } else pass++

  // The extreme, which is what Andrew saw: ALL of it untagged.
  const allUntagged = bar({ cover: 'production', estimatedHours: 100, actualMinutes: 0 })
  check('all time untagged ⇒ the bar sat empty', allUntagged.pct, 0)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
