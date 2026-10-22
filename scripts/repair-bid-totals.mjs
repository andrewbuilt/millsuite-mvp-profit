// ============================================================================
// repair-bid-totals.mjs — rewrite bid_total for NAMED projects to their live
// price (lib/project-totals, qty-aware since 0c49fdd). DRY RUN by default.
// Run: npx tsx scripts/repair-bid-totals.mjs "<exact name>" … [--apply]
//
// Only for drift whose CAUSE is known and fixed. 2026-10-22 targets:
//   · COS - Millwork · Systems (Back of House) — the ×1 quantity bug wrote
//     $208,064 (old code reproduces it to the dollar); true $691,684.
//   · Leonard - JW Marriott - Lobby Bar Phase 1 — the /time rollup bug wrote
//     $0; live $172,563 == Built's quoted estimated_price.
// ⛔ NOT for Batia · Final or the demo seeds: unexplained / seed data.
// ============================================================================
import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const { createClient } = await import('@supabase/supabase-js')
const { computeProjectPrice, recomputeProjectBidTotal } = await import('../lib/project-totals.ts')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')
for (const name of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  const { data, error } = await sb.from('projects').select('id, name, stage, bid_total').eq('name', name)
  if (error || !data || data.length !== 1) {
    console.log(`✗ "${name}": ${data?.length ?? 0} matches — skipped`)
    continue
  }
  const p = data[0]
  const live = await computeProjectPrice(p.id)
  console.log(`${APPLY ? 'APPLY' : 'dry  '} ${p.name} [${p.stage}]  $${p.bid_total} → $${live?.priceTotal}`)
  if (APPLY) {
    const wrote = await recomputeProjectBidTotal(p.id)
    const { data: after } = await sb.from('projects').select('bid_total').eq('id', p.id).single()
    console.log(`      wrote ${wrote} · now stored $${after?.bid_total}`)
  }
}
