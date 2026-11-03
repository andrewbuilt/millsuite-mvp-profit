// ============================================================================
// verify-install-margin.mjs — PROVE the labor / install margin split (125)
// moves no price, and that the install knob moves ONLY install.
// ============================================================================
// Run: npx tsx scripts/verify-install-margin.mjs           (pure + static + live, READ ONLY)
//      npx tsx scripts/verify-install-margin.mjs --static  (no database)
//
// PART 1 — PURE. computeBucketedPrice / resolveBucketMargins on hand-built
// numbers: install at the labor margin == the old "labor + install" group to
// the cent; an install bump moves exactly install's share; the fallback chain
// (nothing set → labor · pre-125 lock → its labor, never the org's CURRENT
// install · pins win · imported jobs skip the importer's pins).
//
// PART 2 — STATIC. Every surface that lists the margin buckets carries install.
//
// PART 3 — LIVE, READ ONLY (needs 125 on the database). For every project:
//   (a) THE BACKFILL PROOF — priced as stored == priced the pre-125 way
//       (install forced to the labor number). Zero diffs = 125 moved nothing.
//   (b) org install default +5pt moves nothing (the 121 lock holds install).
//   (c) the project's install margin +5pt moves the price ONLY on jobs with
//       live install cost, by exactly that cost's re-margin; jobs without
//       install don't move at all.
// It writes NOTHING — every variation is a what-if passed to computeProjectPrice.
// ============================================================================

import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'

const STATIC_ONLY = process.argv.includes('--static')
let failures = 0
let checks = 0
const ok = (cond, msg) => {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${msg}`)
  }
}

const { computeBucketedPrice, resolveBucketMargins, resolveMarginsForNewScope } = await import('../lib/pricing.ts')

// ── PART 1: pure ────────────────────────────────────────────────────────────
console.log('PART 1 — pricing math')
const B = {
  laborCost: 41_230.5,
  installCost: 9_870.25,
  materialCost: 22_100,
  hardwareCost: 3_400,
  consumablesCost: 2_210,
  optionsCost: 1_150,
  customCost: 600,
}
const tm = (pct) => (cost) => cost / (1 - pct / 100)
const r2 = (n) => Math.round(n * 100) / 100
for (const lab of [0, 22.5, 35, 41]) {
  const m = { laborMarginPct: lab, installMarginPct: lab, materialMarginPct: 30, consumableMarginPct: 25 }
  const p = computeBucketedPrice(B, m)
  // The pre-125 formula: labor + install as ONE group at the labor margin.
  const old = r2(
    tm(lab)(B.laborCost + B.installCost) +
      tm(30)(B.materialCost + B.hardwareCost + B.optionsCost + B.customCost) +
      tm(25)(B.consumablesCost),
  )
  ok(Math.abs(p.priceTotal - old) < 0.011, `install = labor (${lab}%) prices like the old labor+install group: ${p.priceTotal} vs ${old}`)
  ok(p.laborGroupCost === r2(B.laborCost) && p.installGroupCost === r2(B.installCost), 'labor and install groups carry their own cost')
  ok(Math.abs(p.costTotal - r2(Object.values(B).reduce((a, b) => a + b, 0))) < 0.011, 'cost total still includes every bucket')

  const bumped = computeBucketedPrice(B, { ...m, installMarginPct: lab + 5 })
  const expect = r2(tm(lab + 5)(B.installCost) - tm(lab)(B.installCost))
  ok(Math.abs(bumped.priceTotal - p.priceTotal - expect) < 0.02, `install +5pt moves exactly install's share (${expect})`)
  ok(bumped.laborPrice === p.laborPrice && bumped.materialPrice === p.materialPrice && bumped.consumablePrice === p.consumablePrice, 'install +5pt leaves labor, material, consumables alone')
  const noInstall = { ...B, installCost: 0 }
  ok(
    computeBucketedPrice(noInstall, { ...m, installMarginPct: lab + 5 }).priceTotal === computeBucketedPrice(noInstall, m).priceTotal,
    'a job with no install cost does not move on an install change',
  )
}

// Resolution chain.
const R = (project, org) => resolveBucketMargins(project, org)
ok(R(null, null).installMarginPct === 35, 'nothing anywhere → 35 (labor\'s fallback)')
ok(R(null, { labor_margin_pct: 40 }).installMarginPct === 40, 'pre-125 org (no install column) → install follows labor')
ok(R({ labor_margin_pct: 28 }, { labor_margin_pct: 40 }).installMarginPct === 28, 'pre-125 project labor pin → install follows the pin')
ok(
  R({ locked_margins: { labor: 33, material: 35, consumable: 35 } }, { labor_margin_pct: 40, install_margin_pct: 50 }).installMarginPct === 33,
  'pre-125 lock (no install key) → its labor, NOT the org\'s current install',
)
ok(
  R({ locked_margins: { labor: 33, install: 31, material: 35, consumable: 35 } }, { install_margin_pct: 50 }).installMarginPct === 31,
  'a lock with install → that install',
)
ok(R({ install_margin_pct: 20, labor_margin_pct: 45 }, null).installMarginPct === 20, 'install pin wins over labor pin')
ok(R({ labor_margin_pct: 45 }, null).laborMarginPct === 45 && R({ install_margin_pct: 20 }, null).laborMarginPct === 35, 'labor ignores install entirely')
ok(R(null, { labor_margin_pct: 40, install_margin_pct: 22 }).installMarginPct === 22, 'post-125 org install default is used when nothing closer is set')
const imp = resolveMarginsForNewScope(
  { imported_at: '2026-07-17', labor_margin_pct: 0, install_margin_pct: 0, locked_margins: { labor: 35, install: 30, material: 35, consumable: 35 } },
  { labor_margin_pct: 40 },
)
ok(imp.installMarginPct === 30 && imp.laborMarginPct === 35, 'imported job: new scope skips the importer\'s 0% pins, follows the lock')
console.log(`  ${checks} checks${failures === 0 ? ' ✓' : ''}`)

// ── PART 2: static ──────────────────────────────────────────────────────────
console.log('\nPART 2 — every margin surface carries install')
const grepFiles = (re) =>
  execSync(`grep -rlE "${re}" app lib components --include='*.ts' --include='*.tsx' || true`, { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
const before = checks
// Anything that reads or writes the labor margin column must know install exists.
for (const f of grepFiles('labor_margin_pct')) {
  ok(fs.readFileSync(f, 'utf8').includes('install_margin_pct'), `${f} handles labor_margin_pct but not install_margin_pct`)
}
// Hand-built margin objects must name all four knobs (the compiler checks the
// type; this catches the plain-JS scripts that call the same functions).
for (const f of execSync(`grep -rlE "laborMarginPct: *0" app lib components scripts --include='*.ts' --include='*.tsx' --include='*.mjs' || true`, { encoding: 'utf8' }).split('\n').filter(Boolean)) {
  if (f === 'scripts/verify-install-margin.mjs') continue
  ok(fs.readFileSync(f, 'utf8').includes('installMarginPct'), `${f} builds a margins object without installMarginPct`)
}
const page = fs.readFileSync('app/(app)/projects/[id]/page.tsx', 'utf8')
ok(!/label="Labor \+ install"/.test(page) && /label="Install"/.test(page), 'project page shows Labor and Install as separate margin rows')
ok(/'install_margin_pct'/.test(page), 'project MARGINS editor can pin install')
const settings = fs.readFileSync('app/(app)/settings/page.tsx', 'utf8')
ok(/install_margin_pct: parseFloat\(installMargin\)/.test(settings), 'Settings saves the install default')
const gateway = fs.readFileSync('lib/shop-rate-gateway.ts', 'utf8')
ok(/\['install', 'install_margin_pct'\]/.test(gateway), 'margin banner offers the install bucket')
const mig = fs.readFileSync('db/migrations/125_november_batch.sql', 'utf8')
ok(/'install',\s+COALESCE\(o\.install_margin_pct, o\.labor_margin_pct, 35\)/.test(mig), '125 stamps install on new projects')
ok(/locked_margins \|\| jsonb_build_object\('install', locked_margins->'labor'\)/.test(mig), '125 backfills the lock from labor')
ok(/margins_ignored \|\| jsonb_build_object\('install', margins_ignored->'labor'\)/.test(mig), '125 backfills "Keep" from labor')
const importer = fs.readFileSync('scripts/migrate-built/entities.ts', 'utf8')
ok((importer.match(/install_margin_pct:/g) || []).length >= 2, 'the Built importer pins install with labor')
console.log(`  ${checks - before} checks${failures === 0 ? ' ✓' : ''}`)

if (STATIC_ONLY) {
  console.log(failures === 0 ? `\nPASS (pure + static) — ${checks} checks` : `\nFAIL — ${failures} of ${checks}`)
  process.exit(failures === 0 ? 0 : 1)
}

// ── PART 3: live, read only ─────────────────────────────────────────────────
for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}
// lib/project-totals reads through lib/supabase (the browser client); hand it
// the service key so RLS doesn't blank every read. Nothing below writes.
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const { createClient } = await import('@supabase/supabase-js')
const { computeProjectPrice } = await import('../lib/project-totals.ts')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

console.log('\nPART 3 — every project, live (read only)')
const probe = await sb.from('projects').select('id, install_margin_pct').limit(1)
if (probe.error) {
  console.log(`  ⛔ projects.install_margin_pct isn't there (${probe.error.message}).`)
  console.log('     Run db/migrations/125_november_batch.sql on the database first, then re-run.')
  process.exit(1)
}
const { data: orgs } = await sb.from('orgs').select('id, name, labor_margin_pct, install_margin_pct, material_margin_pct, consumable_margin_pct')
const { data: projects } = await sb.from('projects').select('id, org_id, name, stage, imported_at, temp_at, locked_margins')
const PRESOLD = new Set(['new_lead', 'fifty_fifty', 'ninety_percent'])
const group = (p) => (p.temp_at ? 'temp' : p.imported_at ? 'imported' : !PRESOLD.has(p.stage) ? 'sold+' : 'bid')
const tally = {}
let withInstall = 0
const live = { checked: 0 }

for (const org of orgs || []) {
  const om = {
    labor: Number(org.labor_margin_pct ?? 35),
    install: Number(org.install_margin_pct ?? org.labor_margin_pct ?? 35),
    material: Number(org.material_margin_pct ?? 35),
    consumable: Number(org.consumable_margin_pct ?? 35),
  }
  for (const p of (projects || []).filter((x) => x.org_id === org.id)) {
    const g = group(p)
    tally[g] ||= { n: 0, moved: 0 }
    tally[g].n++
    const problems = []
    const now = await computeProjectPrice(p.id)
    if (!now) continue
    live.checked++
    // (a) the backfill: the pre-125 formula priced install at the labor number.
    const pre = await computeProjectPrice(p.id, { mapMargins: (m) => ({ ...m, installMarginPct: m.laborMarginPct }) })
    if (pre && pre.priceTotal !== now.priceTotal) problems.push(`125 moved the price $${pre.priceTotal} → $${now.priceTotal}`)
    // (b) the org's install default +5pt moves nothing.
    const orgUp = await computeProjectPrice(p.id, { orgMargins: { ...om, install: om.install + 5 } })
    if (orgUp && orgUp.priceTotal !== now.priceTotal) problems.push(`org install +5pt moved $${now.priceTotal} → $${orgUp.priceTotal}`)
    // (c) this project's install +5pt moves only install.
    const instUp = await computeProjectPrice(p.id, { mapMargins: (m) => ({ ...m, installMarginPct: m.installMarginPct + 5 }) })
    const ic = Number(now.liveInstallCost) || 0
    if (ic > 0) withInstall++
    if (instUp) {
      if (ic === 0 && instUp.priceTotal !== now.priceTotal) problems.push(`no live install, but install +5pt moved $${now.priceTotal} → $${instUp.priceTotal}`)
      if (ic > 0 && !(instUp.priceTotal > now.priceTotal)) problems.push(`$${Math.round(ic)} live install, but install +5pt didn't move the price`)
    }
    if (problems.length) {
      tally[g].moved++
      ok(false, `[${org.name}] ${g.padEnd(8)} ${p.name}: ${problems.join(' · ')}`)
    } else checks++
  }
}
console.log('\n  state      projects  moved')
for (const [g, t] of Object.entries(tally)) console.log(`  ${g.padEnd(10)} ${String(t.n).padStart(8)}  ${t.moved}`)
console.log(`  ${live.checked} priced · ${withInstall} carry live install cost (the only ones an install change can touch)`)

console.log(failures === 0 ? `\nPASS — the split moved nothing; install moves only install. (${checks} checks)` : `\nFAIL — ${failures} of ${checks}`)
process.exit(failures === 0 ? 0 : 1)
