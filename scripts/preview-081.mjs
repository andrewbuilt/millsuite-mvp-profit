// Read-only preview of what migration 081's repair half will change.
// Mirrors the SQL: same ordering key, same palette, same collision test.
//   node scripts/preview-081.mjs
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
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const PALETTE = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B',
  '#EF4444', '#06B6D4', '#EC4899', '#6B7280',
]

const { data: orgs } = await sb.from('orgs').select('id, name')
const orgName = new Map((orgs || []).map((o) => [o.id, o.name]))
const { data: depts } = await sb.from('departments').select('*')

const byOrg = new Map()
for (const d of depts || []) {
  if (!byOrg.has(d.org_id)) byOrg.set(d.org_id, [])
  byOrg.get(d.org_id).push(d)
}

let orgsTouched = 0
let rowsTouched = 0
for (const [orgId, rows] of byOrg) {
  // Same ORDER BY as the migration: canonical workflow position, then
  // display_order NULLS LAST, created_at, name.
  const canonical = (name) => {
    const n = String(name).toLowerCase()
    if (n.startsWith('eng')) return 1
    if (n.startsWith('cnc')) return 2
    if (n.startsWith('assembl')) return 3
    if (n.startsWith('finish')) return 4
    if (n.startsWith('install')) return 5
    return 99
  }
  const ranked = [...rows].sort((a, b) => {
    const ac = canonical(a.name)
    const bc = canonical(b.name)
    if (ac !== bc) return ac - bc
    const ao = a.display_order ?? Infinity
    const bo = b.display_order ?? Infinity
    if (ao !== bo) return ao - bo
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
    return String(a.name).localeCompare(String(b.name))
  })
  const distinctColors = new Set(rows.filter((r) => r.color != null).map((r) => r.color)).size
  const distinctOrders = new Set(rows.filter((r) => r.display_order != null).map((r) => r.display_order)).size
  const fixOrder = rows.length !== distinctOrders
  const fixColor = rows.length !== distinctColors
  if (!fixOrder && !fixColor) continue

  const changes = []
  ranked.forEach((d, i) => {
    const rn = i + 1
    const nextOrder = fixOrder ? rn : d.display_order
    const nextColor = fixColor ? PALETTE[(rn - 1) % PALETTE.length] : d.color
    if (nextOrder !== d.display_order || nextColor !== d.color) {
      changes.push(
        `    ${String(d.name).slice(0, 18).padEnd(19)} ${d.color} → ${nextColor}   order ${d.display_order} → ${nextOrder}`,
      )
    }
  })
  if (changes.length === 0) continue
  orgsTouched++
  rowsTouched += changes.length
  console.log(`\n  ${orgName.get(orgId) ?? orgId}  (${rows.length} depts)`)
  console.log(changes.join('\n'))
}

console.log(`\n${rowsTouched} row(s) across ${orgsTouched} org(s) would change. Read-only — nothing written.`)
