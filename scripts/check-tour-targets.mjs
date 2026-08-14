// ============================================================================
// scripts/check-tour-targets.mjs — the tour scripts hold to the step grammar
// ============================================================================
// Run after touching any data-tour attribute or tour script:
//     node scripts/check-tour-targets.mjs
//
// The failure modes here are all silent, and every rule below is a bug class
// that actually shipped once (specs/walkthroughs/v2-guide-system.md §1):
//   1. A target that matches NOTHING leaves a step with no highlight; one that
//      matches TWICE makes querySelector pick whichever comes first.
//   2. An appears-advance waiting on an ALWAYS-PRESENT element (a tab, the
//      nav) fires instantly — the step self-skips. (Failure D.)
//   3. An advanceOnEvent name not in lib/tour-events never fires — the step
//      waits forever.
//   4. A LOOK step (Back/Next) pointing at a primary action button shows two
//      affordances that mean different things. (Failures A + D.)
// ============================================================================
import fs from 'fs'
import { execSync } from 'child_process'

// Elements that exist BEFORE the user acts on the page their step runs on.
// An action step advancing on one of these would advance instantly.
const ALWAYS_PRESENT = new Set([
  'nav-sales', 'nav-projects', 'nav-manage', 'nav-settings',
  'rate-book-tabs', 'cabinets-tab', 'materials-tab', 'doors-tab',
  'kanban-board', 'kanban-new-project',
])

// Buttons a user is meant to press. A LOOK step may not target these — if the
// copy says click, the step must be a DO step. (kanban-new-project is exempt:
// the welcome tour points at it descriptively, without instructing a press.)
const ACTION_CONTROLS = new Set([
  'add-material', 'add-door-type', 'compose-line', 'composer-add-line',
])

const script = fs.readFileSync('lib/walkthroughs.ts', 'utf8')
const eventsSrc = fs.readFileSync('lib/tour-events.ts', 'utf8')
const knownEvents = new Set([...eventsSrc.matchAll(/'(ms:[a-z-]+)'/g)].map((m) => m[1]))

// ── Parse the scripts into ordered steps per tour ───────────────────────────
// Steps arrays close with a two-space "]" and each step object sits at
// four-space indent — the file's actual shape, asserted below rather than
// assumed: if parsing finds no steps, that's a FAIL, not a silent pass.
const steps = []
for (const arr of script.matchAll(/steps:\s*\[([\s\S]*?)\n  \]/g)) {
  const tourSteps = []
  for (const block of arr[1].matchAll(/^    \{[\s\S]*?^    \},?$/gm)) {
    const s = block[0]
    tourSteps.push({
      target: s.match(/target:\s*'([^']+)'/)?.[1] ?? null,
      title: s.match(/title:\s*'([^']*)'/)?.[1] ?? '(untitled)',
      appears: /advanceWhenNextAppears:\s*true/.test(s),
      event: s.match(/advanceOnEvent:\s*'([^']+)'/)?.[1] ?? null,
      waitsProject: /waitForNewProject:\s*true/.test(s),
    })
  }
  tourSteps.forEach((s, i) => steps.push({ ...s, next: tourSteps[i + 1] ?? null }))
}

const problems = []
if (steps.length === 0) problems.push('parser found no steps — the file shape changed, fix the parser')

// ── Rule 1: every target resolves to exactly one tag ────────────────────────
const targets = [...new Set(steps.map((s) => s.target).filter(Boolean))].sort()
const src = execSync('grep -rho "data-tour=[^ >]*" app/ components/', { encoding: 'utf8' })
const literal = [...src.matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1])
const counts = literal.reduce((a, t) => ((a[t] = (a[t] || 0) + 1), a), {})
const dupes = Object.entries(counts).filter(([, c]) => c > 1).map(([t]) => t)

const missing = []
for (const t of targets) {
  if (counts[t]) continue
  // Tagged through a variable or prop rather than inline — accept either quote
  // style, and ignore the catalog itself so a target can't vouch for itself.
  const hits = execSync(`grep -rl -e "'${t}'" -e '"${t}"' app/ components/ || true`, { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.includes('lib/walkthroughs'))
  if (!hits.length) missing.push(t)
}
for (const t of targets) {
  const how = counts[t] ? 'literal' : missing.includes(t) ? 'MISSING' : 'dynamic'
  console.log(`  ${how.padEnd(8)} ${t}`)
}
if (dupes.length) problems.push(`duplicate data-tour values: ${dupes.join(', ')}`)
if (missing.length) problems.push(`unresolved targets: ${missing.join(', ')}`)

// ── Rules 2–4: the step grammar ─────────────────────────────────────────────
for (const s of steps) {
  if (s.appears) {
    if (!s.next?.target) {
      problems.push(`"${s.title}": advanceWhenNextAppears but the next step has no target to wait for`)
    } else if (ALWAYS_PRESENT.has(s.next.target)) {
      problems.push(
        `"${s.title}": waits for '${s.next.target}', which is always in the DOM — it would advance instantly`,
      )
    }
  }
  if (s.event && !knownEvents.has(s.event)) {
    problems.push(`"${s.title}": advanceOnEvent '${s.event}' is not declared in lib/tour-events.ts`)
  }
  const isLook = !s.appears && !s.event && !s.waitsProject
  if (isLook && s.target && ACTION_CONTROLS.has(s.target)) {
    problems.push(
      `"${s.title}": a Back/Next step targeting action button '${s.target}' — make it a DO step or retarget`,
    )
  }
}

if (problems.length) console.log('\n' + problems.map((p) => `PROBLEM: ${p}`).join('\n'))
console.log(`\n${problems.length ? 'FAIL' : 'PASS'} — ${steps.length} steps, ${targets.length} targets checked`)
process.exit(problems.length ? 1 : 0)
