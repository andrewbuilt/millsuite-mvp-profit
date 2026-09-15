// ============================================================================
// inspect-freeze-repricing.mjs — READ ONLY. What does migration 108 move?
// ============================================================================
// Run: npx tsx --env-file=.env.local scripts/inspect-freeze-repricing.mjs
//
// Recomputes every project's price TWICE — under the OLD project-level freeze
// and under the NEW per-subproject one — and prints any project where the two
// disagree. It writes nothing.
//
// ⛔ THE ANSWER SHOULD BE "NOTHING MOVES". The backfill freezes every
// subproject that came out of Built, so the only rows that go live are scope
// added after an import — and today those have no estimate lines. If this
// script prints a non-zero delta for a SOLD project, that is a contract being
// re-priced and needs a human before anything ships.
//
// The second half answers the question the first half can't: what would a
// change order's new scope price at, before and after? It takes a real
// composer-priced subproject and re-prices it as if it had just been added.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// ⚠️ Read .env.local INTO process.env BEFORE importing anything from lib/.
// `lib/estimate-lines` imports `lib/supabase`, which builds a client at module
// scope and throws "supabaseUrl is required" if the vars aren't set yet. That
// client is never used here — every query below goes through the service-role
// client — but it has to be constructible for the import to succeed.
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}

// ⚠️ DYNAMIC, because static imports are hoisted above the env load above.
// Both of these reach `lib/supabase` transitively (install-prefill imports
// project-totals imports supabase), so they must not be resolved until the
// vars exist.
const { computeSubprojectRollup } = await import('../lib/estimate-lines.ts')
const { computeInstallCost } = await import('../lib/install-prefill.ts')
import {
  addBuckets,
  computeBucketedPrice,
  emptyBuckets,
  isSubFrozen,
  priceMixedBuckets,
  resolveBucketMargins,
  resolveMarginsForNewScope,
} from '../lib/pricing.ts'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const money = (n) => `$${Math.round(n).toLocaleString()}`

// ── Load everything once ────────────────────────────────────────────────────
const { data: orgs } = await db.from('orgs').select('*')
const orgById = new Map((orgs || []).map((o) => [o.id, o]))

const { data: projects } = await db.from('projects').select('*')
const { data: subs } = await db.from('subprojects').select('*')
const { data: lines } = await db.from('estimate_lines').select('*')
const { data: rbItems } = await db.from('rate_book_items').select('*')

const itemsById = new Map((rbItems || []).map((i) => [i.id, i]))
const subsByProject = new Map()
for (const s of subs || []) {
  if (!subsByProject.has(s.project_id)) subsByProject.set(s.project_id, [])
  subsByProject.get(s.project_id).push(s)
}
const linesBySub = new Map()
for (const l of lines || []) {
  if (!linesBySub.has(l.subproject_id)) linesBySub.set(l.subproject_id, [])
  linesBySub.get(l.subproject_id).push(l)
}

/** Price one subproject's cost buckets under a given rate/consumables rule. */
function bucketsFor(sub, project, org, frozen) {
  const shopRate = Number(project.locked_shop_rate) || Number(org?.shop_rate) || 0
  const rollup = computeSubprojectRollup(
    linesBySub.get(sub.id) || [],
    itemsById,
    new Map(),
    {
      shopRate: frozen ? 0 : shopRate,
      consumableMarkupPct: frozen
        ? 0
        : (sub.consumable_markup_pct ?? org?.consumable_markup_pct ?? 10),
      profitMarginPct: 0,
    },
    sub.quantity ?? 1,
  )
  const prefill = {
    guys: sub.install_guys,
    days: sub.install_days,
    complexityPct: sub.install_complexity_pct,
    ratePerHour: sub.install_rate_per_hour,
    included: sub.install_included ?? false,
  }
  const installPrefillCost = frozen ? 0 : computeInstallCost(prefill, shopRate)
  return { ...rollup, installCost: rollup.installCost + installPrefillCost }
}

/** OLD: the whole project frozen or not, one margin over one bucket sum. */
function priceOld(project, org) {
  const frozen = !!project.imported_at
  const b = emptyBuckets()
  for (const sub of subsByProject.get(project.id) || []) {
    addBuckets(b, bucketsFor(sub, project, org, frozen))
  }
  const margins = frozen
    ? { laborMarginPct: 0, materialMarginPct: 0, consumableMarginPct: 0 }
    : resolveBucketMargins(project, org)
  return Math.round(computeBucketedPrice(b, margins).priceTotal)
}

/** NEW: per-subproject freeze, two bucket sets, margins split. */
function priceNew(project, org) {
  const frozenB = emptyBuckets()
  const liveB = emptyBuckets()
  for (const sub of subsByProject.get(project.id) || []) {
    // Simulate the backfill: 108 hasn't necessarily run yet, so derive the
    // same answer it will — migrated subs and anything that existed at import.
    const wouldFreeze =
      sub.price_frozen != null
        ? !!sub.price_frozen
        : !!project.imported_at &&
          new Date(sub.created_at) <= new Date(new Date(project.imported_at).getTime() + 86_400_000)
    addBuckets(
      wouldFreeze ? frozenB : liveB,
      bucketsFor(sub, project, org, wouldFreeze),
    )
  }
  return Math.round(
    priceMixedBuckets(frozenB, liveB, resolveMarginsForNewScope(project, org)).priceTotal,
  )
}

// ── Half 1: does anything reprice? ──────────────────────────────────────────
console.log('\n══ WHAT MOVES ══════════════════════════════════════════════════')
let moved = 0
for (const p of projects || []) {
  if (!subsByProject.has(p.id)) continue
  const org = orgById.get(p.org_id)
  const before = priceOld(p, org)
  const after = priceNew(p, org)
  if (Math.abs(before - after) < 1) continue
  moved++
  console.log(
    `\n⚠️  ${p.name}  [${p.stage}]${p.imported_at ? ' · imported' : ''}` +
      `\n    before ${money(before)}   after ${money(after)}   Δ ${money(after - before)}`,
  )
}
if (moved === 0) {
  console.log('\n✅ nothing reprices. Every project computes the same total before and after.')
  console.log('   (Expected: the backfill freezes everything that came from Built, and the')
  console.log('    only rows left live are post-import scope, which today has no lines.)')
}

// ── Half 2: what a change order would have cost ─────────────────────────────
console.log('\n══ WHAT A CHANGE ORDER WOULD PRICE AT ══════════════════════════')
console.log('Taking each imported project\'s largest composer-priced subproject and')
console.log('re-pricing it as if a CO had just ADDED it today.\n')

for (const p of (projects || []).filter((x) => x.imported_at)) {
  const org = orgById.get(p.org_id)
  // ⚠️ NOT filtered on product_key. Migrated lines have none — the importer
  // writes dept_hour_overrides + a material lump and no composer slots — so
  // filtering on it excluded every imported subproject and this half printed
  // nothing at all. What matters here is that the sub carries HOURS, because
  // hours are exactly what the old rule priced at $0.
  const candidates = (subsByProject.get(p.id) || [])
    .map((s) => ({
      s,
      ls: (linesBySub.get(s.id) || []).filter((l) =>
        Object.values(l.dept_hour_overrides || {}).some((h) => Number(h) > 0),
      ),
    }))
    .filter((x) => x.ls.length > 0)
  if (candidates.length === 0) continue
  const { s: sub } = candidates.sort((a, b) => b.ls.length - a.ls.length)[0]

  // OLD: the project is imported, so new scope was frozen too — material cost
  // only, no labor dollars, and the importer's pinned 0 margins on top.
  const oldBuckets = bucketsFor(sub, p, org, true)
  const oldPrice = Math.round(
    computeBucketedPrice(oldBuckets, resolveBucketMargins(p, org)).priceTotal,
  )
  // NEW: new scope is live — real rate, real consumables, org margins.
  const newBuckets = bucketsFor(sub, p, org, false)
  const newPrice = Math.round(
    computeBucketedPrice(newBuckets, resolveMarginsForNewScope(p, org)).priceTotal,
  )
  if (oldPrice === 0 && newPrice === 0) continue

  const hours = Object.values(
    computeSubprojectRollup(
      linesBySub.get(sub.id) || [],
      itemsById,
      new Map(),
      { shopRate: 1, consumableMarkupPct: 0, profitMarginPct: 0 },
      sub.quantity ?? 1,
    ).hoursByDept,
  ).reduce((a, b) => a + b, 0)

  console.log(`${p.name} → "${sub.name}"  (${hours.toFixed(1)}h of labor)`)
  console.log(
    `   BEFORE ${money(oldPrice)}   AFTER ${money(newPrice)}   ` +
      `under-billed by ${money(newPrice - oldPrice)}` +
      (oldPrice > 0 ? ` (${Math.round(((newPrice - oldPrice) / oldPrice) * 100)}%)` : ''),
  )
}
console.log('')
