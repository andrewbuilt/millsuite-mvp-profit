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
departments time_entries pto_requests pto_policies capacity_overrides
project_month_allocations rate_book_items rate_book_categories rate_book_finish_breakdown
materials door_types door_type_materials door_type_material_finishes cabinet_features
custom_products solid_wood_components solid_wood_top_calibrations shop_rate_snapshots
shop_rate_settings migration_id_map qbo_items_cache subproject_approval_status
approval_items drawing_revisions project_documents suggestions project_outcomes
estimate_line_options item_revisions parse_call_log holidays department_members
project_milestones milestone_templates rate_book_options door_type_finishes
shop_rate_snapshots qbo_tokens change_order_lines`
  .split(/\s+/)
  .filter(Boolean)

const exposed = []
const guarded = []
const skipped = []

for (const t of TABLES) {
  const { data, error } = await anon.from(t).select('*').limit(1)
  const { count } = await admin.from(t).select('*', { count: 'exact', head: true })
  if (error) {
    if (/does not exist|schema cache/i.test(error.message)) skipped.push(`${t} (no such table)`)
    else guarded.push(`${t} — blocked (${error.message.slice(0, 44)})`)
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

process.exit(exposed.length ? 1 : 0)
