// ============================================================================
// scripts/rls-audit.mjs — what can the PUBLIC key actually read?
// ============================================================================
// NEXT_PUBLIC_SUPABASE_ANON_KEY ships inside the browser bundle, so treat it as
// public knowledge. Anything this script can read with it, anyone can read.
//
// Run it before and after migration 083:
//   node scripts/rls-audit.mjs
//
// Rows returned under "READABLE BY ANYONE" = a table with no effective RLS.
// "0 of N rows" = the table has rows but the anon key can't see them, which is
// what every table should look like.
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
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const TABLES = `orgs users clients contacts projects subprojects estimate_lines change_orders
client_invoices client_invoice_line_items client_invoice_payments cash_flow_receivables
project_payments tasks task_comments supply_items bom_items
departments time_entries pto_requests pto_policies capacity_overrides
project_month_allocations rate_book_items rate_book_categories rate_book_finish_breakdown
materials door_types door_type_materials door_type_material_finishes cabinet_features
custom_products solid_wood_components solid_wood_top_calibrations shop_rate_snapshots
shop_rate_settings migration_id_map qbo_items_cache subproject_approval_status
approval_items drawing_revisions project_documents suggestions project_outcomes
estimate_line_options item_revisions parse_call_log holidays department_members
project_milestones milestone_templates rate_book_options door_type_finishes
shop_rate_snapshots qbo_tokens change_order_lines
comments department_allocations finish_samples item_suggestions labor_rates
lead_subprojects leads led_types material_pricing onboarding_progress
onboarding_stashed_baselines po_line_items portal_timeline project_events
project_learnings project_notes project_photos purchase_orders qb_connections
qb_events rate_adjustment_proposals rate_book_carcass_materials
rate_book_ext_materials rate_book_item_history rate_book_item_options
rate_book_material_variants selection_history selections shop_labor_rates
spec_library_items stripe_events team_compensation vendor_materials vendors`
  .split(/\s+/)
  .filter(Boolean)

// ============================================================================
// ⛔ THE LIST ABOVE IS HAND-MAINTAINED, AND IT HAS ROTTED BEFORE.
// ============================================================================
// This script takes NO arguments — `node rls-audit.mjs some_table` silently
// ignores them and audits the hardcoded list. So a table that never gets
// added here is never checked, and its absence looks exactly like a pass.
//
// That is the same shape as the bug migration 100 fixed: `time_entries` and
// `project_month_allocations` sat unprotected for a month because nothing
// forced anyone to look at them. Relying on "remember to add it" has now
// failed twice.
//
// So: read every table the migrations create, and refuse to report a clean
// audit while any of them is unlisted. Filesystem-derived, like
// verify-reserved-slugs, so it cannot drift from what actually ships.
// ============================================================================
const migrationDir = path.join(process.cwd(), 'db', 'migrations')
const created = new Set()
for (const f of fs.readdirSync(migrationDir).filter((n) => n.endsWith('.sql'))) {
  const sql = fs
    .readFileSync(path.join(migrationDir, f), 'utf8')
    // ⚠️ Strip comments FIRST. Migration 046's prose says "...in addition to
    // the CREATE TABLE so a half-baked prior run can't..." and a naive match
    // dutifully reported a table called `so`. One bogus name in a security
    // report is enough to make someone stop reading the real ones.
    .replace(/--[^\n]*/g, '')
  for (const m of sql.matchAll(
    /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi,
  )) {
    created.add(m[1].toLowerCase())
  }
}
// ⚠️ A DROPPED TABLE STAYS ON THE LIST, deliberately. Migrations are
// append-only, so 103 still says `CREATE TABLE bom_items` even though 105
// dropped it — the scan therefore still demands it, and the audit reports
// "no such table", which is accurate. Don't remove such an entry to silence
// the check: if the create ever runs again, it needs to be audited again.
const unlisted = [...created].filter((t) => !TABLES.includes(t)).sort()
if (unlisted.length > 0) {
  console.log('❌ TABLES CREATED BY A MIGRATION BUT NEVER AUDITED:\n')
  for (const t of unlisted) console.log(`   ${t}`)
  console.log('\nAdd them to TABLES in this script. Until you do, nobody is')
  console.log('checking whether they are readable with the public key.')
  process.exit(1)
}

const exposed = []
const guarded = []
const broken = []
const skipped = []

// A policy that ERRORS is not a policy that denies. "infinite recursion
// detected in policy" fires during planning for EVERY caller, so a table in
// this state is unreadable by your own signed-in users too — the app is down,
// not secured. Earlier versions of this script lumped errors in with denials
// and exited 0 on a broken database. They get their own bucket now.
const isDenial = (msg) => /permission denied|violates row-level security/i.test(msg)

for (const t of TABLES) {
  const { data, error } = await anon.from(t).select('*').limit(1)
  const { count } = await admin.from(t).select('*', { count: 'exact', head: true })
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) skipped.push(`${t} (no such table)`)
    else if (isDenial(error.message)) guarded.push(`${t} — denied (${error.message.slice(0, 44)})`)
    else broken.push(`${t} — ${error.message.slice(0, 70)}`)
    continue
  }
  if (!data || data.length === 0) {
    if ((count ?? 0) > 0) guarded.push(`${t} — 0 of ${count} rows visible`)
    else skipped.push(`${t} (empty)`)
    continue
  }
  exposed.push({ t, rows: count ?? '?', cols: Object.keys(data[0]).length })
}

if (exposed.length) {
  console.log('\n❌ READABLE BY ANYONE WITH THE PUBLIC KEY')
  for (const e of exposed) {
    console.log(`   ${e.t.padEnd(30)} ${String(e.rows).padStart(4)} rows · ${e.cols} cols`)
  }
} else {
  console.log('\n✅ nothing readable with the public key')
}

if (broken.length) {
  console.log('\n🔥 POLICY ERRORS — NOT denials. Signed-in users hit these too:')
  for (const b of broken) console.log('   ' + b)
}

console.log('\n✅ BLOCKED')
for (const g of guarded) console.log('   ' + g)

console.log('\n·  skipped (absent or empty — no signal either way)')
console.log('   ' + skipped.join(', '))

// The two pre-login pages must keep working WITHOUT a session.
const { data: pub, error: pubErr } = await anon.rpc('org_public_by_slug', { p_slug: 'built' })
const row = Array.isArray(pub) ? pub[0] : pub
console.log(
  '\nshop-login branding (org_public_by_slug):',
  pubErr ? `NOT AVAILABLE — ${pubErr.message}` : row ? `ok → ${row.name}` : 'no row (check the slug)',
)

// Exit non-zero for EITHER failure mode: data still exposed, or policies
// erroring. A green exit has to mean both "closed" and "working".
process.exit(exposed.length || broken.length ? 1 : 0)
