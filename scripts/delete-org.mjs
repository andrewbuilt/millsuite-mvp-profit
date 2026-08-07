// ============================================================================
// scripts/delete-org.mjs — remove an org completely: data, logins, org row
// ============================================================================
// IRREVERSIBLE. There is no undo and no backup taken. Use it to clear an
// abandoned account so its email and slug can be reused.
//
// Deletes, in FK-safe order: every org-scoped row, then the users rows, then
// the Supabase auth logins, then the org itself.
//
// SAFETY:
//   • org id is a REQUIRED argument. No default, no all-orgs path.
//   • Preview by default — prints every row count and every login, then stops.
//   • --apply AND --i-understand are both required to delete.
//   • Refuses Built's org id outright.
//   • Any table it can't scope by org_id is REPORTED, never guessed at, so
//     nothing is silently left behind or silently over-deleted.
//   • Verifies afterwards that the org row is actually gone.
//
//   node scripts/delete-org.mjs <org-id>
//   node scripts/delete-org.mjs <org-id> --apply --i-understand
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const BUILT_ORG = '85b67e22-ebf4-4d78-94e8-3b1c73ca702f'
const orgId = process.argv[2]
const wantsApply = process.argv.includes('--apply')
const apply = wantsApply && process.argv.includes('--i-understand')

if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
  console.error('Usage: node scripts/delete-org.mjs <org-id> [--apply --i-understand]')
  process.exit(1)
}
if (orgId === BUILT_ORG) {
  console.error("Refusing to delete Built's org.")
  process.exit(1)
}
if (wantsApply && !apply) {
  console.error('--apply also requires --i-understand. Nothing was deleted.')
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: org, error: orgErr } = await sb
  .from('orgs')
  .select('id, name, slug, plan, plan_status')
  .eq('id', orgId)
  .single()
if (orgErr || !org) {
  console.error('No org with that id.', orgErr?.message ?? '')
  process.exit(1)
}

// Children before parents. Anything keyed through a parent rather than org_id
// gets reported as unscoped rather than guessed at.
const TABLES = [
  'client_invoice_payments',
  'client_invoice_line_items',
  'client_invoices',
  'cash_flow_receivables',
  'change_orders',
  'project_documents',
  'project_month_allocations',
  'project_outcomes',
  'drawing_revisions',
  'approval_items',
  'estimate_line_options',
  'estimate_lines',
  'subprojects',
  'projects',
  'time_entries',
  'pto_requests',
  'pto_policies',
  'capacity_overrides',
  'department_members',
  'departments',
  'contacts',
  'clients',
  'rate_book_finish_breakdown',
  'item_revisions',
  'rate_book_items',
  'rate_book_categories',
  'door_type_material_finishes',
  'door_type_materials',
  'door_types',
  'materials',
  'cabinet_features',
  'custom_products',
  'solid_wood_top_calibrations',
  'solid_wood_components',
  'shop_rate_snapshots',
  'shop_rate_settings',
  'team_compensation',
  'parse_call_log',
  'qbo_items_cache',
  'qbo_tokens',
  'migration_id_map',
]

console.log(`\nOrg: ${org.name}  (slug: ${org.slug}, plan: ${org.plan}/${org.plan_status})`)
console.log(`id:  ${org.id}`)
console.log(apply ? '\nMODE: APPLY — this deletes permanently\n' : '\nMODE: preview only\n')

const { data: users } = await sb
  .from('users')
  .select('id, email, role, auth_user_id')
  .eq('org_id', orgId)
console.log('logins to remove:')
for (const u of users ?? []) console.log(`  ${u.email} (${u.role})`)
if (!users?.length) console.log('  (none)')
console.log('')

let total = 0
const unscoped = []
for (const table of TABLES) {
  // select('*') not select('id'): several tables have no `id` column
  // (team_compensation is keyed on org_id+member_id), and asking for one
  // errors — which previously made them look unscoped and skipped them.
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (error) {
    unscoped.push(`${table} — ${error.message.slice(0, 60)}`)
    continue
  }
  const n = count ?? 0
  if (n > 0) {
    total += n
    console.log(`  ${table.padEnd(30)} ${n}`)
  }
  if (apply && n > 0) {
    const { error: delErr } = await sb.from(table).delete().eq('org_id', orgId)
    if (delErr) console.log(`    DELETE FAILED: ${delErr.message}`)
  }
}
console.log(`\n${total} data row(s) ${apply ? 'deleted' : 'would be deleted'}`)
if (unscoped.length) {
  console.log('\nnot scoped by org_id — left alone, check by hand if it matters:')
  for (const u of unscoped) console.log('  ·', u)
}

if (!apply) {
  console.log(`\nAlso removes ${users?.length ?? 0} login(s) and the org row itself.`)
  console.log('Nothing was deleted. Re-run with --apply --i-understand.')
  process.exit(0)
}

// users rows, then the auth logins behind them.
for (const u of users ?? []) {
  await sb.from('users').delete().eq('id', u.id)
  if (u.auth_user_id) {
    const { error } = await sb.auth.admin.deleteUser(u.auth_user_id)
    console.log(error ? `  auth delete FAILED for ${u.email}: ${error.message}` : `  removed login ${u.email}`)
  }
}

const { error: orgDelErr } = await sb.from('orgs').delete().eq('id', orgId)
if (orgDelErr) {
  console.error(`\nOrg row delete FAILED: ${orgDelErr.message}`)
  process.exit(1)
}

const { data: check } = await sb.from('orgs').select('id').eq('id', orgId).maybeSingle()
console.log(check ? '\n⚠️  org row still present — check by hand' : '\n✅ org fully removed')
