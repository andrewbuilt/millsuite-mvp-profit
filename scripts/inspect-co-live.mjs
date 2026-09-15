// ============================================================================
// inspect-co-live.mjs — READ ONLY. Did the change order's money actually land?
// ============================================================================
// Run: npx tsx scripts/inspect-co-live.mjs
//
// "It works" can mean the screens flowed. This checks the part that can look
// fine and still be wrong: whether the contract moved by what was agreed, and
// whether the invoice and the draw row exist and match.
//
// For each ACCEPTED doc:
//   agreed   = sum of its item deltas (what the client signed)
//   applied  = what the materialised subprojects are actually worth
//   invoice  = the MillSuite invoice raised for it
//   draw     = the labelled cash_flow_receivables row
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
const money = (n) => `$${Math.round(n).toLocaleString()}`

const { data: docs } = await db
  .from('co_docs')
  .select('*')
  .order('created_at', { ascending: true })

if (!docs || docs.length === 0) {
  console.log('\nNo change order documents yet.\n')
  process.exit(0)
}

const { data: items } = await db.from('co_doc_items').select('*')
const { data: projects } = await db.from('projects').select('id, name, bid_total')
const nameById = new Map((projects || []).map((p) => [p.id, p.name]))
const totalById = new Map((projects || []).map((p) => [p.id, Number(p.bid_total) || 0]))

let problems = 0

for (const d of docs) {
  const mine = (items || []).filter((i) => i.doc_id === d.id)
  const agreed = mine.reduce((s, i) => s + (Number(i.delta_amount) || 0), 0)
  const label = `CO-${String(d.number ?? 0).padStart(2, '0')}`

  console.log(`\n${label} · ${nameById.get(d.project_id) || '?'} · ${d.status.toUpperCase()}`)
  console.log(`   agreed: ${money(agreed)}   (${mine.length} item${mine.length === 1 ? '' : 's'})`)
  for (const i of mine) {
    const what =
      i.kind === 'adjustment'
        ? i.description
        : i.kind === 'add_sub'
          ? i.draft?.name || 'new scope'
          : i.kind
    console.log(`      ${String(i.kind).padEnd(11)} ${String(money(i.delta_amount)).padStart(10)}  ${what}`)
  }
  if (d.signed_name) console.log(`   signed by ${d.signed_name} on ${String(d.signed_at).slice(0, 10)}`)
  if (d.sent_at) console.log(`   sent ${String(d.sent_at).slice(0, 10)}`)

  if (d.status !== 'accepted') continue

  // ── What the materialised scope is actually worth ──
  const subIds = mine.map((i) => i.subproject_id).filter(Boolean)
  if (subIds.length > 0) {
    const { data: lines } = await db
      .from('estimate_lines')
      .select('subproject_id, lump_cost_override, quantity')
      .in('subproject_id', subIds)
    const applied = (lines || []).reduce(
      (s, l) => s + (Number(l.lump_cost_override) || 0) * (Number(l.quantity) || 0),
      0,
    )
    console.log(`   materialised into ${subIds.length} subproject(s), lumps = ${money(applied)}`)
  }
  console.log(`   project bid_total now ${money(totalById.get(d.project_id) || 0)}`)

  // ── The invoice ──
  if (d.qbo_invoice_id) {
    const { data: inv } = await db
      .from('client_invoices')
      .select('invoice_number, total, status')
      .eq('id', d.qbo_invoice_id)
      .maybeSingle()
    if (!inv) {
      problems++
      console.log(`   ❌ qbo_invoice_id set but no invoice row found`)
    } else {
      const ok = Math.abs(Number(inv.total) - agreed) < 1.5
      if (!ok) problems++
      console.log(
        `   ${ok ? '✅' : '❌'} invoice ${inv.invoice_number} · ${money(inv.total)} · ${inv.status}` +
          (ok ? '' : `  ⛔ expected ${money(agreed)}`),
      )
    }
  } else if (agreed > 0) {
    problems++
    console.log(`   ❌ no invoice raised (agreed ${money(agreed)} > 0)`)
  } else {
    console.log(`   · net credit — no invoice, by design`)
  }

  // ── The draw row ──
  const { data: draw } = await db
    .from('cash_flow_receivables')
    .select('milestone_label, amount, expected_date, notes')
    .eq('co_doc_id', d.id)
    .maybeSingle()
  if (draw) {
    const ok = Math.abs(Number(draw.amount) - agreed) < 1.5
    if (!ok) problems++
    console.log(
      `   ${ok ? '✅' : '❌'} draw "${draw.milestone_label}" ${money(draw.amount)} · ` +
        `${draw.expected_date || 'no date'} · ${draw.notes}`,
    )
  } else if (agreed > 0) {
    // Not necessarily wrong: no schedule ⇒ no row, by design.
    const { count } = await db
      .from('cash_flow_receivables')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', d.project_id)
      .eq('type', 'receivable')
      .neq('status', 'cancelled')
    console.log(
      (count || 0) === 0
        ? `   · no draw row — this project has no schedule at all, which is the designed behaviour`
        : `   ❌ no draw row, but the project HAS a schedule (${count} rows)`,
    )
    if ((count || 0) > 0) problems++
  }
}

// ⛔ "NOTHING CHECKED" MUST NOT PRINT AS "ALL GOOD". The first version of this
// summary said "✅ every accepted change order reconciles" while zero docs had
// been accepted — a green line that asserted nothing, on the one report whose
// whole job is to say whether the money landed. Same failure this codebase has
// shipped repeatedly: a check that cannot fail looks exactly like one that
// passes. Count what was actually examined and say so.
const accepted = docs.filter((d) => d.status === 'accepted').length
if (accepted === 0) {
  console.log(
    `\n·  ${docs.length} change order doc(s), NONE accepted yet — so nothing here has\n` +
      `   moved a contract, raised an invoice or written a draw row. This report\n` +
      `   has checked no money. Accept one and run it again.\n`,
  )
} else {
  console.log(
    `\n${
      problems === 0
        ? `✅ all ${accepted} accepted change order(s) reconcile`
        : `❌ ${problems} thing(s) to look at across ${accepted} accepted doc(s)`
    }\n`,
  )
}
