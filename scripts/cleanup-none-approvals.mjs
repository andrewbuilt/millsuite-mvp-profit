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
import fs from 'node:fs'
import path from 'node:path'

// Same .env.local self-load every other hand-run script uses (see
// inspect-portal-approvals) — nothing exports these into the shell.
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.local).')
  process.exit(1)
}
const db = createClient(url, key)
const APPLY = process.argv.includes('--apply')
// ⚠️ Approved cards are records someone signed off on, so they're skipped by
// default. Andrew's case (2026-09-23): he'd bulk-approved the None cards just
// to clear them BEFORE the generation fix existed — that's not a spec
// decision worth preserving, and he asked for them gone. This flag is that
// deliberate, human decision; the script still never makes it for you.
const INCLUDE_APPROVED = process.argv.includes('--include-approved')

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
const approved = candidates.filter((r) => r.state === 'approved')
const doomed = INCLUDE_APPROVED ? candidates : candidates.filter((r) => r.state !== 'approved')
const skipped = INCLUDE_APPROVED ? [] : approved

for (const r of doomed) {
  console.log(`${APPLY ? 'DELETE' : 'would delete'}  ${r.label} · ${r.material || r.finish}  (${r.state})  ${r.id}`)
}
for (const r of skipped) {
  console.log(`SKIP (approved — add --include-approved to delete)  ${r.label} · ${r.material || r.finish}  ${r.id}`)
}
console.log(`\n${doomed.length} None card(s) targeted${skipped.length ? ` · ${skipped.length} approved skipped` : ''}.`)

if (APPLY && doomed.length > 0) {
  const { error: delErr } = await db
    .from('approval_items')
    .delete()
    .in('id', doomed.map((r) => r.id))
  if (delErr) {
    console.error(delErr.message)
    process.exit(1)
  }
  console.log('Deleted.')
} else if (!APPLY && doomed.length > 0) {
  console.log('Dry run — re-run with --apply to delete.')
}
