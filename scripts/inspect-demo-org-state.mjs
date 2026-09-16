// ============================================================================
// scripts/inspect-demo-org-state.mjs — READ-ONLY: what orgs exist, and is any
// demo/completed-project data already live?
// ============================================================================
// Context: the marketing-site screenshot brief (docs/marketing-site-demo-data-
// brief.md) needs 7 seeded completed projects. Before seeding anywhere, look:
//   • which orgs exist (is there already a demo org?)
//   • whether demo_seed.sql's fixed-UUID rows were ever applied
//   • whether any org already has project_outcomes rows
// Writes nothing. Follows the inspect-*.mjs read-only convention.
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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: orgs, error: oe } = await sb
  .from('orgs')
  .select('id, name, slug, plan, created_at')
  .order('created_at')
if (oe) {
  console.error('orgs read failed:', oe.message)
  process.exit(1)
}

console.log('\nORGS:')
for (const o of orgs || []) {
  console.log(`  ${o.slug.padEnd(20)} ${String(o.name).padEnd(28)} plan=${o.plan}  ${o.id}`)
}

// Outcomes per org — the Completed Projects view reads exactly this table.
const { data: outcomes } = await sb
  .from('project_outcomes')
  .select('org_id, completed_at')
const byOrg = {}
for (const r of outcomes || []) byOrg[r.org_id] = (byOrg[r.org_id] || 0) + 1
console.log('\nproject_outcomes rows by org:')
if (!outcomes || outcomes.length === 0) console.log('  (none anywhere)')
for (const [orgId, n] of Object.entries(byOrg)) {
  const org = (orgs || []).find((o) => o.id === orgId)
  console.log(`  ${org ? org.slug : orgId}: ${n}`)
}

// demo_seed.sql used fixed UUID prefixes — were they ever applied?
// (Filtered in JS: PostgREST can't LIKE a uuid column.)
const { data: allProjects } = await sb.from('projects').select('id, name, stage, org_id')
const demoProjects = (allProjects || []).filter((p) => String(p.id).startsWith('9b000000'))
console.log(`\ndemo_seed.sql fixed-UUID projects present: ${(demoProjects || []).length}`)
for (const p of demoProjects || []) console.log(`  ${p.stage.padEnd(12)} ${p.name}`)

const { count: sug } = await sb
  .from('item_suggestions')
  .select('id', { count: 'exact', head: true })
console.log(`\nitem_suggestions rows (all orgs): ${sug ?? 0}`)
