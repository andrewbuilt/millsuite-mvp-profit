// ============================================================================
// inspect-pto-approve.mjs — READ ONLY. Why can't Kaylin approve a PTO request?
// ============================================================================
// Run: npx tsx scripts/inspect-pto-approve.mjs
//
// RLS on pto_requests and capacity_overrides is org-wide for any authenticated
// user, so a manager is not blocked there. This checks the other candidates:
//   · is there actually a pending request, and does its team_member_id still
//     match a roster member (the roster is jsonb — ids can go stale)
//   · does the approver have a `users` row (approved_by FKs to users.id)
//   · is `billable.hrs_per_week` present (the handler needs it)
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

const { data: reqs } = await db
  .from('pto_requests')
  .select('*')
  .order('created_at', { ascending: false })

console.log(`\npto_requests: ${reqs?.length ?? 0}`)
for (const r of reqs || []) {
  console.log(
    `   ${r.status.padEnd(9)} ${r.start_date}→${r.end_date}  member=${r.team_member_id}  ` +
      `approved_by=${r.approved_by ?? '—'}`,
  )
}

const pending = (reqs || []).filter((r) => r.status === 'pending')
if (pending.length === 0) {
  console.log('\n·  No pending requests — nothing to approve right now.')
}

const { data: orgs } = await db.from('orgs').select('id, name, team_members, billable_hours_inputs')
const { data: users } = await db.from('users').select('id, name, email, role, org_id')

console.log('\n── the approvers ──')
for (const u of users || []) {
  console.log(`   ${String(u.role).padEnd(8)} ${u.name || u.email} · users.id=${u.id}`)
}

console.log('\n── does each pending request still match a roster member? ──')
for (const org of orgs || []) {
  const roster = (org.team_members || []).map((m) => ({ id: m.id, name: m.name }))
  for (const r of pending) {
    if (r.org_id !== org.id) continue
    const hit = roster.find((m) => m.id === r.team_member_id)
    // ⛔ THE ONE THAT WOULD BITE SILENTLY. `member` is passed to
    // memberDailyHours to compute hours_reduction; if the roster id no longer
    // resolves, approval still runs but writes 0-hour overrides — and if the
    // handler assumed a member it would throw before the status update.
    console.log(
      hit
        ? `   ✅ ${r.start_date}: ${hit.name}`
        : `   ⛔ ${r.start_date}: team_member_id ${r.team_member_id} is NOT on the roster`,
    )
  }
  const billable = org.billable_hours_inputs
  console.log(
    `\n   ${org.name}: billable_hours_inputs = ${
      billable ? `hrs_per_week ${billable.hrs_per_week}` : 'NULL — handler falls back to 40'
    }`,
  )
}
console.log('')
