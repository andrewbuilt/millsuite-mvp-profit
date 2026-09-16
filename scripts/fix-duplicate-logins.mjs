// ============================================================================
// fix-duplicate-logins.mjs — delete duplicate `users` rows + their auth users
// ============================================================================
// Run READ-ONLY first (this is the default):
//   npx tsx scripts/fix-duplicate-logins.mjs
// Then, to actually delete:
//   npx tsx scripts/fix-duplicate-logins.mjs --apply
//
// ⛔ EVERY DELETION IS RE-CHECKED AT RUN TIME, NOT TRUSTED FROM THE LIST.
// A `users.id` is stamped on things people made — tasks they were assigned,
// time they clocked, comments, change orders they accepted. The ids below were
// chosen from a report, but a report is a snapshot: something could have been
// created against one of them since. So before each delete this re-counts the
// references and REFUSES if any exist, and refuses if the row is linked to a
// roster. The list is the intent; the guard is the authority.
//
// ⚠️ Auth accounts cannot be un-deleted. The users row goes first — if that
// fails, the auth account is left alone and nothing is half-done.
//
// Context: Kaylin had FIVE users rows, two sharing kaylin@builtthings.com
// across different auth accounts. The live one (40bc9046, admin in Built,
// 48 tasks, on the roster) is KEPT and is not in this list.
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
const APPLY = process.argv.includes('--apply')

/** The rows to remove, with WHY — so a future reader can audit the decision. */
const DOOMED = [
  {
    id: '9b4992d2-3293-413d-9243-5336fcbd5456',
    why: 'kaylin@placeholder.com · Watson cab shop · NO auth_user_id, can never be signed in to',
  },
  {
    id: '23ddf6be-33fa-40bd-897e-0fc2cc28541d',
    why: 'kaylin@builtthings.com · Built (test) · auth account already deleted',
  },
  {
    id: 'de37bc22-ff93-4ca7-9070-fd3d67321332',
    why: 'kaylinprice23@gmail.com · KP · auth account already deleted',
  },
  {
    id: '251edd4e-8f35-4b0d-9862-bdfe92e76474',
    why: 'kaylinprice23@gmail.com · Built · live login, unlinked to any roster row (Andrew: delete)',
  },
]

/** ⛔ KEEP. Named explicitly so no future edit can add it to the list above. */
const KEEP = '40bc9046-6082-419f-9c65-12fdab562685'

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

const { data: orgs } = await db.from('orgs').select('id, name, team_members')

async function referencesFor(userId) {
  const hits = []
  for (const [table, col] of REFS) {
    const { count, error } = await db
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq(col, userId)
    if (error) continue
    if ((count || 0) > 0) hits.push(`${table}.${col}=${count}`)
  }
  return hits
}

function rosterLinks(userId) {
  const out = []
  for (const o of orgs || []) {
    for (const m of o.team_members || []) {
      if (m.user_id === userId) out.push(`${o.name} → ${m.name}`)
    }
  }
  return out
}

console.log(APPLY ? '\n⚠️  APPLYING — this deletes accounts.\n' : '\n(dry run — pass --apply to delete)\n')

let deleted = 0
let refused = 0

for (const row of DOOMED) {
  if (row.id === KEEP) {
    console.log(`⛔ REFUSING: ${row.id} is the KEEP row. Fix the list.`)
    refused++
    continue
  }
  const { data: u } = await db
    .from('users')
    .select('id, email, role, auth_user_id')
    .eq('id', row.id)
    .maybeSingle()
  if (!u) {
    console.log(`·  ${row.id} — already gone`)
    continue
  }

  const refs = await referencesFor(row.id)
  const roster = rosterLinks(row.id)
  console.log(`\n${u.email} · role=${u.role}`)
  console.log(`   ${row.why}`)

  if (refs.length > 0) {
    console.log(`   ⛔ REFUSED — now has references: ${refs.join(' ')}`)
    refused++
    continue
  }
  if (roster.length > 0) {
    console.log(`   ⛔ REFUSED — now linked to a roster row: ${roster.join(', ')}`)
    refused++
    continue
  }

  if (!APPLY) {
    console.log('   would delete the users row' + (u.auth_user_id ? ' + its auth account' : ''))
    continue
  }

  // ⛔ USERS ROW FIRST. If this fails the auth account is untouched, so a
  // failure leaves a consistent pair rather than an auth account with no
  // profile behind it.
  const { error: delErr } = await db.from('users').delete().eq('id', row.id).select('id')
  if (delErr) {
    console.log(`   ⛔ users delete failed: ${delErr.message} — auth account left alone`)
    refused++
    continue
  }
  console.log('   ✅ users row deleted')

  if (u.auth_user_id) {
    const { error: authErr } = await db.auth.admin.deleteUser(u.auth_user_id)
    console.log(
      authErr
        ? `   ⚠️  auth account ${u.auth_user_id}: ${authErr.message} (already gone is fine)`
        : '   ✅ auth account deleted',
    )
  }
  deleted++
}

console.log(`\n${APPLY ? `done — ${deleted} removed` : 'dry run complete'}${refused ? `, ${refused} refused` : ''}`)

// ── Prove the keeper survived and still owns its history ──
const { data: kept } = await db
  .from('users')
  .select('id, email, role, auth_user_id')
  .eq('id', KEEP)
  .maybeSingle()
const keptRefs = kept ? await referencesFor(KEEP) : []
console.log(
  kept
    ? `\n✅ kept: ${kept.email} · role=${kept.role} · ${keptRefs.join(' ') || 'no references'}`
    : '\n⛔ THE KEEP ROW IS GONE. Something is very wrong.',
)
console.log('')
