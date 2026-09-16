// ============================================================================
// scripts/seed-demo-completed-projects.mjs — 7 completed projects for the
// marketing-site screenshot of Reports → Completed Projects
// ============================================================================
// Brief: docs/marketing-site-demo-data-brief.md. Seeds a DEDICATED demo org
// (Bayside Millworks — created separately via create-customer-org.mjs) with
// seven closed jobs whose margins are deliberately not all green, one of which
// (#7, Meridian Storefront) also fires the /reports Margin-alerts panel and
// carries a big_up rate-correction suggestion on Finish/Install hours.
//
// WHAT EACH SURFACE READS (verified against the code 2026-09-16):
//   • Completed Projects list + DiagnosticDrawer — project_outcomes rows only
//     (app/(app)/reports/page.tsx loadData). Margins here are whatever the
//     outcome row says; this script COMPUTES them (revenue − hours×rate − mat)
//     so the waterfall can't disagree with the list.
//   • Margin alerts (MarginsCard) — ACTIVE projects only (stage sold/
//     production/installed), effRate = bid_total / estimate-line hours,
//     alert when effRate < derived break-even × 1.15. Break-even comes from
//     orgs.overhead_inputs + team comp + billable hours, so this script seeds
//     the org's shop economics too. #7 sits at stage 'installed' — the one
//     stage that is BOTH "closed" (lib/closed-jobs.ts) and alert-eligible.
//   • Suggestions — lib/closed-jobs.ts rolls up estimate lines that have a
//     rate_book_item_id, apportioning the sub's time_entries minutes. The two
//     "wall paneling" subs (#2 and #7) each hold exactly ONE book-linked line
//     so their actuals attribute cleanly; ratio ≈ 1.25 ⇒ big_up.
//
// TRAPS THIS SCRIPT KNOWS ABOUT:
//   • unit_price_override on an estimate line ZEROES its hours
//     (computeLineBuildup short-circuit) — so no line here uses it. Freeform
//     lines carry hours via dept_hour_overrides (per-unit, qty 1); the
//     paneling lines inherit hours from the rate-book item × quantity.
//   • Comp must NOT go into orgs.team_members jsonb (migration 087 moved it
//     to team_compensation, owner-only RLS). Roster here carries no comp;
//     team_compensation rows carry it.
//   • A Re-scan on /suggestions will KEEP this suggestion active (the seeded
//     evidence really does classify big_up) but will overwrite the proposed
//     per-LF hour changes with per-job totals (classify() compares per-unit
//     baseline to mean per-job actuals). Don't hit Re-scan before the
//     screenshot; if you do, re-run this script with --apply to restore.
//   • Dates are ABSOLUTE, anchored to Sept 2026 so all 7 fall inside the
//     default 90-day period selector. Re-anchor COMPLETIONS below if reusing
//     this later.
//
// SAFETY:
//   • Org id is a required argument; refuses Built's org outright.
//   • Refuses any org that already has projects NOT created by this seed —
//     it only ever writes into a dedicated demo org.
//   • Preview by default; --apply required to write.
//   • Idempotent: every row has a fixed UUID (prefix ba9d0000-…) and is
//     upserted, so a re-run repairs drift instead of duplicating.
//
// CLEANUP: scripts/reset-org-data.mjs <org-id> clears the project work; it
// KEEPS rate_book_items and does not touch item_suggestions or the org's
// team/overhead jsonb. Full demo removal =
//   DELETE FROM item_suggestions   WHERE id::text LIKE 'ba9d0000%';
//   DELETE FROM rate_book_items    WHERE id::text LIKE 'ba9d0000%';
// then reset-org-data.mjs (or just retire the org).
//
//   node scripts/seed-demo-completed-projects.mjs <org-id>
//   node scripts/seed-demo-completed-projects.mjs <org-id> --apply
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

const BUILT_ORG = '85b67e22-ebf4-4d78-94e8-3b1c73ca702f'
const SHOP_RATE = 85 // locked on every project; outcome labor cost basis

const orgId = process.argv[2]
const apply = process.argv.includes('--apply')

if (!orgId || !/^[0-9a-f-]{36}$/i.test(orgId)) {
  console.error('Usage: node scripts/seed-demo-completed-projects.mjs <org-id> [--apply]')
  process.exit(1)
}
if (orgId === BUILT_ORG) {
  console.error("Refusing to seed demo data into Built's org.")
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Fixed, recognizable UUIDs. Tail = 2-char table code + zero-padded counter.
const CODE = {
  client: '01', project: '02', sub: '03', line: '04', recv: '05',
  time: '06', outcome: '07', item: '08', suggestion: '09', member: '0a',
}
function mkid(code, n) {
  return `ba9d0000-0000-4000-8000-${code}${String(n).padStart(10, '0')}`
}

// ── Shop economics ───────────────────────────────────────────────────────────
// Derived break-even = (overhead + ALL comp) / billable hours
//   = (169,200 + 405,000) / (5 × 40 × 46 × 0.80) = 574,200 / 7,360 = $78.02/h
// Alert threshold = ×1.15 = $89.72/h. #7's effRate (21,300 / 240h = $88.75)
// lands inside the orange band: above break-even, under target.
const OVERHEAD = {
  Rent: { amount: 6800, period: 'monthly' },
  Utilities: { amount: 1450, period: 'monthly' },
  Insurance: { amount: 1150, period: 'monthly' },
  Software: { amount: 650, period: 'monthly' },
  Vehicle: { amount: 950, period: 'monthly' },
  'Shop consumables': { amount: 1250, period: 'monthly' },
  Tools: { amount: 850, period: 'monthly' },
  Other: { amount: 1000, period: 'monthly' },
}
const BILLABLE = { hrs_per_week: 40, weeks_per_year: 46, utilization_pct: 80 }
// name, title, comp, billable, canonical dept keys (mapped to real dept ids
// at runtime). Comp goes to team_compensation, NEVER the jsonb roster.
const ROSTER = [
  { n: 1, name: 'Dan Whitaker', title: 'Owner', comp: 110000, billable: false, depts: [] },
  { n: 2, name: 'Luis Herrera', title: 'Engineering & CNC', comp: 68000, billable: true, depts: ['eng', 'cnc'] },
  { n: 3, name: 'Marcus Bell', title: 'CNC Operator', comp: 62000, billable: true, depts: ['cnc'] },
  { n: 4, name: 'Tony Alvarez', title: 'Bench Lead', comp: 58000, billable: true, depts: ['assembly'] },
  { n: 5, name: 'Sam Pruitt', title: 'Finisher', comp: 55000, billable: true, depts: ['finish'] },
  { n: 6, name: 'Cole Jensen', title: 'Installer', comp: 52000, billable: true, depts: ['assembly', 'install'] },
]
const BREAK_EVEN =
  (Object.values(OVERHEAD).reduce((s, o) => s + o.amount * 12, 0) +
    ROSTER.reduce((s, m) => s + m.comp, 0)) /
  (ROSTER.filter((m) => m.billable).length *
    BILLABLE.hrs_per_week * BILLABLE.weeks_per_year * (BILLABLE.utilization_pct / 100))

// ── Rate-book item behind the suggestion ────────────────────────────────────
const PANEL_ITEM = {
  id: mkid(CODE.item, 1),
  name: 'Paint-grade wall paneling — site finish',
  unit: 'lf',
  hours: { eng: 0.05, cnc: 0.1, assembly: 0.15, finish: 0.3, install: 0.25 }, // per lf
}

// ── The seven jobs ──────────────────────────────────────────────────────────
// All fictional Tampa clients. Dept splits are hours; est comes from estimate
// lines, act becomes time entries — both are the SAME tables the app reads,
// so the suggestion evidence and the outcome row agree by construction.
// subs[].panelLf marks the sub whose single line links PANEL_ITEM (hours then
// come from the item × qty; the others use dept_hour_overrides, qty 1).
const D = (eng, cnc, assembly, finish, install) => ({ eng, cnc, assembly, finish, install })
const JOBS = [
  {
    n: 1, name: 'Vega Residence — Painted Shaker Kitchen', stage: 'complete',
    client: { name: 'Marisol Vega', type: 'D2C', email: 'marisol.vega@example.com', phone: '813-555-0141', address: '4212 W Euclid Ave, Tampa, FL' },
    price: 72000, coCount: 0, coRevenue: 0, matAct: 20400,
    sold: '2026-05-22', completed: '2026-09-08',
    subs: [
      { name: 'Perimeter & Island Cabinets', est: D(22, 46, 82, 46, 34), act: D(21, 44, 79, 45, 33), mat: 15500, price: 52000 },
      { name: 'Pantry & Hutch', est: D(10, 18, 30, 18, 14), act: D(9, 17, 29, 17, 14), mat: 5500, price: 20000 },
    ],
  },
  {
    n: 2, name: 'Sandpiper Lane Library Wall', stage: 'complete',
    client: { name: 'Evan & Priya Kellerman', type: 'D2C', email: 'kellerman.home@example.com', phone: '813-555-0177', address: '711 Sandpiper Ln, Tampa, FL' },
    price: 48500, coCount: 0, coRevenue: 0, matAct: 13400,
    sold: '2026-05-06', completed: '2026-08-28',
    subs: [
      { name: 'Library Wall Built-in', est: D(16, 36, 56, 28, 24), act: D(15, 34, 54, 26, 23), mat: 11000, price: 38500 },
      { name: 'Wall Paneling', panelLf: 60, est: D(3, 6, 9, 18, 15), act: D(3, 6, 9.5, 24, 19), mat: 2600, price: 10000 },
    ],
  },
  {
    n: 3, name: 'Gulfview Kitchen — Rift Oak', stage: 'complete',
    client: { name: 'Corinne Delacroix', type: 'D2C', email: 'c.delacroix@example.com', phone: '727-555-0132', address: '2905 Gulfview Dr, Clearwater, FL' },
    price: 98000, coCount: 1, coRevenue: 4500, matAct: 35600,
    sold: '2026-04-10', completed: '2026-08-14',
    subs: [
      { name: 'Main Kitchen Run', est: D(24, 50, 88, 50, 38), act: D(25, 52, 92, 54, 39), mat: 23000, price: 68000 },
      { name: 'Island & Tall Units', est: D(12, 26, 46, 26, 20), act: D(13, 28, 49, 29, 21), mat: 11000, price: 30000 },
    ],
  },
  {
    n: 4, name: 'Palm & Pine Salon — Reception Desk', stage: 'complete',
    client: { name: 'Palm & Pine Salon Group', type: 'B2B', email: 'build@palmandpine.example.com', phone: '813-555-0190', address: '1808 N Franklin St, Tampa, FL' },
    price: 36500, coCount: 0, coRevenue: 0, matAct: 13000,
    sold: '2026-04-28', completed: '2026-07-30',
    subs: [
      { name: 'Reception Desk & Backwall', est: D(14, 30, 52, 32, 22), act: D(14, 31, 54, 34, 22), mat: 12500, price: 36500 },
    ],
  },
  {
    n: 5, name: 'Cypress Social — Bar & Banquette Run', stage: 'complete',
    client: { name: 'Cypress Social', type: 'B2B', email: 'ops@cypresssocial.example.com', phone: '813-555-0164', address: '520 S Howard Ave, Tampa, FL' },
    price: 58500, coCount: 0, coRevenue: 0, matAct: 19300,
    sold: '2026-03-30', completed: '2026-07-16',
    subs: [
      { name: 'Back Bar & Front Bar', est: D(16, 36, 60, 34, 24), act: D(17, 38, 63, 36, 25), mat: 14500, price: 43500 },
      { name: 'Banquette Millwork', est: D(6, 14, 26, 14, 10), act: D(6, 15, 27, 15, 10), mat: 4000, price: 15000 },
    ],
  },
  {
    n: 6, name: 'Bayshore Closet System', stage: 'complete',
    client: { name: 'Danielle Okafor', type: 'D2C', email: 'd.okafor@example.com', phone: '813-555-0119', address: '3404 Bayshore Blvd, Tampa, FL' },
    price: 31500, coCount: 0, coRevenue: 0, matAct: 12100,
    sold: '2026-04-18', completed: '2026-07-02',
    subs: [
      { name: 'Primary Suite Closet', est: D(12, 26, 44, 28, 20), act: D(13, 28, 50, 36, 25), mat: 11200, price: 31500 },
    ],
  },
  {
    // Stage 'installed' on purpose: closed (all draws received, no open
    // clock-ins) so it reaches Completed Projects via its outcome row, AND
    // still inside the margin-alert query's active-stage set.
    n: 7, name: 'Meridian Storefront Build-out', stage: 'installed',
    client: { name: 'Meridian Retail Group', type: 'B2B', email: 'projects@meridianretail.example.com', phone: '813-555-0108', address: '1120 E Kennedy Blvd, Tampa, FL' },
    price: 21300, coCount: 0, coRevenue: 0, matAct: 2050,
    sold: '2026-06-05', completed: '2026-09-12',
    subs: [
      { name: 'Storefront Paneling', panelLf: 120, est: D(6, 12, 18, 36, 30), act: D(6, 12, 19, 50, 43), mat: 1100, price: 10600 },
      { name: 'Trim & Fixture Install', est: D(6, 10, 32, 38, 52), act: D(6, 10, 30, 40, 48), mat: 700, price: 10700 },
    ],
  },
]

// Margin bands from the brief — the script REFUSES to seed numbers that
// drifted out of band, so a future edit can't silently break the story.
const BANDS = { 1: [33, 36], 2: [33, 36], 3: [28, 32], 4: [28, 32], 5: [28, 32], 6: [18, 22], 7: [-100, 0] }

const DEPT_KEYS = ['eng', 'cnc', 'assembly', 'finish', 'install']
const DEPT_LABEL = { eng: 'Engineering', cnc: 'CNC', assembly: 'Assembly', finish: 'Finish', install: 'Install' }
const sum = (d) => DEPT_KEYS.reduce((s, k) => s + (d[k] || 0), 0)
const round2 = (n) => Math.round(n * 100) / 100
const round1 = (n) => Math.round(n * 10) / 10

// ── Derive + verify every job's numbers ─────────────────────────────────────
const derived = JOBS.map((j) => {
  const estHours = j.subs.reduce((s, sp) => s + sum(sp.est), 0)
  const actHours = j.subs.reduce((s, sp) => s + sum(sp.act), 0)
  const estMat = j.subs.reduce((s, sp) => s + sp.mat, 0)
  const revenue = j.price + j.coRevenue
  const labor = actHours * SHOP_RATE
  const margin = revenue - labor - j.matAct
  const marginPct = (margin / revenue) * 100
  const effRate = j.price / estHours // what the margin-alert panel computes
  const estByDept = {}
  const actByDept = {}
  for (const k of DEPT_KEYS) {
    estByDept[DEPT_LABEL[k]] = round1(j.subs.reduce((s, sp) => s + (sp.est[k] || 0), 0))
    actByDept[DEPT_LABEL[k]] = round1(j.subs.reduce((s, sp) => s + (sp.act[k] || 0), 0))
  }
  const [lo, hi] = BANDS[j.n]
  if (marginPct < lo || marginPct > hi) {
    console.error(`Job ${j.n} "${j.name}" margin ${marginPct.toFixed(1)}% is outside its band ${lo}–${hi}%.`)
    process.exit(1)
  }
  return { ...j, estHours, actHours, estMat, revenue, labor, margin, marginPct, effRate, estByDept, actByDept }
})

// #7 must actually fire the alert: break-even < effRate < break-even × 1.15
const seven = derived.find((j) => j.n === 7)
if (!(seven.effRate > BREAK_EVEN && seven.effRate < BREAK_EVEN * 1.15)) {
  console.error(`Job 7 effRate $${seven.effRate.toFixed(2)}/h misses the alert window ($${BREAK_EVEN.toFixed(2)}–$${(BREAK_EVEN * 1.15).toFixed(2)}).`)
  process.exit(1)
}
// The paneling evidence must classify big_up (ratio ≥ 1.2 across the 2 jobs)
const panelJobs = derived.filter((j) => j.subs.some((s) => s.panelLf))
const panelRatio =
  panelJobs.reduce((s, j) => s + sum(j.subs.find((x) => x.panelLf).act), 0) /
  panelJobs.reduce((s, j) => s + sum(j.subs.find((x) => x.panelLf).est), 0)
if (panelJobs.length < 2 || panelRatio < 1.2) {
  console.error(`Paneling evidence won't classify big_up (jobs=${panelJobs.length}, ratio=${panelRatio.toFixed(3)}).`)
  process.exit(1)
}

// ── Preview ─────────────────────────────────────────────────────────────────
console.log(`\nBayside Millworks demo seed — 7 completed projects`)
console.log(`Derived break-even $${BREAK_EVEN.toFixed(2)}/h · alert threshold $${(BREAK_EVEN * 1.15).toFixed(2)}/h · shop rate $${SHOP_RATE}/h\n`)
for (const j of derived) {
  const alert = j.stage === 'installed' && j.effRate < BREAK_EVEN * 1.15
  console.log(
    `  ${j.n}. ${j.name.padEnd(42)} ${j.stage.padEnd(9)} ` +
    `$${String(j.revenue).padStart(6)}  ${String(j.estHours).padStart(3)}h est/${String(j.actHours).padStart(5)}h act  ` +
    `margin ${j.marginPct >= 0 ? '+' : ''}${j.marginPct.toFixed(1)}%` +
    (alert ? `  ⚠ MARGIN ALERT ($${j.effRate.toFixed(2)}/h)` : ''),
  )
}
console.log(`\n  Paneling suggestion ratio ${panelRatio.toFixed(2)} across ${panelJobs.length} jobs → big_up on Finish/Install`)

// ── Preflight ───────────────────────────────────────────────────────────────
const { data: org, error: orgErr } = await sb
  .from('orgs')
  .select('id, name, slug, plan')
  .eq('id', orgId)
  .single()
if (orgErr || !org) {
  console.error('\nNo org with that id.', orgErr?.message ?? '')
  process.exit(1)
}
if (org.slug === 'built') {
  console.error("\nRefusing: that's Built's slug.")
  process.exit(1)
}
console.log(`\nTarget org: ${org.name} (slug: ${org.slug}, plan: ${org.plan})`)

// Only ever write into a dedicated demo org: any project we didn't create
// means this org has real (or other) work in it. Filtered in JS — PostgREST
// can't LIKE a uuid column (the SQL seeds cast id::text for the same reason).
const { data: allProjects } = await sb
  .from('projects')
  .select('id, name')
  .eq('org_id', orgId)
const foreign = (allProjects || []).filter((p) => !String(p.id).startsWith('ba9d0000'))
if ((foreign || []).length > 0) {
  console.error(`\nRefusing: org has ${foreign.length} project(s) this seed didn't create (e.g. "${foreign[0].name}").`)
  console.error('This script only writes into a dedicated demo org.')
  process.exit(1)
}

// Departments were created by create_org_with_owner — map canonical keys.
const { data: depts } = await sb.from('departments').select('id, name').eq('org_id', orgId)
const deptId = {}
for (const d of depts || []) {
  const n = d.name.toLowerCase()
  if (n.includes('eng')) deptId.eng = d.id
  else if (n.includes('cnc')) deptId.cnc = d.id
  else if (n.includes('assembly') || n.includes('bench')) deptId.assembly = d.id
  else if (n.includes('finish') || n.includes('paint') || n.includes('sand')) deptId.finish = d.id
  else if (n.includes('install')) deptId.install = d.id
}
const missing = DEPT_KEYS.filter((k) => !deptId[k])
if (missing.length) {
  console.error(`\nOrg is missing canonical departments: ${missing.join(', ')}. Was it created by create-customer-org.mjs?`)
  process.exit(1)
}

// time_entries.user_id FKs users(id) — use the org's owner login.
const { data: users } = await sb.from('users').select('id, email, role').eq('org_id', orgId)
const owner = (users || []).find((u) => u.role === 'owner') || (users || [])[0]
if (!owner) {
  console.error('\nOrg has no users row — cannot attribute time entries.')
  process.exit(1)
}

if (!apply) {
  console.log('\nPreview only — nothing written. Re-run with --apply.')
  process.exit(0)
}

// ── Build rows ──────────────────────────────────────────────────────────────
const clients = []
const projects = []
const subs = []
const lines = []
const recvs = []
const times = []
const outcomes = []
let subN = 0, lineN = 0, recvN = 0, timeN = 0

// Deterministic time entries: walk workdays backward from the completion
// date, one ≤8h entry per day per (sub, dept), so re-runs write identical rows.
function* workdaysBack(fromIso) {
  const d = new Date(`${fromIso}T12:00:00Z`)
  for (;;) {
    d.setUTCDate(d.getUTCDate() - 1)
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
    yield d.toISOString().slice(0, 10)
  }
}

for (const j of derived) {
  const clientId = mkid(CODE.client, j.n)
  clients.push({
    id: clientId, org_id: orgId, name: j.client.name, type: j.client.type,
    email: j.client.email, phone: j.client.phone, address: j.client.address,
    notes: 'Demo data — fictional client (marketing screenshots).',
  })
  const projectId = mkid(CODE.project, j.n)
  projects.push({
    id: projectId, org_id: orgId, name: j.name, stage: j.stage,
    client_id: clientId, client_name: j.client.name, client_email: j.client.email, client_phone: j.client.phone,
    bid_total: j.price, estimated_price: j.price, estimated_hours: j.estHours,
    locked_shop_rate: SHOP_RATE,
    sold_at: `${j.sold}T14:00:00Z`, completed_at: `${j.completed}T21:00:00Z`,
    notes: 'Demo data — seeded for marketing screenshots. Not a real job.',
  })

  for (const [si, sp] of j.subs.entries()) {
    const subId = mkid(CODE.sub, ++subN)
    sp._id = subId
    subs.push({
      id: subId, org_id: orgId, project_id: projectId, name: sp.name, sort_order: si,
      estimated_hours: sum(sp.est), estimated_price: sp.price, price: sp.price,
      material_cost: sp.mat,
    })
    const lineId = mkid(CODE.line, ++lineN)
    sp._lineId = lineId
    if (sp.panelLf) {
      // Hours inherit from the rate-book item × quantity — this line IS the
      // suggestion evidence, so no overrides.
      lines.push({
        id: lineId, subproject_id: subId, sort_order: 0,
        description: `${PANEL_ITEM.name} — ${sp.panelLf} lf`,
        rate_book_item_id: PANEL_ITEM.id, quantity: sp.panelLf, unit: 'lf',
      })
    } else {
      lines.push({
        id: lineId, subproject_id: subId, sort_order: 0,
        description: `${sp.name} — shop labor`,
        rate_book_item_id: null, quantity: 1, unit: 'lot',
        dept_hour_overrides: sp.est,
      })
    }

    // Time entries: per dept, chunk actual hours into daily entries.
    for (const k of DEPT_KEYS) {
      let remaining = (sp.act[k] || 0) * 60
      const days = workdaysBack(j.completed)
      while (remaining > 0.5) {
        const mins = Math.min(480, remaining)
        remaining -= mins
        const day = days.next().value
        const started = `${day}T13:00:00Z` // 8–9am Tampa
        const ended = new Date(new Date(started).getTime() + mins * 60000).toISOString()
        times.push({
          id: mkid(CODE.time, ++timeN), org_id: orgId, user_id: owner.id,
          project_id: projectId, subproject_id: subId, department_id: deptId[k],
          employee_type: 'builder', started_at: started, ended_at: ended,
          duration_minutes: Math.round(mins), notes: `${DEPT_LABEL[k]} — ${sp.name}`,
        })
      }
    }
  }

  // Draws: deposit at sold, progress midway, final at completion — all
  // received, which is one of lib/closed-jobs.ts's three closure signals.
  const mid = new Date((new Date(`${j.sold}T00:00:00Z`).getTime() + new Date(`${j.completed}T00:00:00Z`).getTime()) / 2)
    .toISOString().slice(0, 10)
  const draws = [
    { label: 'Deposit', pct: 50, date: j.sold },
    { label: 'Progress', pct: 40, date: mid },
    { label: 'Final', pct: 10, date: j.completed },
  ]
  let allocated = 0
  for (const [di, dr] of draws.entries()) {
    const amount = di === draws.length - 1 ? j.price - allocated : Math.round((j.price * dr.pct) / 100)
    allocated += amount
    recvs.push({
      id: mkid(CODE.recv, ++recvN), org_id: orgId, project_id: projectId,
      type: 'receivable', milestone_label: dr.label, milestone_pct: dr.pct,
      amount, status: 'received', received_amount: amount,
      expected_date: dr.date, received_date: dr.date,
    })
  }
  if (j.coRevenue > 0) {
    recvs.push({
      id: mkid(CODE.recv, ++recvN), org_id: orgId, project_id: projectId,
      type: 'receivable', milestone_label: 'Change order — hood surround', milestone_pct: null,
      amount: j.coRevenue, status: 'received', received_amount: j.coRevenue,
      expected_date: j.completed, received_date: j.completed,
    })
  }

  outcomes.push({
    id: mkid(CODE.outcome, j.n), org_id: orgId, project_id: projectId,
    estimated_hours: round1(j.estHours), estimated_materials: round2(j.estMat), estimated_price: round2(j.price),
    actual_hours: round1(j.actHours), actual_labor_cost: round2(j.labor),
    actual_materials: round2(j.matAct), actual_revenue: round2(j.revenue),
    actual_margin: round2(j.margin), actual_margin_pct: round1(j.marginPct),
    hours_variance: round1(j.actHours - j.estHours),
    hours_variance_pct: round1(((j.actHours - j.estHours) / j.estHours) * 100),
    material_variance: round2(j.matAct - j.estMat),
    material_variance_pct: round1(((j.matAct - j.estMat) / j.estMat) * 100),
    dept_hours_estimated: j.estByDept, dept_hours_actual: j.actByDept,
    shop_rate_at_completion: SHOP_RATE, utilization_at_completion: null, headcount_at_completion: 6,
    change_order_count: j.coCount, change_order_revenue: j.coRevenue,
    completed_at: `${j.completed}T21:00:00Z`,
  })
}

// Suggestion evidence mirrors lib/closed-jobs.ts's rollup shape exactly.
const evJobs = panelJobs.map((j) => {
  const sp = j.subs.find((x) => x.panelLf)
  const estM = {}, actM = {}
  for (const k of DEPT_KEYS) {
    estM[k] = (sp.est[k] || 0) * 60
    actM[k] = (sp.act[k] || 0) * 60
  }
  return {
    projectId: mkid(CODE.project, j.n), projectName: j.name,
    subprojectId: sp._id, estimateLineId: sp._lineId, quantity: sp.panelLf,
    estimatedMinutesByDept: estM, actualMinutesByDept: actM,
    estimatedMinutesTotal: sum(sp.est) * 60, actualMinutesTotal: sum(sp.act) * 60,
    closedAt: `${j.completed}T21:00:00Z`,
  }
})
const meanBy = (sel) => {
  const out = {}
  for (const k of DEPT_KEYS) out[k] = evJobs.reduce((s, ej) => s + sel(ej)[k], 0) / evJobs.length
  return out
}
const suggestion = {
  id: mkid(CODE.suggestion, 1), org_id: orgId, rate_book_item_id: PANEL_ITEM.id,
  suggestion_type: 'big_up', status: 'active',
  evidence: {
    itemName: PANEL_ITEM.name,
    baselineMinutesByDept: Object.fromEntries(DEPT_KEYS.map((k) => [k, PANEL_ITEM.hours[k] * 60])),
    jobs: evJobs,
    meanActualByDept: meanBy((ej) => ej.actualMinutesByDept),
    meanEstimateByDept: meanBy((ej) => ej.estimatedMinutesByDept),
    ratio: round2(panelRatio),
    coefficientOfVariation: 0.36,
  },
  source_job_ids: panelJobs.map((j) => mkid(CODE.project, j.n)),
  excluded_job_ids: [],
  proposed_changes: {
    field_changes: [
      { field: 'base_labor_hours_finish', from: 0.3, to: 0.41 },
      { field: 'base_labor_hours_install', from: 0.25, to: 0.34 },
      { field: 'base_labor_hours_assembly', from: 0.15, to: 0.16 },
    ],
  },
  rationale: `Mean actual is ${Math.round(panelRatio * 100)}% of estimate across ${panelJobs.length} closed jobs — Finish and Install are carrying the overrun. Suggesting bump.`,
}

// ── Write ───────────────────────────────────────────────────────────────────
async function upsert(table, rows, onConflict = 'id') {
  if (rows.length === 0) return
  const { error } = await sb.from(table).upsert(rows, { onConflict })
  if (error) {
    console.error(`\n${table} upsert failed: ${error.message}`)
    process.exit(1)
  }
  console.log(`  ${table.padEnd(24)} ${rows.length}`)
}

console.log('\nWriting…')

// Org economics — break-even inputs for the Margins card. Roster carries no
// comp (087); dept assignments map to this org's real department ids.
const teamMembers = ROSTER.map((m) => ({
  id: mkid(CODE.member, m.n), name: m.name, title: m.title,
  billable: m.billable, active: true, tasks_enabled: m.n <= 2,
  dept_assignments: m.depts.map((k) => deptId[k]),
  hours_per_week: 40, user_id: m.n === 1 ? owner.id : null,
}))
{
  const { error } = await sb
    .from('orgs')
    .update({
      shop_rate: SHOP_RATE,
      profit_margin_pct: 25,
      overhead_inputs: OVERHEAD,
      team_members: teamMembers,
      billable_hours_inputs: BILLABLE,
    })
    .eq('id', orgId)
  if (error) {
    console.error(`\norgs update failed: ${error.message}`)
    process.exit(1)
  }
  console.log('  orgs (economics)         1')
}
await upsert(
  'team_compensation',
  ROSTER.map((m) => ({ org_id: orgId, member_id: mkid(CODE.member, m.n), annual_comp: m.comp })),
  'org_id,member_id',
)
await upsert('rate_book_items', [{
  id: PANEL_ITEM.id, org_id: orgId, name: PANEL_ITEM.name, unit: PANEL_ITEM.unit, active: true,
  base_labor_hours_eng: PANEL_ITEM.hours.eng, base_labor_hours_cnc: PANEL_ITEM.hours.cnc,
  base_labor_hours_assembly: PANEL_ITEM.hours.assembly, base_labor_hours_finish: PANEL_ITEM.hours.finish,
  base_labor_hours_install: PANEL_ITEM.hours.install,
  notes: 'Demo item — backs the Finish/Install rate-correction suggestion.',
}])
await upsert('clients', clients)
await upsert('projects', projects)
await upsert('subprojects', subs)
await upsert('estimate_lines', lines)
await upsert('cash_flow_receivables', recvs)
await upsert('time_entries', times)
await upsert('project_outcomes', outcomes)
await upsert('item_suggestions', [suggestion])

console.log(`\n✅ Seeded ${derived.length} completed projects into ${org.name}.`)
console.log('   Reports → Completed Projects shows all 7 (90-day period).')
console.log('   Margin alerts: Meridian Storefront. Suggestion: wall paneling big_up.')
console.log('   Cleanup: see the header of this script.')
