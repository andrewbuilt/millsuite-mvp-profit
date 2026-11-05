// find-login.mjs — READ ONLY. Every login + auth account whose email or name
// contains a word, across ALL orgs (inspect-logins --org only looks inside one
// shop, and skips auth accounts with no profile).
//   npx tsx --env-file=.env.local scripts/find-login.mjs bam
import { createClient } from '@supabase/supabase-js'
const q = (process.argv[2] || '').toLowerCase()
if (!q) { console.error('Usage: … find-login.mjs <word>'); process.exit(2) }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data: users, error } = await db.from('users').select('id, name, email, role, auth_user_id, orgs(name)')
if (error) throw error
const auth = []
for (let page = 1; ; page++) {
  const { data, error: e } = await db.auth.admin.listUsers({ page, perPage: 1000 })
  if (e) throw e
  auth.push(...data.users)
  if (data.users.length < 1000) break
}
const authById = new Map(auth.map((a) => [a.id, a]))
const hit = (s) => (s || '').toLowerCase().includes(q)
const rows = users.filter((u) => hit(u.email) || hit(u.name))
console.log(`\nLogins matching "${q}": ${rows.length}`)
for (const u of rows) {
  const a = u.auth_user_id ? authById.get(u.auth_user_id) : null
  console.log(`  ${u.email}  · ${u.name} · ${u.role} · shop ${u.orgs?.name ?? '?'} · ${a ? `last sign-in ${a.last_sign_in_at?.slice(0, 10) || 'never'}` : 'NO live auth account'}`)
}
const linked = new Set(users.map((u) => u.auth_user_id).filter(Boolean))
const orphans = auth.filter((a) => hit(a.email) && !linked.has(a.id))
console.log(`Auth accounts matching "${q}" with no login row: ${orphans.length}`)
for (const a of orphans) console.log(`  ${a.email} · last sign-in ${a.last_sign_in_at?.slice(0, 10) || 'never'}`)
