// ============================================================================
// repair-co-stub-draws.mjs — fold old "CO-01 · $8,638" stub draws into the
// schedule (2026-10-26). DRY RUN by default.
// ============================================================================
// Run: npx tsx scripts/repair-co-stub-draws.mjs              (prints the plan)
//      npx tsx scripts/repair-co-stub-draws.mjs --apply      (writes it)
//
// Until 2026-10-26 an accepted change order appended its own draw row (linked
// by co_doc_id / change_order_id). The model is now: a CO changes the total
// owed and spreads over the remaining UNPAID draws (lib/payment-ledger
// redistributeDelta). This script does that for the stubs already on prod:
//
//   · Only stubs with NO cash credited (waterfall coverage, same as the board)
//     and status 'projected' are folded. A stub money has landed on stays —
//     it's printed so a human can decide.
//   · Its amount is spread over the project's OTHER unpaid, un-invoiced draws
//     with the same pure function the app uses, then the stub is deleted.
//   · A co_schedule_applied project event records each fold (and makes a
//     re-run a no-op for that stub).
//   · If nothing else on the schedule is unpaid, the stub is LEFT (folding it
//     would just push the money into final-draw balancing) and printed.
// ============================================================================
import fs from 'fs'
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}
const { createClient } = await import('@supabase/supabase-js')
const { reconcileProject, redistributeDelta } = await import('../lib/payment-ledger.ts')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const APPLY = process.argv.includes('--apply')
const money = (n) => `$${Math.round(n).toLocaleString()}`

const { data: stubRows, error } = await sb
  .from('cash_flow_receivables')
  .select('project_id')
  .eq('type', 'receivable')
  .neq('status', 'cancelled')
  .or('co_doc_id.not.is.null,change_order_id.not.is.null')
if (error) throw new Error(error.message)
const projectIds = [...new Set((stubRows || []).map((r) => r.project_id))]
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${projectIds.length} project(s) with CO stub draws\n`)

for (const pid of projectIds) {
  const { data: proj } = await sb.from('projects').select('id, name, org_id').eq('id', pid).single()
  const { data: raw } = await sb
    .from('cash_flow_receivables')
    .select('id, milestone_label, amount, status, notes, expected_date, received_date, co_doc_id, change_order_id, created_at')
    .eq('project_id', pid)
    .eq('type', 'receivable')
    .neq('status', 'cancelled')
  const draws = (raw || [])
    .map((r) => ({
      id: r.id,
      projectId: pid,
      projectName: proj.name,
      clientName: null,
      stage: 'sold',
      label: r.milestone_label || 'Draw',
      amount: Number(r.amount) || 0,
      status: r.status,
      expectedDate: r.expected_date,
      receivedDate: r.received_date,
      sortOrder: Number(/order:(\d+)/.exec(String(r.notes || ''))?.[1] ?? Number.MAX_SAFE_INTEGER),
      createdAt: r.created_at,
      _co: r.co_doc_id ? `co_doc:${r.co_doc_id}` : r.change_order_id ? `change_order:${r.change_order_id}` : null,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const { data: pay } = await sb.from('project_payments').select('id, project_id, amount, payment_date, method, reference, notes').eq('project_id', pid)
  const entries = (pay || []).map((p) => ({
    id: p.id, projectId: pid, amount: Number(p.amount) || 0, paymentDate: p.payment_date, method: p.method, reference: p.reference, notes: p.notes,
  }))
  const storedSum = draws.reduce((s, d) => s + d.amount, 0)
  const recon = reconcileProject(draws, entries, storedSum)
  const covered = Object.fromEntries(recon.draws.map((d) => [d.row.id, d.covered]))

  const foldable = draws.filter((d) => d._co && d.status === 'projected' && (covered[d.id] || 0) <= 0.005)
  const kept = draws.filter((d) => d._co && !foldable.includes(d))
  console.log(`■ ${proj.name}`)
  for (const d of kept) console.log(`   leave  ${d.label} ${money(d.amount)} — ${money(covered[d.id] || 0)} credited / status ${d.status}`)
  if (foldable.length === 0) {
    console.log('   nothing to fold\n')
    continue
  }
  const others = draws.filter((d) => !foldable.includes(d))
  const total = foldable.reduce((s, d) => s + d.amount, 0)
  const plan = redistributeDelta(
    others.map((d) => ({ id: d.id, stored: d.amount, covered: covered[d.id] || 0, frozen: d.status === 'invoiced' || d.status === 'received' })),
    total,
  )
  if (plan.amounts.length === 0) {
    console.log(`   leave  ${foldable.map((d) => d.label).join(', ')} — nothing else on the schedule is unpaid\n`)
    continue
  }
  for (const d of foldable) console.log(`   fold   ${d.label} ${money(d.amount)} → spread, then delete the stub`)
  for (const a of plan.amounts) console.log(`          ${others.find((o) => o.id === a.id).label}: ${money(a.from)} → ${money(a.to)}`)
  if (plan.unabsorbed) console.log(`          (unabsorbed ${money(plan.unabsorbed)} — final-draw balancing shows it)`)

  if (APPLY) {
    for (const a of plan.amounts) {
      const { data, error: e } = await sb.from('cash_flow_receivables').update({ amount: a.to }).eq('id', a.id).select('id')
      if (e || !data?.length) throw new Error(`update failed: ${e?.message || 'refused'}`)
    }
    for (const d of foldable) {
      const { error: e } = await sb.from('cash_flow_receivables').delete().eq('id', d.id)
      if (e) throw new Error(`delete failed: ${e.message}`)
      await sb.from('project_events').insert({
        org_id: proj.org_id,
        project_id: pid,
        event_type: 'co_schedule_applied',
        label: `${d.label} folded into the remaining draws (repair)`,
        meta: { key: d._co, delta: Math.round(d.amount), repairedStubId: d.id, moved: plan.amounts },
      })
    }
    console.log('   ✔ applied')
  }
  console.log('')
}
