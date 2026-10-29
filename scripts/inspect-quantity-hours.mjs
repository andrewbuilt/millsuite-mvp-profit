// ============================================================================
// inspect-quantity-hours.mjs — whose estimated hours move with the 10-29 fix
// ============================================================================
// Run: npx tsx scripts/inspect-quantity-hours.mjs        (READ-ONLY, prod)
//
// loadProjectDeptHours never selected subprojects.quantity (097), so a ×N sub
// counted once on capacity / schedule / team / reports. Lists every project
// with a ×N sub: hours before (quantity ignored) → after (the fixed loader).
// ============================================================================
import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const k = line.split('=')[0]?.trim()
  if (!k || k.startsWith('#') || !line.includes('=')) continue
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY // read-only use
const { createClient } = await import('@supabase/supabase-js')
const { loadProjectDeptHours } = await import('../lib/project-hours.ts')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const { data: subs } = await sb.from('subprojects').select('project_id, name, quantity').gt('quantity', 1)
const byProject = {}
for (const s of subs || []) (byProject[s.project_id] ||= []).push(s)
const ids = Object.keys(byProject)
if (!ids.length) {
  console.log('No ×N subprojects anywhere — nothing moves.')
  process.exit(0)
}
const { data: projects } = await sb.from('projects').select('id, org_id, name, stage, temp_at').in('id', ids)
console.log(`${ids.length} project(s) carry a ×N sub:\n`)
for (const p of projects || []) {
  const after = (await loadProjectDeptHours(p.org_id, p.id)).totalHours
  // Before = the same rollup with every quantity forced to 1.
  const { computeSubprojectRollup, loadEstimateLines, loadRateBook } = await import('../lib/estimate-lines.ts')
  const rb = await loadRateBook(p.org_id)
  const { data: org } = await sb.from('orgs').select('consumable_markup_pct, shop_rate').eq('id', p.org_id).single()
  const { data: all } = await sb.from('subprojects').select('id, consumable_markup_pct').eq('project_id', p.id)
  let before = 0
  for (const s of all || []) {
    const r = computeSubprojectRollup(await loadEstimateLines(s.id), rb.itemsById, new Map(), {
      shopRate: Number(org?.shop_rate) || 0,
      consumableMarkupPct: s.consumable_markup_pct ?? Number(org?.consumable_markup_pct ?? 10),
      profitMarginPct: 0,
    }, 1)
    before += r.totalHours
  }
  const subsTxt = byProject[p.id].map((s) => `${s.name} ×${s.quantity}`).join(', ')
  console.log(`${p.name}  [${p.stage}${p.temp_at ? ', temp' : ''}]  ${before.toFixed(1)}h → ${after.toFixed(1)}h  (+${(after - before).toFixed(1)}h)\n   ${subsTxt}`)
}
