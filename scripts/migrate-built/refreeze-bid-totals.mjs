// ============================================================================
// refreeze-bid-totals.mjs — repair projects.bid_total on imported jobs.
// ============================================================================
// An imported job (6c-2) prices FROZEN: the sum of its lines' lump_cost_override
// IS the contract price. bid_total is only a denormalized cache of that, and a
// client running pre-6c-2 code will happily overwrite it with a reconstructed
// number (labor at the shop rate + consumables on top of the frozen lump).
// This puts it back.
//
// SAFETY: only touches a project whose frozen line sum equals the manifest's
// audited contract price — i.e. a job that really was re-imported under 6c-2.
// Old-style imports (material-only lumps + reconstruction margins) are REPORTED
// and skipped; they need a frozen re-import, not a bid_total edit.
//
//   node scripts/migrate-built/refreeze-bid-totals.mjs           # dry run
//   node scripts/migrate-built/refreeze-bid-totals.mjs --apply
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const root = process.cwd()
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/migrate-built/manifest.json'), 'utf8'),
)
const jobs = Array.isArray(manifest)
  ? manifest
  : manifest.jobs || Object.values(manifest).find(Array.isArray) || []
// Built's names can carry trailing whitespace that survived the import, so
// match on the trimmed name.
const priceByName = new Map(
  jobs.map((j) => [String(j.name).trim(), Number(j.expected_price) || 0]),
)

const APPLY = process.argv.includes('--apply')

const { data: projects, error } = await sb
  .from('projects')
  .select('id, name, bid_total, imported_at')
  .not('imported_at', 'is', null)
if (error) throw new Error(error.message)

let repaired = 0
let stale = 0
for (const p of projects) {
  const { data: subs } = await sb.from('subprojects').select('id').eq('project_id', p.id)
  let frozen = 0
  for (const s of subs || []) {
    const { data: lines } = await sb
      .from('estimate_lines')
      .select('lump_cost_override')
      .eq('subproject_id', s.id)
    for (const l of lines || []) frozen += Number(l.lump_cost_override) || 0
  }
  const contract = priceByName.get(String(p.name).trim()) ?? 0
  const stored = Number(p.bid_total) || 0
  const name = p.name.slice(0, 44).padEnd(45)

  if (contract <= 0) {
    // No audited price to check against → never guess at a contract total.
    stale++
    console.log(`SKIP ${name} not in the manifest — left alone`)
    continue
  }
  if (Math.abs(frozen - contract) > 1) {
    // Lines don't carry the contract price → this is a pre-6c-2 import.
    stale++
    console.log(
      `SKIP ${name} lines $${frozen} ≠ contract $${contract} — needs a FROZEN re-import`,
    )
    continue
  }
  if (Math.abs(stored - frozen) <= 1) {
    console.log(`ok   ${name} $${stored}`)
    continue
  }
  console.log(`FIX  ${name} bid_total $${stored} → $${frozen}`)
  if (APPLY) {
    const { error: uErr } = await sb
      .from('projects')
      .update({ bid_total: frozen, updated_at: new Date().toISOString() })
      .eq('id', p.id)
    if (uErr) console.log(`     UPDATE FAILED: ${uErr.message}`)
    else repaired++
  }
}

console.log(
  `\n${APPLY ? `${repaired} repaired` : 'dry run — pass --apply to write'}` +
    (stale > 0 ? `, ${stale} project(s) still on the pre-6c-2 import` : ''),
)
