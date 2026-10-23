// ============================================================================
// verify-shop-rate-change.mjs — PROVE a shop-rate OR default-margin change
// moves no price (118 + 121).
// ============================================================================
// Run: npx tsx scripts/verify-shop-rate-change.mjs            (static + live, READ ONLY)
//      npx tsx scripts/verify-shop-rate-change.mjs --static   (no database)
//      npx tsx scripts/verify-shop-rate-change.mjs --assume-118
//          (before 118 is on prod: applies its backfill IN MEMORY — pin every
//           unpinned project at today's org rate — and proves (a) the backfill
//           moves no number and (b) after it, a rate change moves nothing)
//
// Andrew's rule (2026-10-21): change the rate whenever; it must not touch
// anything being priced or already priced. This script is the audit's proof.
//
// PART 1 — STATIC. Every place the code reads the ORG's rate directly is on a
// reviewed allowlist (org-level surfaces, or a fallback behind the job's
// pinned rate). A new raw read FAILS the script until someone classifies it —
// that is how a project surface quietly starts pricing at the current rate.
//
// PART 2 — LIVE, READ ONLY. For every project in every org, each money number
// is computed TWICE through the app's own code — at the org's real rate and
// as if the org rate were $1 higher — and must not move:
//   · the project price (lib/project-totals computeProjectPrice — the number
//     bid_total, the kanban/sales/payments/portal cards, the project page
//     total and the estimate PDF subtotal all come from)
//   · every subproject's labor rate (effectiveShopRate — project page, sub
//     page, handoff, install prefill, CO pricing on pre-pro, co-docs)
//   · actual labor $ per job (/pm at-risk, the /time rollup's actual_total)
// It writes NOTHING: the "+$1" is passed as a what-if (`orgShopRate`), never
// saved to the org row. Results are grouped by state: open bid · sent ·
// sold+ · imported · temp.
//
// ⛔ Before migration 118 runs, PART 2 FAILS on every unpinned open bid —
// that is the bug this audit found, shown in dollars. After 118: zero diffs.
// ============================================================================

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const STATIC_ONLY = process.argv.includes('--static')
const ASSUME_118 = process.argv.includes('--assume-118')
const ASSUME_121 = process.argv.includes('--assume-121')
let failures = 0
const fail = (msg) => {
  failures++
  console.log(`  ✗ ${msg}`)
}

// ── PART 1: static ──────────────────────────────────────────────────────────
console.log('PART 1 — raw org-rate reads (must all be reviewed)')
// file → why a raw org-rate read is fine there.
const ALLOWED = {
  'app/(app)/pm/page.tsx': 'fallback only — ProjectsAtRiskCard prices each job at locked_shop_rate first',
  'app/(app)/settings/page.tsx': 'org-level: the rate setup itself',
  'app/(app)/projects/[id]/page.tsx': 'orgShopRate feeds effectiveShopRate + the gateway banner; == null check',
  'app/(app)/projects/[id]/handoff/page.tsx': 'orgShopRate feeds effectiveShopRate',
  'app/(app)/projects/[id]/subprojects/[subId]/page.tsx': '== null "not configured" check',
  'app/(app)/rate-book/page.tsx': 'org-level: rate book + rate modal',
  'app/api/shop-report/route.ts': 'org-level summary field + fallback behind locked_shop_rate',
  'app/api/guides/path/route.ts': 'org-level: has-a-rate check',
  'lib/project-totals.ts': 'fallback behind locked_shop_rate (+ the what-if)',
  'lib/pricing.ts': 'effectiveShopRate signature',
  'lib/change-orders.ts': 'doc comment',
  'components/project/ShopRateBanner.tsx': 'the gateway compares pinned vs org',
}
const raw = execSync(
  `grep -rnE "org\\??\\.shop_rate|orgShopRate|orgRow\\??\\.shop_rate" app lib components --include='*.ts' --include='*.tsx' || true`,
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter((l) => !/locked_shop_rate|effectiveShopRate/.test(l))
const seen = new Set()
for (const l of raw) {
  const file = l.slice(0, l.indexOf(':'))
  seen.add(file)
  if (!ALLOWED[file]) fail(`unreviewed org-rate read — classify it: ${l.trim().slice(0, 160)}`)
}
console.log(`  ${raw.length} raw reads in ${seen.size} files, all ${failures === 0 ? 'reviewed ✓' : 'NOT reviewed'}`)

// The composer rate book always carries the ORG rate; every project-context
// composer must be handed the job's rate.
for (const f of [
  'app/(app)/projects/[id]/subprojects/[subId]/page.tsx',
  'components/project/NewScopeDraftModal.tsx',
  'components/project/ReviseScopeModal.tsx',
]) {
  const src = fs.readFileSync(f, 'utf8')
  if (src.includes('<AddLineComposer') && !src.includes('jobShopRate={')) fail(`${f}: AddLineComposer without jobShopRate`)
}
const slot = fs.readFileSync('components/changeorders/SlotCoEditor.tsx', 'utf8')
if (!/shopRate: pricing\.shopRate/.test(slot)) fail('SlotCoEditor: CO labor no longer priced at pricing.shopRate')
const rollup = fs.readFileSync('lib/project-rollup.ts', 'utf8')
if (/\.update\(\{[^}]*bid_total/.test(rollup)) fail('lib/project-rollup writes bid_total again (the /time $0 bug)')
const totals = fs.readFileSync('lib/project-totals.ts', 'utf8')
if (!/select\(`\$\{SUB_COLS\}, price_frozen, quantity`\)/.test(totals))
  fail('lib/project-totals no longer selects subprojects.quantity — (QTY N) subs price ×1 (the COS bug)')
if (/frozen \? 0 : computeInstallCost/.test(totals))
  fail('lib/project-totals zeroes a frozen sub\'s install prefill again — Batia · Final loses $24,640')
const banner = fs.readFileSync('components/project/ShopRateBanner.tsx', 'utf8')
if (!/checkPriceAgrees/.test(banner)) fail('ShopRateBanner offers a recompute without the math-agrees guard')
// Margins (121): every file that RESOLVES margins must carry the project's
// lock — a resolver handed a row without `locked_margins` silently falls back
// to the org's CURRENT defaults, which is exactly the hole 121 closed.
const marginFiles = execSync(
  `grep -rlE "resolveBucketMargins\\(|resolveMarginsForNewScope\\(" app lib components --include='*.ts' --include='*.tsx' || true`,
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean)
  .filter((f) => f !== 'lib/pricing.ts')
for (const f of marginFiles) {
  if (!fs.readFileSync(f, 'utf8').includes('locked_margins')) fail(`${f} resolves margins without locked_margins (121)`)
}
console.log(`  ${marginFiles.length} files resolve margins, all carry the lock${failures === 0 ? ' ✓' : '?'}`)
console.log(failures === 0 ? '  composer / CO / rollup wiring ✓' : '')

if (STATIC_ONLY) {
  console.log(failures === 0 ? '\nPASS (static)' : `\nFAIL — ${failures}`)
  process.exit(failures === 0 ? 0 : 1)
}

// ── PART 2: live, read only ─────────────────────────────────────────────────
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}
// ⚠️ lib/project-totals reads through lib/supabase (the browser client).
// Hand it the service key so RLS doesn't blank every read. computeProjectPrice
// never writes; nothing below calls a function that does.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const { createClient } = await import('@supabase/supabase-js')
const { computeProjectPrice } = await import('../lib/project-totals.ts')
const { effectiveShopRate } = await import('../lib/pricing.ts')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

console.log(`\nPART 2 — every project, org rate +$1 and org margins +5pt (read only)${ASSUME_118 ? ' · ASSUMING 118' : ''}${ASSUME_121 ? ' · ASSUMING 121 (in-memory backfill)' : ''}`)
const { data: orgs } = await sb.from('orgs').select('id, name, shop_rate')
const { data: projects } = await sb
  .from('projects')
  .select('id, org_id, name, stage, bid_total, locked_shop_rate, imported_at, estimate_sent_at, temp_at')
// locked_margins read SEPARATELY: on a pre-121 database the column doesn't
// exist, and one unknown column fails the whole projects select.
const lockRes = await sb.from('projects').select('id, locked_margins')
const lockById = {}
for (const r of lockRes.error ? [] : lockRes.data || []) lockById[r.id] = r.locked_margins
const orgMarginsRes = await sb.from('orgs').select('id, labor_margin_pct, material_margin_pct, consumable_margin_pct')
const orgMargins = {}
for (const r of orgMarginsRes.data || [])
  orgMargins[r.id] = {
    labor: Number(r.labor_margin_pct ?? 35),
    material: Number(r.material_margin_pct ?? 35),
    consumable: Number(r.consumable_margin_pct ?? 35),
  }
const subsRes = await sb.from('subprojects').select('id, project_id, price_frozen')
const subsByProject = {}
for (const s of subsRes.data || []) (subsByProject[s.project_id] ||= []).push(s)

const PRESOLD = new Set(['new_lead', 'fifty_fifty', 'ninety_percent'])
const group = (p) =>
  p.temp_at ? 'temp' : p.imported_at ? 'imported' : !PRESOLD.has(p.stage) ? 'sold+' : p.estimate_sent_at ? 'sent' : 'open bid'
const tally = {}
let moved = 0
let drift = 0

for (const org of orgs || []) {
  const rate = Number(org.shop_rate) || 0
  if (rate <= 0) continue
  const bumped = rate + 1
  for (const p of (projects || []).filter((x) => x.org_id === org.id)) {
    const g = group(p)
    tally[g] ||= { n: 0, moved: 0 }
    tally[g].n++
    const problems = []

    // --assume-118: the backfill pins an unpinned project at today's rate.
    const pinned = Number(p.locked_shop_rate) || 0
    if (ASSUME_118 && !(pinned > 0)) p.locked_shop_rate = rate
    const a = await computeProjectPrice(p.id, { orgShopRate: rate })
    const b = await computeProjectPrice(
      p.id,
      ASSUME_118 && !(pinned > 0) ? { shopRate: rate, orgShopRate: bumped } : { orgShopRate: bumped },
    )
    if (a && b && Math.abs(a.priceTotal - b.priceTotal) > 0) problems.push(`price $${a.priceTotal} → $${b.priceTotal}`)
    if (ASSUME_118 && !(pinned > 0)) {
      // (a) the backfill itself: pinned-at-today must equal today's price.
      const pinnedNow = await computeProjectPrice(p.id, { shopRate: rate, orgShopRate: rate })
      if (a && pinnedNow && a.priceTotal !== pinnedNow.priceTotal)
        problems.push(`118 backfill moves price $${a.priceTotal} → $${pinnedNow.priceTotal}`)
    }
    if (a && Math.abs(a.priceTotal - (Number(p.bid_total) || 0)) > 1 && g !== 'temp') {
      drift++
      if (process.argv.includes('--drift'))
        console.log(`  (drift) ${g.padEnd(8)} stored $${Number(p.bid_total) || 0} · live $${a.priceTotal}  ${p.name}`)
    }

    for (const s of subsByProject[p.id] || []) {
      const r1 = effectiveShopRate(p, rate, s)
      const r2 = effectiveShopRate(p, bumped, s)
      if (r1 !== r2) {
        problems.push(`sub labor rate $${r1} → $${r2}`)
        break
      }
    }
    // /pm at-risk + /time rollup: locked first, org as fallback.
    const actual1 = Number(p.locked_shop_rate) || rate
    const actual2 = Number(p.locked_shop_rate) || bumped
    if (actual1 !== actual2) problems.push(`actual labor rate $${actual1} → $${actual2}`)

    // ── Margins (121): org default margins +5 pts must move nothing. ──
    const om = orgMargins[org.id]
    if (om) {
      const up = { labor: om.labor + 5, material: om.material + 5, consumable: om.consumable + 5 }
      const lock = lockById[p.id] || (ASSUME_121 ? om : undefined) // --assume-121: the backfill
      const m1 = await computeProjectPrice(p.id, { orgMargins: om, ...(lock ? { lockedMargins: lock } : {}) })
      const m2 = await computeProjectPrice(p.id, { orgMargins: up, ...(lock ? { lockedMargins: lock } : {}) })
      if (m1 && m2 && m1.priceTotal !== m2.priceTotal) problems.push(`margins +5pt: price $${m1.priceTotal} → $${m2.priceTotal}`)
      if (ASSUME_121 && !lockById[p.id] && a && m1 && a.priceTotal !== m1.priceTotal)
        problems.push(`121 backfill moves price $${a.priceTotal} → $${m1.priceTotal}`)
    }

    if (problems.length) {
      moved++
      tally[g].moved++
      fail(`[${org.name}] ${g.padEnd(8)} ${p.name}: ${problems.join(' · ')}`)
    }
  }
}
console.log('\n  state      projects  moved')
for (const [g, t] of Object.entries(tally)) console.log(`  ${g.padEnd(10)} ${String(t.n).padStart(8)}  ${t.moved}`)
console.log(`\n  (info) ${drift} project(s) whose stored bid_total differs from the live price by > $1 — a`)
console.log('         pre-existing denorm lag, unrelated to the rate; the next recompute settles it.')

console.log(failures === 0 ? '\nPASS — a shop-rate change moves nothing.' : `\nFAIL — ${failures} (moved projects: ${moved})`)
process.exit(failures === 0 ? 0 : 1)
