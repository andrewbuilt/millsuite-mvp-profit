// ============================================================================
// scripts/check-tour-targets.mjs — every tour target resolves to exactly one tag
// ============================================================================
// Run after touching any data-tour attribute or tour script:
//     node scripts/check-tour-targets.mjs
//
// This exists because the failure mode is silent. A target that matches NOTHING
// leaves the step with no highlight; a target that matches TWICE makes
// querySelector pick whichever happens to come first in the document, which
// looks like a random misfire. Both shipped once already.
// ============================================================================
import fs from 'fs'
import { execSync } from 'child_process'

const script = fs.readFileSync('lib/walkthroughs.ts', 'utf8')
const targets = [...new Set([...script.matchAll(/target:\s*'([^']+)'/g)].map((m) => m[1]))].sort()
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
if (dupes.length) console.log('\nDUPLICATE data-tour values:', dupes.join(', '))
if (missing.length) console.log('\nUNRESOLVED targets:', missing.join(', '))
const bad = dupes.length || missing.length
console.log(`\n${bad ? 'FAIL' : 'PASS'} — ${targets.length} targets checked`)
process.exit(bad ? 1 : 0)
