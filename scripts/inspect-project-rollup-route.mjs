// READ ONLY. Is /api/projects/[id]/rollup (fired on every /time stop) safe?
// It writes bid_total = Σ subprojects.price and reads `organizations`.
// Run: npx tsx --env-file=.env.local scripts/inspect-project-rollup-route.mjs
import { createClient } from '@supabase/supabase-js'
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const org = await sb.from('organizations').select('shop_rate').limit(1)
console.log('organizations table:', org.error ? `ERROR ${org.error.code} ${org.error.message}` : `ok (${org.data.length} rows)`)
const price = await sb.from('subprojects').select('id, price').limit(1)
console.log('subprojects.price:', price.error ? `ERROR ${price.error.code} ${price.error.message}` : 'ok')

// What would the route write over bid_total, per project?
const { data: projs } = await sb.from('projects').select('id, name, stage, bid_total, org_id')
const { data: subs } = await sb.from('subprojects').select('project_id, price')
const sum = {}
for (const s of subs || []) sum[s.project_id] = (sum[s.project_id] || 0) + (Number(s.price) || 0)
let diff = 0
for (const p of projs || []) {
  const routeWrites = Math.round((sum[p.id] || 0) * 100) / 100
  if (Math.abs(routeWrites - (Number(p.bid_total) || 0)) > 1) {
    diff++
    if (diff <= 25) console.log(`${p.stage.padEnd(14)} ${String(p.bid_total).padStart(10)} → ${String(routeWrites).padStart(10)}  ${p.name}`)
  }
}
console.log(`${diff} of ${projs.length} projects: the route would overwrite bid_total with a different number`)
