// ============================================================================
// verify-diagnostic-drawer.mjs — the /reports diagnostic drawer's wiring.
// ============================================================================
// Run: npx tsx scripts/verify-diagnostic-drawer.mjs   (no DB, no network)
//
// ⛔ WHY. The drawer's two links and its two tables all rest on ids and
// fallbacks that FAIL SILENTLY when they're wrong:
//
//   · `CompletedProject.id` is a `project_outcomes.id`, NOT a `projects.id`.
//     Link /time?project=<outcome id> and the page filters to nothing and
//     renders "no time tracked on this job" — a wrong answer in the shape of a
//     real one. tsc cannot see it: both are strings.
//   · /time only reads the query params it is written to read. A link to
//     ?project= against a page that ignores it opens the WHOLE shop's
//     timesheet, looking entirely correct.
//   · material "actual" falls back to the budget when no invoice is attached,
//     so an exact tie means "nothing recorded", not "on budget".
//
// ⚠️ Every check below was confirmed to FAIL when the thing it guards was
// deliberately broken. A guard that has never gone red is not a guard.
// ============================================================================

import fs from 'fs'
import path from 'path'

let pass = 0
const fails = []
function check(name, ok, detail = '') {
  if (ok) pass++
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`)
}

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
// ⛔ Strip comments before scanning. An earlier guard in this repo went red on
// its own documentation, which trains people to delete the documentation.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const drawer = code(read('app/(app)/reports/components/DiagnosticDrawer.tsx'))
const page = code(read('app/(app)/reports/page.tsx'))
const types = code(read('lib/reports/gradeCalculations.ts'))
const time = code(read('app/(app)/time/page.tsx'))
const outcomeApi = code(read('app/api/project-outcome/route.ts'))

// ── 1. THE HOURS LINK CARRIES A PROJECT ID ───────────────────────────────────
check('CompletedProject declares projectId', /projectId:\s*string/.test(types))
check('⛔ the mapping populates projectId from project_id',
  /projectId:\s*o\.project_id/.test(page))
check('⛔ the /time link uses projectId', drawer.includes('/time?project=${project.projectId}'))
check('⛔ the /time link does NOT use the outcome id',
  !/\/time\?project=\$\{project\.id\}/.test(drawer))
check('the estimate link also uses projectId',
  drawer.includes('/projects/${project.projectId}'))

// ── 2. /time ACTUALLY READS THE PARAM THE DRAWER SENDS ───────────────────────
// ⛔ Without this the link is a no-op that opens the whole shop's timesheet.
check("⛔ /time reads ?project=", /get\(['"]project['"]\)/.test(time))
check('⛔ /time seeds its projectId filter from it', /next\.projectId\s*=\s*projectId/.test(time))
check('/time still reads ?member=', /get\(['"]member['"]\)/.test(time))

// ── 3. THE DEPT TABLE COMES FROM THE OUTCOME SNAPSHOT ────────────────────────
// Re-deriving live would let the rows drift from the total printed above them.
check('the type carries the dept snapshots',
  /deptHoursEstimated\?:\s*Record<string, number>/.test(types) &&
  /deptHoursActual\?:\s*Record<string, number>/.test(types))
check('the mapping populates them',
  /deptHoursEstimated:\s*o\.dept_hours_estimated/.test(page) &&
  /deptHoursActual:\s*o\.dept_hours_actual/.test(page))
check('the drawer reads the snapshot, not a live query',
  drawer.includes('project.deptHoursEstimated') && drawer.includes('project.deptHoursActual'))
check('⛔ the drawer does not query the database itself',
  !drawer.includes('supabase') && !drawer.includes('loadProjectActuals'))

// ── 4. A MISSING DENOMINATOR IS NOT A ZERO ───────────────────────────────────
// ⛔ 6h tracked against 0h estimated is not "0%" and not "600%" — it is work
// nobody planned. Dividing here is how a table starts lying.
check('⛔ pctOf refuses to divide by a zero estimate',
  /if\s*\(!estimated\s*\|\|\s*estimated\s*<=\s*0\)\s*return null/.test(drawer))
check('unplanned work is labelled, not scored', drawer.includes("'unplanned'"))

// ── 5. THE TABLE MUST FOOT, OR SAY THAT IT DOESN'T ───────────────────────────
check('the dept rows are footed against the tracked total', /footsHours/.test(drawer))
check('a mismatch is SHOWN, not swallowed', /!footsHours\s*&&/.test(drawer))

// ── 6. ⛔ MATERIAL "ACTUAL" IS A FALLBACK AND THE UI SAYS SO ─────────────────
check('the drawer detects the fallback tie', /matUnrecorded/.test(drawer))
check('⛔ it does not print "$0 over" for an unrecorded spend',
  /matUnrecorded\s*\?\s*'—'/.test(drawer))
check('it explains WHY the number is missing',
  drawer.includes('No material invoices are attached'))

// ── 7. ⛔ THE COLUMN NAME THAT CAUSED IT ─────────────────────────────────────
// `invoices.total` does not exist; the column is `total_amount`. PostgREST
// fails the whole select on one unknown column, so this read returned null and
// EVERY completed job silently recorded the budget as its actual material cost.
check('⛔ the outcome writer selects total_amount', /\.select\(['"]total_amount['"]\)/.test(outcomeApi))
check('⛔ it no longer selects the non-existent `total`',
  !/\.select\(['"]total['"]\)/.test(outcomeApi))
check('⛔ and it checks the error instead of folding it into a 0',
  /invoiceErr/.test(outcomeApi) && /if\s*\(invoiceErr\)/.test(outcomeApi))

// ── 8. The dead waterfall is gone from the drawer ────────────────────────────
check('the margin waterfall is no longer rendered', !drawer.includes('computeWaterfall'))

console.log('\n══ diagnostic drawer wiring ══\n')
console.log(`  ${pass} checks passed${fails.length ? `, ${fails.length} FAILED` : ''}`)
if (fails.length) {
  for (const f of fails) console.log(`   ⛔ ${f}`)
  console.log('')
  process.exit(1)
}
console.log('')
