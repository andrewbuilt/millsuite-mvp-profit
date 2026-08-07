// ============================================================================
// scripts/reset-org-data.mjs — give ONE org a clean slate
// ============================================================================
// First-customer onboarding step 3b: the customer's org already exists from
// earlier testing and needs its work data cleared, keeping the org itself, the
// owner login and the departments so they can start fresh without re-signing-up.
//
// SAFETY, because this deletes real rows:
//   • The org id is a REQUIRED argument. There is no default and no "all orgs"
//     path — it cannot be run unscoped.
//   • Preview by default. It prints exactly what it would delete and stops.
//     Nothing is removed without --apply.
//   • --apply additionally requires --i-understand, so a half-remembered
//     command can't wipe anything.
//   • It refuses to touch Built's org id outright.
//   • KEEPS: the org row, users/logins, departments, team roster, shop rate,
//     rate book, materials, doors, products, features. Only project WORK goes.
//
//   node scripts/reset-org-data.mjs <org-id>
//   node scripts/reset-org-data.mjs <org-id> --apply --i-understand
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const BUILT_ORG = '85b67e22-ebf4-4d78-94e8-3b1c73ca702f'

const orgId = process.argv[2]
const apply = process.argv.includes('--apply') && process.argv.includes('--i-understand')
const wantsApply = process.argv.includes('--apply')

if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
  console.error('Usage: node scripts/reset-org-data.mjs <org-id> [--apply --i-understand]')
  console.error('The org id is required. This script has no unscoped mode.')
  process.exit(1)
}
if (orgId === BUILT_ORG) {
  console.error("Refusing to run against Built's org.")
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

console.log(`\nOrg: ${org.name}  (slug: ${org.slug}, plan: ${org.plan}/${org.plan_status})`)
console.log(apply ? 'MODE: APPLY — rows will be deleted\n' : 'MODE: preview only — nothing will be deleted\n')

// Children first, parents last: FKs cascade in that direction.
// Tables keyed directly on org_id.
const BY_ORG = [
  'change_orders',
  'client_invoice_payments',
  'client_invoice_line_items',
  'client_invoices',
  'cash_flow_receivables',
  'project_documents',
  'project_month_allocations',
  'time_entries',
  'project_outcomes',
  'drawing_revisions',
  'approval_items',
  'estimate_lines',
  'subprojects',
  'projects',
  'clients',
  'contacts',
]

const kept = [
  'orgs (the org itself)',
  'users (logins)',
  'departments',
  'team_members + team_compensation',
  'rate book: items, materials, doors, products, features',
  'shop rate + settings',
]

let total = 0
for (const table of BY_ORG) {
  const { count, error } = await sb
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
  if (error) {
    // A table without an org_id column, or not present — report and skip
    // rather than guessing at a join.
    console.log(`  ${table.padEnd(28)} skipped (${error.message.slice(0, 48)})`)
    continue
  }
  const n = count ?? 0
  total += n
  console.log(`  ${table.padEnd(28)} ${n}`)
  if (apply && n > 0) {
    const { error: delErr } = await sb.from(table).delete().eq('org_id', orgId)
    console.log(delErr ? `    DELETE FAILED: ${delErr.message}` : `    deleted ${n}`)
  }
}

console.log(`\n${total} row(s) ${apply ? 'deleted' : 'would be deleted'}`)
console.log('\nKept:')
for (const k of kept) console.log('  ·', k)
if (!apply) {
  console.log('\nNothing was deleted. Re-run with --apply --i-understand to do it.')
}
