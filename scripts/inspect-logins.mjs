// ============================================================================
// inspect-logins.mjs — READ ONLY. Every login ↔ roster mismatch, one table.
// ============================================================================
// Run:  npx tsx --env-file=.env.local scripts/inspect-logins.mjs            (every org)
//       npx tsx --env-file=.env.local scripts/inspect-logins.mjs --org Built
// Exit 0 = clean, 1 = issues listed.
//
// THE STANDING DIAGNOSTIC (STATE 2026-11-06, duplicate-login root fix). Three
// people were each found one at a time, a month apart, by whatever broke for
// them. This lists all of them at once so they're fixed in one sitting:
//
//   no_auth_account            users row with no auth account — nobody can sign in
//   dead_auth_account          users row → an auth account that no longer exists
//   duplicate_email            two users rows share an email
//   manager_signs_in_as_worker an unlinked WORKER login that looks like a roster
//                              person whose linked login is a MANAGER (Evan_o)
//   duplicate_person           an unlinked login that looks like a roster person
//                              who has a different login
//   unlinked_login             a login linked to no roster row
//   roster_points_at_missing   roster user_id → no users row
//   roster_points_cross_org    roster user_id → a users row in another org
//   roster_points_at_disabled  active roster row → a disabled (banned) login
//   two_rows_one_login         two roster rows share one login
//   auth_without_profile       an auth account with no users row anywhere
//
// The rules live in lib/login-dupes.ts — the same module /team "Create login"
// and /join now refuse with. Writes nothing; fixing is a person's call (the
// /team Change login / Link existing / Manage controls, or a reviewed script).
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const { loginIssues, orphanAuthAccounts } = await import('../lib/login-dupes.ts')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (npx tsx --env-file=.env.local …)')
  process.exit(2)
}
const db = createClient(url, key, { auth: { persistSession: false } })
const orgFilter = (() => {
  const i = process.argv.indexOf('--org')
  return i > 0 ? String(process.argv[i + 1] || '').toLowerCase() : null
})()

const { data: users, error: uErr } = await db.from('users').select('id, org_id, name, email, role, auth_user_id')
if (uErr) throw uErr
const { data: orgs, error: oErr } = await db.from('orgs').select('id, name, team_members')
if (oErr) throw oErr

const auth = new Map()
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw error
  for (const u of data.users) {
    auth.set(u.id, {
      id: u.id,
      email: u.email ?? null,
      banned: !!u.banned_until && new Date(u.banned_until) > new Date(),
      lastSignIn: u.last_sign_in_at ?? null,
    })
  }
  if (data.users.length < 1000) break
}

const issues = []
for (const o of orgs) {
  if (orgFilter && !o.name.toLowerCase().includes(orgFilter)) continue
  issues.push(...loginIssues({ id: o.id, name: o.name, roster: o.team_members || [] }, users, auth))
}
if (!orgFilter) {
  for (const a of orphanAuthAccounts(users, auth)) {
    issues.push({ org: '—', kind: 'auth_without_profile', who: a.email || a.id, detail: `auth account, no users row · last sign-in ${a.lastSignIn?.slice(0, 10) || 'never'}` })
  }
}

const ORDER = ['manager_signs_in_as_worker', 'duplicate_person', 'duplicate_email', 'two_rows_one_login', 'roster_points_cross_org', 'roster_points_at_missing', 'roster_points_at_disabled', 'dead_auth_account', 'no_auth_account', 'unlinked_login', 'auth_without_profile']
issues.sort((a, b) => a.org.localeCompare(b.org) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))

console.log(`\n${users.length} logins · ${orgs.length} orgs · ${auth.size} auth accounts${orgFilter ? ` · org filter "${orgFilter}"` : ''}\n`)
if (issues.length === 0) {
  console.log('✅ CLEAN — every login is one person, linked once, with a live account.')
  process.exit(0)
}
const w = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))
console.log(`${w('ORG', 18)} ${w('ISSUE', 27)} ${w('WHO', 46)} DETAIL`)
console.log('─'.repeat(150))
for (const i of issues) console.log(`${w(i.org, 18)} ${w(i.kind, 27)} ${w(i.who, 46)} ${i.detail}`)
const counts = issues.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + 1), m), {})
console.log(`\n${issues.length} issue(s): ${Object.entries(counts).map(([k, n]) => `${k} ×${n}`).join(' · ')}`)
console.log('Read-only. Before deleting any login, run inspect-duplicate-logins.mjs <name> for what is stamped on it.')
process.exit(1)
