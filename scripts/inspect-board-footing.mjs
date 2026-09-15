// ============================================================================
// inspect-board-footing.mjs — READ ONLY. Do the month cards sum to the header?
// ============================================================================
// Run: npx tsx scripts/inspect-board-footing.mjs
//
// ⛔ THE COMPLAINT, LITERALLY CHECKED. Andrew: the grey cards in September
// summed past $100,000 while the header said RECEIVED $49,075. The cause was
// that a paid draw rendered in the month it was SCHEDULED and its payment
// rendered in the month the money LANDED — two cards, two months, same money.
//
// This runs the real board math over the real database and prints, per month:
// every card, its total, and the Received header. They must agree to the cent.
// The header is summed from the ledger and the cards are built by attributing
// payments to draws — different code paths, so agreement means something.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

for (const line of fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}

const { buildPaymentsView, reconcileEverything } = await import('../lib/payment-ledger.ts')

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
)

const money = (n) => `$${Math.round(n).toLocaleString()}`

const { data: projects } = await db.from('projects').select('id, name, bid_total, stage')
const nameById = new Map((projects || []).map((p) => [p.id, p.name]))
const totals = Object.fromEntries((projects || []).map((p) => [p.id, Number(p.bid_total) || 0]))

const { data: recv } = await db
  .from('cash_flow_receivables')
  .select('*')
  .eq('type', 'receivable')
  .neq('status', 'cancelled')

const { data: pays } = await db.from('project_payments').select('*')

const rows = (recv || []).map((r) => ({
  id: r.id,
  projectId: r.project_id,
  projectName: nameById.get(r.project_id) || 'Project',
  clientName: null,
  stage: 'sold',
  label: String(r.milestone_label || 'Milestone'),
  amount: Number(r.amount) || 0,
  status: r.status || 'projected',
  expectedDate: r.expected_date ?? null,
  receivedDate: r.received_date ?? null,
  sortOrder: Number(/order:(\d+)/.exec(String(r.notes || ''))?.[1] ?? Number.MAX_SAFE_INTEGER),
  createdAt: String(r.created_at ?? ''),
}))

const ledger = (pays || []).map((p) => ({
  id: p.id,
  projectId: p.project_id,
  amount: Number(p.amount) || 0,
  paymentDate: String(p.payment_date || '').slice(0, 10),
  method: p.method ?? null,
  reference: p.reference ?? null,
  notes: p.notes ?? null,
}))

const { draws, unapplied } = reconcileEverything(rows, ledger, totals, Object.fromEntries(nameById))

// Every month that has any money in it, so nothing is checked outside the window.
const monthsWithCash = [...new Set(ledger.map((e) => e.paymentDate.slice(0, 7)))].sort()
const months = monthsWithCash.map((m) => ({
  year: Number(m.slice(0, 4)),
  month: Number(m.slice(5, 7)) - 1,
}))
const today = { year: 2026, month: 8 }

const view = buildPaymentsView(draws, ledger, months, today, unapplied)

let bad = 0
for (const b of view.months) {
  const label = `${b.key.year}-${String(b.key.month + 1).padStart(2, '0')}`
  const cardSum = b.settledCards.reduce((s, c) => s + c.amount, 0)
  const ok = Math.abs(cardSum - b.receivedTotal) < 0.01
  if (!ok) bad++
  console.log(
    `\n${ok ? '✅' : '❌'} ${label}   cards ${money(cardSum)}   header ${money(b.receivedTotal)}` +
      (ok ? '' : `   ⛔ OFF BY ${money(cardSum - b.receivedTotal)}`),
  )
  for (const c of b.settledCards) {
    console.log(
      `      ${c.projectName} · ${c.drawLabel ?? 'no draw matched'} — ${money(c.amount)}` +
        (c.completesDraw ? ` (paid ${c.paidOn})` : ` (${money(c.amount)} of ${money(c.drawScheduled ?? 0)})`) +
        (c.entries.length > 1 ? ` · ${c.entries.length} payments` : '') +
        (c.partialEntry ? ' · slice of a larger payment' : ''),
    )
  }
  if (b.outstanding.length > 0) {
    console.log(`      — still scheduled: ${money(b.needed)} across ${b.outstanding.length} draw(s)`)
  }
}

console.log(
  `\n${bad === 0 ? '✅ every month foots' : `❌ ${bad} month(s) do not foot`}` +
    `  ·  ${view.unscheduled.length} undated draw(s), ${view.overdue.length} overdue`,
)

// A fully-paid job must show its whole schedule as green cards and nothing grey.
console.log('\n── fully-paid jobs ──')
const byProject = new Map()
for (const d of draws) {
  if (!byProject.has(d.row.projectId)) byProject.set(d.row.projectId, [])
  byProject.get(d.row.projectId).push(d)
}
for (const [pid, list] of byProject) {
  if (!list.every((d) => d.state === 'paid')) continue
  const cards = view.months.flatMap((m) => m.settledCards).filter((c) => c.projectId === pid)
  console.log(
    `   ${nameById.get(pid)}: ${list.length} draws, all paid → ${cards.length} green card(s), ` +
      `${money(cards.reduce((s, c) => s + c.amount, 0))}`,
  )
}
console.log('')
