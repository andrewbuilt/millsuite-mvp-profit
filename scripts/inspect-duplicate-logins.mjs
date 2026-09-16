// ============================================================================
// inspect-duplicate-logins.mjs — READ ONLY. Which login rows are duplicates,
// and what would break if one were deleted?
// ============================================================================
// Run: npx tsx scripts/inspect-duplicate-logins.mjs
//
// ⛔ WHY THIS IS A REPORT AND NOT A FIX. A `users` row id is stamped on things
// people made: tasks they were assigned, time they clocked, comments they
// wrote, change orders they accepted, PTO they approved. Deleting the wrong
// row either violates a foreign key or silently blanks the name against that
// history. And the auth account behind it cannot be un-deleted.
//
// So this counts every reference, checks which auth accounts still exist and
// when each was last used, and prints the plan. A human runs the plan.
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

const needle = process.argv[2] || 'kaylin'

const { data: users } = await db
  .from('users')
  .select('id, name, email, role, org_id, auth_user_id, created_at')
  .ilike('email', `%${needle}%`)

const { data: orgs } = await db.from('orgs').select('id, name, team_members')
const orgName = new Map((orgs || []).map((o) => [o.id, o.name]))

// Every place a users.id is stamped. ⚠️ Hand-maintained: a table added later
// that references users.id and is missing here would be invisible to this
// report, which is exactly the class of mistake it exists to prevent.
const REFS = [
  ['tasks', 'assigned_to'],
  ['tasks', 'created_by'],
  ['task_comments', 'author_id'],
  ['time_entries', 'user_id'],
  ['time_entries', 'created_by'],
  ['pto_requests', 'approved_by'],
  ['co_docs', 'accepted_by'],
  ['project_payments', 'created_by'],
  ['comments', 'author_id'],
  ['project_events', 'actor_user_id'],
  ['drawing_revisions', 'uploaded_by'],
  ['suggestions', 'created_by'],
]

// Which auth accounts actually exist, and when each was last used.
const { data: authList } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
const authById = new Map((authList?.users || []).map((u) => [u.id, u]))

console.log(`\n══ users rows matching "${needle}" ══`)
for (const u of users || []) {
  const a = u.auth_user_id ? authById.get(u.auth_user_id) : null
  console.log(`\n  users.id ${u.id}`)
  console.log(`     ${u.email}  ·  role=${u.role}  ·  org=${orgName.get(u.org_id) || u.org_id}`)
  console.log(`     created ${String(u.created_at).slice(0, 10)}`)
  if (!u.auth_user_id) {
    console.log('     ⛔ NO auth_user_id — this row can never be signed in to.')
  } else if (!a) {
    console.log(`     ⛔ auth_user_id ${u.auth_user_id} — NO SUCH AUTH ACCOUNT (already deleted).`)
  } else {
    console.log(
      `     auth ${a.id}  ·  last sign-in ${a.last_sign_in_at ? String(a.last_sign_in_at).slice(0, 16) : 'NEVER'}`,
    )
  }

  // What is stamped on this id?
  let total = 0
  const hits = []
  for (const [table, col] of REFS) {
    const { count, error } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(col, u.id)
    if (error) continue // table or column absent — nothing to orphan
    if ((count || 0) > 0) {
      hits.push(`${table}.${col}=${count}`)
      total += count || 0
    }
  }
  console.log(`     references: ${total === 0 ? 'NONE — safe to delete' : hits.join('  ')}`)

  // Is any roster row pointing at it?
  const pointedBy = []
  for (const o of orgs || []) {
    for (const m of o.team_members || []) {
      if (m.user_id === u.id) pointedBy.push(`${orgName.get(o.id)} → ${m.name}`)
    }
  }
  console.log(
    `     roster: ${pointedBy.length === 0 ? 'not linked to any roster row' : pointedBy.join(', ')}`,
  )
}

console.log(`\n══ what to do ══`)
const live = (users || []).filter((u) => u.auth_user_id && authById.get(u.auth_user_id))
const signedIn = live.filter((u) => authById.get(u.auth_user_id)?.last_sign_in_at)
console.log(`  ${users?.length ?? 0} rows · ${live.length} with a real auth account · ${signedIn.length} ever signed in`)
console.log(
  `\n  KEEP the row that has signed in AND is on the roster. Every other row:\n` +
    `    · references NONE  → delete the users row, then the auth account\n` +
    `    · references > 0   → do NOT delete. Re-point the roster at the kept row\n` +
    `                          and leave the duplicate as dormant history, or\n` +
    `                          move the references first.\n`,
)
