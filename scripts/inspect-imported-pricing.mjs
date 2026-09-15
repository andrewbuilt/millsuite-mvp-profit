// ============================================================================
// inspect-imported-pricing.mjs — READ ONLY. Does new scope on an IMPORTED job
// price at $0 labor?
// ============================================================================
// Why: recomputeProjectBidTotal treats `imported_at` as a PROJECT-level freeze
// — shopRate 0, consumables 0, every margin 0 — because migrated lines carry
// Built's quoted price verbatim as a material lump and must not be marked up
// again. That's right for the migrated lines. But it also applies to any
// subproject created AFTER the import, whose composer lines carry real hours
// and expect real labor dollars + margin on top.
//
// Change orders v2 materialises exactly such a subproject on acceptance, so
// the number quoted to the client and the number the project total moves by
// would disagree. Before deciding anything, count what's actually out there.
//
//   node scripts/inspect-imported-pricing.mjs
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
  .select('id, name, stage, bid_total, imported_at, created_at')
  .order('created_at', { ascending: false })

const imported = (projects || []).filter((p) => p.imported_at)
console.log(`projects: ${projects?.length ?? 0} · imported: ${imported.length}`)

const { data: subs } = await db
  .from('subprojects')
  .select('id, project_id, name, created_at')

const bySub = new Map()
for (const s of subs || []) {
  if (!bySub.has(s.project_id)) bySub.set(s.project_id, [])
  bySub.get(s.project_id).push(s)
}

// A composer line is one with product_key set — it carries real hours in
// dept_hour_overrides and expects labor dollars. A migrated line does not.
const { data: lines } = await db
  .from('estimate_lines')
  .select('id, subproject_id, product_key, dept_hour_overrides, lump_cost_override, quantity')

const byLineSub = new Map()
for (const l of lines || []) {
  if (!byLineSub.has(l.subproject_id)) byLineSub.set(l.subproject_id, [])
  byLineSub.get(l.subproject_id).push(l)
}

console.log('\n── IMPORTED projects with post-import subprojects ──')
let hits = 0
for (const p of imported) {
  const list = (bySub.get(p.id) || []).filter(
    (s) => new Date(s.created_at).getTime() > new Date(p.imported_at).getTime() + 60_000,
  )
  if (list.length === 0) continue
  hits++
  console.log(`\n${p.name}  [${p.stage}]  bid_total $${Number(p.bid_total || 0).toLocaleString()}`)
  console.log(`   imported ${String(p.imported_at).slice(0, 10)}`)
  for (const s of list) {
    const ls = byLineSub.get(s.id) || []
    const composer = ls.filter((l) => l.product_key)
    const hours = composer.reduce((a, l) => {
      const h = l.dept_hour_overrides || {}
      return a + Object.values(h).reduce((x, y) => x + (Number(y) || 0), 0) * (Number(l.quantity) || 0)
    }, 0)
    const lump = composer.reduce(
      (a, l) => a + (Number(l.lump_cost_override) || 0) * (Number(l.quantity) || 0),
      0,
    )
    console.log(
      `   · ${s.name}  (${String(s.created_at).slice(0, 10)})  lines ${ls.length} / composer ${composer.length}` +
        (composer.length
          ? `  → ${hours.toFixed(1)}h of labor priced at $0, material $${Math.round(lump).toLocaleString()}`
          : ''),
    )
  }
}
if (hits === 0) console.log('   none — no imported project has a subproject added after its import.')

console.log('\n── NATIVE projects (for contrast) ──')
console.log(
  `   ${(projects || []).filter((p) => !p.imported_at).length} projects price normally (labor + margin).`,
)
