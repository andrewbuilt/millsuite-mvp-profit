// ============================================================================
// inspect-line-editability.mjs — READ ONLY. Which lines can the composer open?
// ============================================================================
// Run: npx tsx scripts/inspect-line-editability.mjs
//
// ⛔ WHY THIS DECIDES THE DESIGN OF STEP 2. The spec says a CO "reopens the sub
// in the composer" and edits save as a draft revision. But `AddLineComposer`
// refuses any line without `product_key` — it has no math model for one —
// and the Built importer writes frozen lines with dept hours and a material
// lump and NO product_key at all.
//
// So on an imported job the composer may be unable to open a single existing
// line. If that's true, step 2 cannot be "reopen and edit" for those subs; it
// has to be remove-line + add-line, which is what Andrew's Pajot change
// actually is anyway (remove the rounded end panel, add a finish panel, add a
// waterfall top). Measure before designing.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: projects } = await db
  .from('projects')
  .select('id, name, stage, imported_at')
  .in('stage', ['sold', 'in_production', 'installed', 'complete'])

const { data: subs } = await db.from('subprojects').select('id, project_id, name, price_frozen')
const { data: lines } = await db.from('estimate_lines').select('id, subproject_id, product_key')

const bySub = new Map()
for (const l of lines || []) {
  if (!bySub.has(l.subproject_id)) bySub.set(l.subproject_id, [])
  bySub.get(l.subproject_id).push(l)
}
const subsByProject = new Map()
for (const s of subs || []) {
  if (!subsByProject.has(s.project_id)) subsByProject.set(s.project_id, [])
  subsByProject.get(s.project_id).push(s)
}

let totalLines = 0
let editable = 0
console.log('\nSOLD-AND-LATER PROJECTS — lines the composer can reopen\n')
for (const p of projects || []) {
  const list = subsByProject.get(p.id) || []
  let pTotal = 0
  let pEditable = 0
  for (const s of list) {
    const ls = bySub.get(s.id) || []
    pTotal += ls.length
    pEditable += ls.filter((l) => l.product_key).length
  }
  if (pTotal === 0) continue
  totalLines += pTotal
  editable += pEditable
  const flag = pEditable === 0 ? '⛔' : pEditable === pTotal ? '✅' : '⚠️ '
  console.log(
    `${flag} ${p.name}${p.imported_at ? ' [imported]' : ''}`.padEnd(70) +
      `${pEditable}/${pTotal} editable`,
  )
}

console.log(
  `\n${editable}/${totalLines} lines across sold jobs can be reopened in the composer ` +
    `(${Math.round((editable / Math.max(1, totalLines)) * 100)}%)`,
)
console.log(
  '\n⛔ Every line WITHOUT product_key can only be removed or replaced — there is\n' +
    '   no composer model for it. Step 2 has to support remove+add, not just edit.',
)
