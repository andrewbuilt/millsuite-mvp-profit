// ============================================================================
// scripts/set-password.mjs — set a login's password and print it
// ============================================================================
// The create-customer-org script prints a generated password once and never
// stores it (Supabase keeps only a hash). If it scrolls away, this mints a new
// one rather than trying to recover the old.
//
// Also useful for handing a customer a fresh password without walking them
// through a reset email.
//
//   node scripts/set-password.mjs bam@bamwoodworks.com            # preview
//   node scripts/set-password.mjs bam@bamwoodworks.com --apply    # set it
//   node scripts/set-password.mjs bam@bamwoodworks.com --apply --password "theirs"
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const email = (process.argv[2] || '').trim().toLowerCase()
const apply = process.argv.includes('--apply')
const iP = process.argv.indexOf('--password')
const chosen = iP === -1 ? null : process.argv[iP + 1] ?? null

if (!email || email.startsWith('--')) {
  console.error('Usage: node scripts/set-password.mjs <email> [--apply] [--password "..."]')
  process.exit(1)
}
if (chosen && chosen.length < 8) {
  console.error('Password must be at least 8 characters.')
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

// No ambiguous characters — this gets read down a phone.
function generate() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.getRandomValues(new Uint32Array(14)), (b) => chars[b % chars.length]).join('')
}

const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 })
const user = (list?.users ?? []).find((u) => (u.email || '').toLowerCase() === email)
if (!user) {
  console.error(`No login for ${email}.`)
  process.exit(1)
}

// Which org / role, so you can't reset the wrong person's account.
const { data: row } = await sb
  .from('users')
  .select('role, org_id, orgs(name, slug)')
  .eq('auth_user_id', user.id)
  .maybeSingle()
const org = row?.orgs

console.log(`\n${email}`)
console.log(`  role  ${row?.role ?? 'unknown'}`)
console.log(`  shop  ${org?.name ?? 'unknown'}${org?.slug ? `  (millsuite.com/${org.slug})` : ''}`)

if (!apply) {
  console.log('\nPreview only — password unchanged. Re-run with --apply.')
  process.exit(0)
}

const password = chosen ?? generate()
const { error } = await sb.auth.admin.updateUserById(user.id, { password })
if (error) {
  console.error('Failed:', error.message)
  process.exit(1)
}

console.log('\n✅ Password set.\n')
if (org?.slug) console.log(`  Login URL   https://millsuite.com/${org.slug}`)
console.log(`  Email       ${email}`)
console.log(`  Password    ${password}`)
console.log('\nHand these over. He can change it once signed in.')
