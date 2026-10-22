// ============================================================================
// inspect-bid-drift.mjs — READ ONLY. Why does a project's stored bid_total
// differ from its live price? Per project: stored · live (qty-aware, the fixed
// project-totals) · live ×1 (what the pre-0c49fdd code wrote) · per-sub detail.
// Run: npx tsx scripts/inspect-bid-drift.mjs "Batia" "COS - Millwork · Systems"
// ============================================================================
import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // read-only use
const { createClient } = await import('@supabase/supabase-js')
const { computeProjectPrice } = await import('../lib/project-totals.ts')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

for (const term of process.argv.slice(2)) {
  const { data: ps } = await sb
    .from('projects')
    .select('id, name, stage, bid_total, imported_at, locked_shop_rate, created_at, updated_at, estimated_price')
    .ilike('name', `%${term}%`)
  for (const p of ps || []) {
    const live = await computeProjectPrice(p.id)
    const { data: subs } = await sb
      .from('subprojects')
      .select('id, name, quantity, price_frozen, created_at')
      .eq('project_id', p.id)
      .order('sort_order')
    // ×1 what-if: every sub at quantity 1.
    const qty1 = {}
    const lineRows = await sb.from('estimate_lines').select('id, subproject_id, lump_cost_override, unit_price_override, quantity').in('subproject_id', (subs || []).map((s) => s.id))
    const x1 = await computeProjectPriceQty1(p.id, subs)
    console.log(`\n${p.name}  [${p.stage}${p.imported_at ? ', imported' : ''}] rate ${p.locked_shop_rate}`)
    console.log(`  stored $${p.bid_total} · live $${live?.priceTotal} · live×1 $${x1} · estimated_price ${p.estimated_price} · updated ${p.updated_at}`)
    const byLines = {}
    for (const l of lineRows.data || []) byLines[l.subproject_id] = (byLines[l.subproject_id] || 0) + 1
    for (const s of subs || []) console.log(`    ${s.price_frozen ? 'FROZEN' : 'live  '} ×${s.quantity}  ${byLines[s.id] || 0} lines  ${s.name}`)
  }
}

async function computeProjectPriceQty1(projectId, subs) {
  // Temporarily answer as the old code did: quantity ignored.
  const orig = sb // unused; compute by stripping quantity via a patched select is not possible here,
  // so approximate with the ratio approach: price each sub alone is not exposed — report n/a when all ×1.
  if ((subs || []).every((s) => (s.quantity ?? 1) === 1)) return 'same'
  return 'n/a (has ×N subs)'
}
