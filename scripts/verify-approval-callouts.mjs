// ============================================================================
// verify-approval-callouts.mjs — the callout TOMBSTONE rule stays wired (122)
// ============================================================================
// Run: node scripts/verify-approval-callouts.mjs     (static, no database)
//
// Deleting a pre-production callout sets approval_items.dismissed_at instead
// of deleting the row. Two halves, both easy to break silently:
//   1. The re-seed DE-DUP must READ dismissed rows — that's the whole point:
//      filter them out and a derived callout someone deleted is re-proposed on
//      the next pre-production load.
//   2. Every LIST / GATE reader must FILTER them out — or a deleted callout
//      keeps blocking "ready", shows on the client's checklist, or makes the
//      CO card-by-label match ambiguous.
// Plus: the gate view (122) ignores dismissed rows.
// ============================================================================
import fs from 'fs'

let bad = 0
const ck = (label, ok) => {
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${label}`)
}
const read = (f) => fs.readFileSync(f, 'utf8')

const approvals = read('lib/approvals.ts')
const dedupe = approvals.slice(approvals.indexOf('De-dupe against existing slots'), approvals.indexOf("createApprovalItemsFromProposals', error"))
ck('seed de-dup reads approval_items', /from\('approval_items'\)/.test(dedupe))
ck('seed de-dup does NOT filter dismissed (tombstones keep their key)', !/dismissed_at/.test(dedupe.replace(/\/\/.*$/gm, '')))

const loader = approvals.slice(approvals.indexOf('export async function loadApprovalItemsForSubproject'), approvals.indexOf('export async function loadApprovalItemsForSubproject') + 600)
ck('subproject list loader filters dismissed', /\.is\('dismissed_at', null\)/.test(loader))
const portal = read('lib/client-portal.ts')
ck('portal reads filter dismissed (both)', (portal.match(/\.is\('dismissed_at', null\)/g) || []).length >= 2)
ck('project-stage gate filters dismissed', /\.is\('dismissed_at', null\)/.test(read('lib/project-stage.ts')))
ck('CO card-by-label match filters dismissed', /\.eq\('label', cardLabel\)[\s\S]{0,200}\.is\('dismissed_at', null\)/.test(read('lib/change-orders.ts')))

const view = read('db/migrations/122_approval_callouts_dismiss.sql')
ck('gate view ignores dismissed in ready_for_scheduling', /dismissed_at IS NULL AND ai\.state != 'approved'/.test(view))
ck('gate view counts exclude dismissed', /slots_total/.test(view) && (view.match(/dismissed_at IS NULL/g) || []).length >= 3)
ck('gate view keeps security_invoker (083 tenant isolation)', /security_invoker = true/.test(view))

const delFn = approvals.slice(approvals.indexOf('export async function dismissApprovalCallout'))
ck('delete is an UPDATE (tombstone), never a DELETE', /\.update\(\{ dismissed_at/.test(delFn) && !/\.delete\(\)/.test(delFn.slice(0, 1500)))

console.log(bad === 0 ? '\nPASS' : `\nFAIL — ${bad}`)
process.exit(bad === 0 ? 0 : 1)
