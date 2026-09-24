// ============================================================================
// scripts/cleanup-none-approvals.mjs — delete "None" approval cards, once
// ============================================================================
//   npx tsx scripts/cleanup-none-approvals.mjs           (dry run — lists)
//   npx tsx scripts/cleanup-none-approvals.mjs --apply   (deletes)
//
// The seeder used to turn "None"/"No Door" rate-book entries into approval
// cards ("Door/drawer material · None" — Andrew's Oliveira report,
// 2026-09-23). Generation is fixed (isNoneLikeSpecName in lib/approvals);
// this removes the rows already created. Safe against the pre-production
// self-heal: with the generation fix deployed, a None spec is never proposed
// again, so a deleted card cannot come back.
//
// ⛔ PENDING CARDS ONLY. An approved "None" card is a record that somebody
// signed off on something — wrong-shaped or not, history isn't deleted by a
// script. If any exist they're listed and skipped; decide those by hand.
// ============================================================================

import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).')
  process.exit(1)
}
const db = createClient(url, key)
const APPLY = process.argv.includes('--apply')

const NONE_LIKE = (s) => {
  const n = (s || '').trim().toLowerCase()
  return n === 'none' || n === 'n/a' || n === 'no door' || n.startsWith('no ') || n === '-'
}

const { data, error } = await db
  .from('approval_items')
  .select('id, subproject_id, label, material, finish, state')
if (error) {
  console.error(error.message)
  process.exit(1)
}

// A card is None-like when every value it carries is None-like — a real
// material paired with a None finish stays (the material is the spec).
const candidates = (data || []).filter((r) => {
  const vals = [r.material, r.finish].filter((v) => (v || '').trim() !== '')
  return vals.length > 0 && vals.every(NONE_LIKE)
})
const pending = candidates.filter((r) => r.state !== 'approved')
const approved = candidates.filter((r) => r.state === 'approved')

for (const r of pending) {
  console.log(`${APPLY ? 'DELETE' : 'would delete'}  ${r.label} · ${r.material || r.finish}  (${r.state})  ${r.id}`)
}
for (const r of approved) {
  console.log(`SKIP (approved — decide by hand)  ${r.label} · ${r.material || r.finish}  ${r.id}`)
}
console.log(`\n${pending.length} pending None card(s)${approved.length ? ` · ${approved.length} approved skipped` : ''}.`)

if (APPLY && pending.length > 0) {
  const { error: delErr } = await db
    .from('approval_items')
    .delete()
    .in('id', pending.map((r) => r.id))
  if (delErr) {
    console.error(delErr.message)
    process.exit(1)
  }
  console.log('Deleted.')
} else if (!APPLY && pending.length > 0) {
  console.log('Dry run — re-run with --apply to delete.')
}
