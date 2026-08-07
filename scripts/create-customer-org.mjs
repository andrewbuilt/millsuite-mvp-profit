// ============================================================================
// scripts/create-customer-org.mjs — stand up a comped customer, no signup
// ============================================================================
// Signup is only two operations: create the auth user, then call
// create_org_with_owner. Doing them here skips the tier picker, the Stripe
// checkout, the trial clock and the slug-collision suffix — and lets you pin
// the exact slug the customer's login URL will use.
//
// What you get: the org, the owner login, the 5 canonical departments (with
// distinct colours, migration 081), a shop_rate_settings row, and plan
// 'internal' — all 20 features, unlimited seats, unlimited drawing parses with
// no daily cap, no billing UI.
//
// SAFETY:
//   • Preview by default. Prints exactly what it would create and stops.
//   • --apply is required to write anything.
//   • Refuses if the slug is taken — otherwise create_org_with_owner silently
//     appends a random suffix and the customer gets /bam-woodworks-7f3a.
//   • Refuses if the email already has an auth user.
//   • Rolls the auth user back if org creation fails, so a retry can reuse
//     the email (same guarantee /api/auth/setup gives).
//
// Run with npx tsx (not plain node) — it imports the shared reserved-slug
// list from lib/, which is TypeScript:
//   npx tsx scripts/create-customer-org.mjs --email x@y.com --name "Bam Woodworks" --slug bam-woodworks
//   … --apply
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : process.argv[i + 1] ?? null
}
const email = (arg('--email') || '').trim().toLowerCase()
const shopName = (arg('--name') || '').trim()
const slug = (arg('--slug') || '').trim().toLowerCase()
const apply = process.argv.includes('--apply')

if (!email || !shopName || !slug) {
  console.error('Usage: npx tsx scripts/create-customer-org.mjs --email <email> --name "<Shop Name>" --slug <slug> [--apply]')
  process.exit(1)
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error(`Slug must be lowercase letters, numbers and hyphens only. Got "${slug}".`)
  process.exit(1)
}
// Same rule signup enforces — org slugs sit at the URL root, so a reserved
// word would shadow a real route. Kept in sync via lib/reserved-slugs.
const { isReservedSlug } = await import('../lib/reserved-slugs.ts')
if (isReservedSlug(slug)) {
  console.error(`"${slug}" is a reserved route name and can't be an org slug.`)
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

// Readable but strong. The customer changes it on first sign-in; ambiguous
// characters are left out so it survives being read down a phone.
function tempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(14))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

// ── Preflight ───────────────────────────────────────────────────────────────
const { data: slugTaken } = await sb
  .from('orgs')
  .select('id, name, created_at')
  .eq('slug', slug)
  .maybeSingle()
if (slugTaken) {
  console.error(
    `\nSlug "${slug}" is taken by "${slugTaken.name}" (${slugTaken.id}, created ${slugTaken.created_at.slice(0, 10)}).`,
  )
  console.error('Free it first, e.g.:')
  console.error(`  UPDATE public.orgs SET slug = '${slug}-old' WHERE id = '${slugTaken.id}';`)
  process.exit(1)
}

const { data: existingUsers } = await sb.auth.admin.listUsers({ perPage: 1000 })
const clash = (existingUsers?.users ?? []).find(
  (u) => (u.email || '').toLowerCase() === email,
)
if (clash) {
  console.error(`\n${email} already has a login (auth id ${clash.id}).`)
  console.error('Reset its password in the Supabase dashboard, or use a different address.')
  process.exit(1)
}

const password = tempPassword()

console.log('\nWould create:')
console.log(`  shop      ${shopName}`)
console.log(`  owner     ${email}`)
console.log(`  login URL https://millsuite.com/${slug}`)
console.log(`  plan      internal (all features, unlimited seats + parses, no billing)`)
console.log(`  also      5 departments, shop-rate settings row`)
if (!apply) {
  console.log('\nPreview only — nothing created. Re-run with --apply.')
  process.exit(0)
}

// ── Create ──────────────────────────────────────────────────────────────────
const { data: created, error: authErr } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true, // no verification email round-trip
})
if (authErr || !created?.user) {
  console.error('Could not create the login:', authErr?.message)
  process.exit(1)
}

const { data: rows, error: rpcErr } = await sb.rpc('create_org_with_owner', {
  p_auth_user_id: created.user.id,
  p_email: email,
  p_shop_name: shopName,
  p_plan: 'starter',
  p_seats: 1,
  p_base_slug: slug,
  p_plan_status: 'active',
  p_trial_ends_at: null,
})
if (rpcErr) {
  // Roll back so the email is reusable on a retry.
  await sb.auth.admin.deleteUser(created.user.id)
  console.error('Org creation failed, login rolled back:', rpcErr.message)
  process.exit(1)
}
const row = Array.isArray(rows) ? rows[0] : rows

// Comp it. Separate from the RPC because 'internal' is deliberately not a
// member of PLANS — validatePlan rejects it at every normal entry point.
const { error: compErr } = await sb
  .from('orgs')
  .update({ plan: 'internal' })
  .eq('id', row.org_id)
if (compErr) {
  console.error(`Org created but comping failed: ${compErr.message}`)
  console.error(`Finish by hand: UPDATE public.orgs SET plan='internal' WHERE id='${row.org_id}';`)
  process.exit(1)
}

console.log('\n✅ Created.\n')
console.log(`  Login URL   https://millsuite.com/${row.slug}`)
console.log(`  Email       ${email}`)
console.log(`  Password    ${password}`)
console.log(`  org_id      ${row.org_id}`)
console.log('\nHand over the URL, email and password. He can change the password once in.')
if (row.slug !== slug) {
  console.log(`\n⚠️  Slug came back as "${row.slug}", not "${slug}" — something else claimed it mid-run.`)
}
