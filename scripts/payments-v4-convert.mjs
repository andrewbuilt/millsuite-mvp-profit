// ============================================================================
// payments-v4-convert.mjs — the one-time Payments v4 data conversion
// ============================================================================
//   node --env-file=.env.local scripts/payments-v4-convert.mjs              (READ-ONLY listing)
//   node --env-file=.env.local scripts/payments-v4-convert.mjs --org Built  (one org)
//   node --env-file=.env.local scripts/payments-v4-convert.mjs --org Built --apply <plan>
//
// ⛔ DRY RUN BY DEFAULT. Without --apply it only selects and prints. --apply
// needs the plan hash the listing printed, so what runs is exactly what Andrew
// approved — if anything changed in between (a payment logged, a row edited),
// the hash differs and it refuses. Needs migration 130 (project_payments.label)
// before --apply.
//
// WHAT V4 NEEDS FROM THE DATA (STATE.md, 2026-11-05):
//   "unpaid/open draw rows → forecast rows verbatim; the ledger is already the
//    ledger". Under v3 a row's paid-ness was never stored — it was DERIVED by
//   pairing payments with rows (settle-next-draw). So this re-derives the
//   pairing ONCE, prints it, and on --apply:
//     1. RETIRES each paired row (delete) — its money is already a ledger row.
//     2. Copies the row's label onto the payment that paid it (when the
//        payment has none), so the green card still reads "App 3".
//     3. Keeps every unpaired row VERBATIM (label, amount, month).
//     4. Legacy orgs whose money lives only in `status='received'` rows (no
//        ledger at all on the project): each such row becomes a ledger
//        payment (its amount, received_date) and is retired.
//
// THE PAIRING (better than v3's, which is what caused the Leonard ghost):
//   pass 1  AMOUNT — each payment (oldest first) takes the earliest unpaired
//           row within $1 of it. Leonard's $18,217 pairs with "App 5", not
//           with whatever row came next in order.
//   pass 2  ORDER  — a payment with no amount match takes the next unpaired
//           row in schedule order (v3's rule — what the board shows today).
//           Flagged when the amounts differ by more than $1.
//   Refunds (negative) pair with nothing.
//
// GHOSTS: rows the machinery created rather than a human — change-order-linked
// rows (106/109 `change_order_id` / `co_doc_id`), or an unpaired row whose
// amount duplicates a paired row's and that was created AFTER it. Listed for
// Andrew; retired only if he passes --retire-ghosts.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Run with: node --env-file=.env.local scripts/payments-v4-convert.mjs')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const args = process.argv.slice(2)
const argVal = (k) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : null
}
const orgFilter = argVal('--org')
const applyHash = argVal('--apply')
const retireGhosts = args.includes('--retire-ghosts')

const money = (n) =>
  (n < 0 ? '-$' : '$') + Math.abs(Math.round(Number(n) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })
const r2 = (n) => Math.round(n * 100) / 100
const ord = (r) => Number(/order:(\d+)/.exec(r.notes || '')?.[1] ?? Number.MAX_SAFE_INTEGER)

const { data: orgs, error: oe } = await db.from('orgs').select('id, name')
if (oe) throw oe
const orgName = Object.fromEntries(orgs.map((o) => [o.id, o.name]))
const orgIds = orgs.filter((o) => !orgFilter || (o.name || '').toLowerCase().includes(orgFilter.toLowerCase())).map((o) => o.id)
if (orgIds.length === 0) {
  console.log(`no org matches "${orgFilter}"`)
  process.exit(0)
}

const sel = async (table, cols) => {
  const { data, error } = await db.from(table).select(cols).in('org_id', orgIds)
  if (error) throw error
  return data
}
const rows = (await sel(
  'cash_flow_receivables',
  'id, org_id, project_id, milestone_label, amount, status, expected_date, received_date, notes, created_at, change_order_id, co_doc_id, type',
)).filter((r) => r.type === 'receivable' && r.status !== 'cancelled')
let pays
{
  const { data, error } = await db
    .from('project_payments')
    .select('id, org_id, project_id, amount, payment_date, label, notes, created_at')
    .in('org_id', orgIds)
  if (error && /label/.test(error.message || '')) {
    // Pre-130: read without the column; --apply will refuse below.
    pays = (await sel('project_payments', 'id, org_id, project_id, amount, payment_date, notes, created_at')).map((p) => ({ ...p, label: null }))
    pays.pre130 = true
  } else if (error) throw error
  else pays = data
}
const projects = await sel('projects', 'id, org_id, name, stage, bid_total')
// ⛔ ONE-TIME, PER PROJECT. After a project converts, its forecast rows are
// human-owned and every payment is already a green card; pairing again would
// retire LIVE forecast rows. Projects with a payments_v4_converted event are
// skipped — found the hard way: the re-listing after the real run proposed
// retiring Leonard's App 4 + App 7.
const converted = new Set(
  ((await db.from('project_events').select('project_id').eq('event_type', 'payments_v4_converted').in('org_id', orgIds)).data || []).map((e) => e.project_id),
)
const P = Object.fromEntries(projects.map((p) => [p.id, p]))

const byProject = new Map()
const bucket = (id) => {
  if (!byProject.has(id)) byProject.set(id, { rows: [], pays: [] })
  return byProject.get(id)
}
for (const r of rows) bucket(r.project_id).rows.push(r)
for (const p of pays) bucket(p.project_id).pays.push(p)

const plan = { retire: [], label: [], insertLedger: [], ghosts: [] }
const today = new Date()
const soon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 31).toISOString().slice(0, 10)

const sections = []
for (const [pid, g] of byProject) {
  const p = P[pid]
  if (!p) continue
  if (converted.has(pid)) continue
  const contract = Number(p.bid_total) || 0
  const lines = []
  const flags = []
  const R = [...g.rows].sort((a, b) => ord(a) - ord(b) || (a.created_at || '').localeCompare(b.created_at || ''))
  const L = [...g.pays].sort((a, b) => a.payment_date.localeCompare(b.payment_date) || a.id.localeCompare(b.id))
  const pairedBy = new Map() // row id → { pay, how }

  if (L.length === 0) {
    // Legacy: money only in received flips.
    const legacy = R.filter((r) => r.status === 'received')
    if (legacy.length === 0) continue // nothing paid, nothing to convert — rows stay verbatim
    for (const r of legacy) {
      const date = r.received_date || r.expected_date
      plan.insertLedger.push({ org_id: p.org_id, project_id: pid, amount: Number(r.amount), payment_date: date, label: r.milestone_label, row: r.id })
      plan.retire.push(r.id)
      pairedBy.set(r.id, { how: 'legacy' })
      if (!date) flags.push(`"${r.milestone_label}" was marked received with no date — it would land with no month`)
    }
  } else {
    const free = new Set(R.map((r) => r.id))
    const positive = L.filter((x) => Number(x.amount) > 0)
    const unpaired = []
    for (const x of positive) {
      const hit = R.find((r) => free.has(r.id) && Math.abs(Number(r.amount) - Number(x.amount)) <= 1)
      if (hit) {
        free.delete(hit.id)
        pairedBy.set(hit.id, { pay: x, how: 'amount' })
      } else unpaired.push(x)
    }
    for (const x of unpaired) {
      const next = R.find((r) => free.has(r.id))
      if (!next) {
        flags.push(`${money(x.amount)} on ${x.payment_date} pairs with no row (more payments than rows) — stays a plain green card`)
        continue
      }
      free.delete(next.id)
      pairedBy.set(next.id, { pay: x, how: 'order' })
      if (Math.abs(Number(next.amount) - Number(x.amount)) > 1) {
        flags.push(`"${next.milestone_label}" ${money(next.amount)} is retired by a ${money(x.amount)} payment (${money(r2(Number(next.amount) - Number(x.amount)))} apart) — the board shows it paid today; say if it should stay forecast`)
      }
    }
    for (const [rid, m] of pairedBy) {
      plan.retire.push(rid)
      const row = R.find((r) => r.id === rid)
      if (m.pay && !(m.pay.label || '').trim()) plan.label.push({ id: m.pay.id, label: row.milestone_label })
    }
    for (const x of L) if (x.payment_date > soon) flags.push(`payment ${money(x.amount)} is dated ${x.payment_date} — future; typo? (fix it on the board after the deploy)`)
    for (const r of R) if (free.has(r.id) && r.status === 'received') flags.push(`"${r.milestone_label}" is marked received (legacy) but no payment paired with it — kept as forecast`)
  }

  // Ghosts.
  const keptRows = R.filter((r) => !pairedBy.has(r.id))
  for (const r of keptRows) {
    const why = []
    if (r.change_order_id || r.co_doc_id) why.push('change-order-linked')
    const twin = R.find((o) => pairedBy.has(o.id) && Math.abs(Number(o.amount) - Number(r.amount)) <= 1 && (o.created_at || '') < (r.created_at || ''))
    if (twin) why.push(`duplicates paid "${twin.milestone_label}" and was created after it`)
    if (why.length) plan.ghosts.push({ id: r.id, project: p.name, label: r.milestone_label, amount: Number(r.amount), why: why.join('; ') })
  }

  // What the board reads afterwards.
  const ledgerAfter = r2(L.reduce((s, x) => s + Number(x.amount), 0) + plan.insertLedger.filter((i) => i.project_id === pid).reduce((s, i) => s + i.amount, 0))
  const forecastAfter = r2(keptRows.reduce((s, r) => s + Number(r.amount), 0))
  const remaining = r2(Math.max(0, contract - ledgerAfter))
  const hint = contract > 0 && Math.abs(forecastAfter - remaining) >= 1

  lines.push(`\n${orgName[p.org_id]} · ${p.name} · ${p.stage} · contract ${money(contract)}`)
  for (const r of R) {
    const m = pairedBy.get(r.id)
    const tag = m
      ? m.how === 'legacy'
        ? 'RETIRE → becomes a ledger payment (legacy received)'
        : `RETIRE — paid by ${money(m.pay.amount)} on ${m.pay.payment_date} (${m.how} match)`
      : 'KEEP as forecast'
    lines.push(`    ${tag.padEnd(62)} ${String(r.milestone_label).padEnd(34)} ${money(r.amount).padStart(12)}  ${r.expected_date || 'no date'}`)
  }
  for (const x of L) {
    const lab = (x.label || '').trim() || plan.label.find((l) => l.id === x.id)?.label || '(no label)'
    lines.push(`    green card: ${money(x.amount).padStart(11)}  ${x.payment_date}  "${lab}"`)
  }
  lines.push(
    `    after: received ${money(ledgerAfter)} · remaining ${money(remaining)} · forecast ${money(forecastAfter)}` +
      (hint ? `  → HINT "Forecast ${money(forecastAfter)} vs ${money(remaining)} remaining — Redivide"` : '  → foots, no hint'),
  )
  for (const f of flags) lines.push(`    ⚠️  ${f}`)
  sections.push({ name: `${orgName[p.org_id]} ${p.name}`, lines })
}

sections.sort((a, b) => a.name.localeCompare(b.name))
for (const s of sections) console.log(s.lines.join('\n'))

console.log('\n' + '='.repeat(78))
console.log(`GHOSTS (machine-created forecast rows): ${plan.ghosts.length}`)
for (const g of plan.ghosts) console.log(`    ${g.project} · "${g.label}" ${money(g.amount)} — ${g.why}`)
if (plan.ghosts.length === 0) {
  console.log('    none. (Leonard\'s "App 5 · $18,217" was never a row: v3 paired payments with rows')
  console.log('    in date order on every read and relabelled them. The pairing above fixes it.)')
}
if (converted.size) console.log(`\nskipped ${converted.size} project(s) already converted (payments_v4_converted event).`)
console.log(`\nretire ${plan.retire.length} row(s) · label ${plan.label.length} payment(s) · create ${plan.insertLedger.length} ledger payment(s) from legacy received rows`)

const canonical = JSON.stringify({
  retire: [...plan.retire].sort(),
  label: [...plan.label].sort((a, b) => a.id.localeCompare(b.id)),
  insertLedger: [...plan.insertLedger].sort((a, b) => a.row.localeCompare(b.row)),
  ghosts: retireGhosts ? plan.ghosts.map((g) => g.id).sort() : [],
})
const hash = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12)
console.log(`plan ${hash}${retireGhosts ? ' (includes --retire-ghosts)' : ''}`)

if (!applyHash) {
  console.log('\nREAD-ONLY — nothing was written. To apply exactly this plan:')
  console.log(`  node --env-file=.env.local scripts/payments-v4-convert.mjs${orgFilter ? ` --org ${orgFilter}` : ''}${retireGhosts ? ' --retire-ghosts' : ''} --apply ${hash}`)
  process.exit(0)
}
if (applyHash !== hash) {
  console.error(`\n⛔ REFUSED: --apply ${applyHash} but the plan is now ${hash}. Something changed since the listing was approved — re-read it.`)
  process.exit(1)
}
if (pays.pre130) {
  console.error('\n⛔ REFUSED: migration 130 (project_payments.label) is not on this database yet.')
  process.exit(1)
}

// ── APPLY ── ledger first (so no money is ever missing), then labels, then
// the retirements. Every write asks for its rows back: zero rows = failure.
let done = 0
for (const i of plan.insertLedger) {
  const { data, error } = await db
    .from('project_payments')
    .insert({ org_id: i.org_id, project_id: i.project_id, amount: i.amount, payment_date: i.payment_date, label: i.label, notes: 'v4 conversion — was a received milestone' })
    .select('id')
  if (error || !data?.length) throw new Error(`ledger insert for row ${i.row}: ${error?.message || 'no row'}`)
  done++
}
for (const l of plan.label) {
  const { data, error } = await db.from('project_payments').update({ label: l.label }).eq('id', l.id).is('label', null).select('id')
  if (error) throw new Error(`label ${l.id}: ${error.message}`)
  if (data?.length) done++
}
const toRetire = [...plan.retire, ...(retireGhosts ? plan.ghosts.map((g) => g.id) : [])]
if (toRetire.length) {
  const { data, error } = await db.from('cash_flow_receivables').delete().in('id', toRetire).select('id')
  if (error) throw new Error(`retire: ${error.message}`)
  if ((data?.length || 0) !== toRetire.length) throw new Error(`retire: expected ${toRetire.length} rows, deleted ${data?.length || 0}`)
  done += data.length
}
// A trace on each project's timeline.
const touched = new Set([...plan.retire, ...plan.insertLedger.map((i) => i.row)].map((rid) => rows.find((r) => r.id === rid)?.project_id).filter(Boolean))
for (const pid of touched) {
  await db.from('project_events').insert({
    org_id: P[pid].org_id,
    project_id: pid,
    event_type: 'payments_v4_converted',
    label: 'Payments v4: paid draw rows retired (the ledger holds them)',
    meta: { plan: hash },
  })
}
console.log(`\nAPPLIED plan ${hash}: ${done} write(s) across ${touched.size} project(s).`)
