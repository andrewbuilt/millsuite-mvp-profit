// ============================================================================
// inspect-co-cutover.mjs — READ ONLY. What's still live in change orders v1?
// ============================================================================
// Run: npx tsx scripts/inspect-co-cutover.mjs
//
// The v2 spec says: "v1 authoring retires when v2 ships; v1's accepted COs stay
// readable everywhere they show today; check for OPEN v1 COs at cutover and
// migrate or finish them by hand with Andrew."
//
// This is that check. An open v1 CO is one that would be stranded if the
// "+ Change order" button on the subproject page disappeared today.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: cos } = await db
  .from('change_orders')
  .select('id, project_id, co_number, title, state, client_price, created_at')
  .order('created_at', { ascending: false })

const { data: projects } = await db.from('projects').select('id, name, imported_at')
const nameById = new Map((projects || []).map((p) => [p.id, p.name]))

const byState = {}
for (const c of cos || []) byState[c.state] = (byState[c.state] || 0) + 1

console.log('\nv1 change orders by state:')
for (const [s, n] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)}  ${s}`)
}
if (!cos || cos.length === 0) console.log('   (none at all)')

// ⛔ THESE are the ones that would be stranded by retiring the v1 authoring UI.
const open = (cos || []).filter((c) => c.state === 'draft' || c.state === 'sent_to_client')
console.log(`\n⛔ OPEN v1 change orders (would be stranded): ${open.length}`)
for (const c of open) {
  console.log(
    `   CO-${String(c.co_number ?? 0).padStart(2, '0')} · ${nameById.get(c.project_id) || '?'} · ` +
      `${c.state} · $${Math.round(Number(c.client_price) || 0).toLocaleString()} · ${c.title}`,
  )
}

// ── The other half of the question: what CAN you edit on an imported sub? ──
console.log('\n── imported subprojects: what a change order can actually do ──')
const { data: subs } = await db.from('subprojects').select('id, project_id, name, price_frozen')
const { data: lines } = await db
  .from('estimate_lines')
  .select('id, subproject_id, description, product_key')

const linesBySub = new Map()
for (const l of lines || []) {
  if (!linesBySub.has(l.subproject_id)) linesBySub.set(l.subproject_id, [])
  linesBySub.get(l.subproject_id).push(l)
}

let frozenSubs = 0
let frozenSingleLine = 0
for (const s of subs || []) {
  if (!s.price_frozen) continue
  frozenSubs++
  const ls = linesBySub.get(s.id) || []
  if (ls.length <= 1) frozenSingleLine++
}
console.log(`   ${frozenSubs} frozen subprojects`)
console.log(
  `   ${frozenSingleLine} of them have ONE line or none — so "remove a line" is\n` +
    `   all-or-nothing there, and there is no way to take off an arbitrary amount.`,
)
console.log('')
