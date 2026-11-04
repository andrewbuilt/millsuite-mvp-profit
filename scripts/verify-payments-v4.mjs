// ============================================================================
// verify-payments-v4.mjs — the forecast model's math and its one invariant
// ============================================================================
// Run: npx tsx scripts/verify-payments-v4.mjs        (no DB, no network)
//
// Payments v4 (STATE.md, 2026-11-05): the LEDGER (project_payments) and the
// FORECAST (cash_flow_receivables) are two independent lists. This proves:
//
//   A. Nothing pairs them — recording a payment changes the forecast by
//      exactly nothing; the hint appears instead.
//   B. Leonard after the conversion reads App 3 paid + the real future rows.
//   C. An odd-amount payment ($17,000 against nothing) is just a green card;
//      one redivide and the future foots.
//   D. A CO moves the contract → the hint appears; nothing auto-spreads.
//   E. A month's cards ALWAYS sum to its header (fuzzed), every payment lands
//      once, every forecast row lands once.
//   F. The redivide splits foot to the cent, in whole dollars where the
//      target is whole.
//   G. STATIC: the only writers of a forecast row are saveForecast (editor +
//      Redivide) and reschedulePayment (the month drag); the payment paths
//      never mention the forecast table; the deleted machinery stays deleted.
// ============================================================================

import fs from 'fs'
import path from 'path'
import {
  buildForecastView,
  evenSplit,
  forecastAll,
  paymentLabel,
  projectForecast,
  proportionalSplit,
  splitByWeights,
} from '../lib/payment-forecast.ts'

let pass = 0
let fail = 0
const ok = (label, cond, detail) => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && detail !== undefined ? `\n       ${JSON.stringify(detail)}` : ''}`)
}
const sum = (a) => Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100

const row = (id, projectId, label, amount, expectedDate, sortOrder = 0) => ({
  id,
  projectId,
  projectName: projectId,
  clientName: null,
  stage: 'production',
  label,
  amount,
  status: 'projected',
  expectedDate,
  receivedDate: null,
  sortOrder,
  createdAt: '2026-09-15',
})
const pay = (id, projectId, amount, paymentDate, label = null) => ({
  id,
  projectId,
  amount,
  paymentDate,
  label,
  method: 'ach',
  reference: null,
  notes: null,
})

// ── B. Leonard Lobby Bar, as the conversion leaves it ──────────────────────
// Contract $172,563. Ledger: the five real payments, labelled from the rows
// they paid (amount match). Forecast: the two rows nothing paid.
const LEO = 'leonard'
const leoRows = [
  row('a4', LEO, 'App 4 - Draw', 31061.37, '2026-11-15', 3),
  row('a7', LEO, 'App 7 - Retainage', 18549.32, '2026-12-01', 6),
]
const leoPays = [
  pay('p1', LEO, 23296, '2026-08-21', 'App 2 - Draw'),
  pay('p2', LEO, 32247, '2026-09-11', 'App 3 - Draw'),
  pay('p3', LEO, 15531, '2026-11-02', 'App 6 - Draw'),
  pay('p4', LEO, 18217, '2026-11-04', 'App 5 - Draw'),
  pay('p5', LEO, 33662, '2026-06-30', 'Deposit'),
]
const leo = projectForecast(LEO, 'Leonard', leoRows, leoPays, 172563)
ok('B  Leonard received = Σ ledger = $122,953', leo.received === 122953, leo.received)
ok('B  Leonard remaining = $49,610', leo.remaining === 49610, leo.remaining)
ok('B  Leonard forecast = App 4 + App 7 = $49,610.69', leo.forecastTotal === 49610.69, leo.forecastTotal)
ok('B  Leonard: no hint (69¢ is rounding, not a gap)', leo.needsRedivide === false, leo.gap)
const leoNov = buildForecastView(leoRows, leoPays, [{ year: 2026, month: 10 }], { year: 2026, month: 10 }).months[0]
ok(
  'B  Leonard November: two green cards (App 6, App 5), one white (App 4) — no "App 5" ghost',
  leoNov.payments.map(paymentLabel).join('|') === 'App 6 - Draw|App 5 - Draw' &&
    leoNov.forecast.map((r) => r.label).join('|') === 'App 4 - Draw',
  { green: leoNov.payments.map(paymentLabel), white: leoNov.forecast.map((r) => r.label) },
)
const leoSep = buildForecastView(leoRows, leoPays, [{ year: 2026, month: 8 }], { year: 2026, month: 10 }).months[0]
ok('B  Leonard September: "App 3" paid, $32,247', leoSep.payments.length === 1 && paymentLabel(leoSep.payments[0]) === 'App 3 - Draw' && leoSep.receivedTotal === 32247)

// ── A + C. A payment changes nothing but the ledger ────────────────────────
const OLI = 'oliveira'
const oliRows = [
  row('d', OLI, 'Deposit', 15529, '2026-09-01', 0),
  row('k', OLI, 'Production kickoff', 15319, '2026-11-01', 1),
  row('f', OLI, 'Final', 16681, '2026-12-01', 2),
]
const frozen = JSON.stringify(oliRows)
const before = projectForecast(OLI, 'Oliveira', oliRows, [], 47529)
ok('C  before any payment: forecast foots, no hint', before.needsRedivide === false && before.gap === 0, before)
const odd = [pay('x', OLI, 17000, '2026-09-23')]
const after = projectForecast(OLI, 'Oliveira', oliRows, odd, 47529)
ok('A  the rows passed in are untouched (deep-equal)', JSON.stringify(oliRows) === frozen)
ok('A  the forecast summary carries the SAME rows, same amounts', JSON.stringify(after.rows.map((r) => [r.id, r.amount, r.label])) === JSON.stringify([['d', 15529, 'Deposit'], ['k', 15319, 'Production kickoff'], ['f', 16681, 'Final']]))
ok('C  $17,000 against nothing → hint appears', after.needsRedivide === true && after.remaining === 30529 && after.gap === 17000, after)
const sepView = buildForecastView(oliRows, odd, [{ year: 2026, month: 8 }], { year: 2026, month: 8 }).months[0]
ok('C  it is just a green card in September, labelled "Payment"', sepView.payments.length === 1 && paymentLabel(sepView.payments[0]) === 'Payment' && sepView.receivedTotal === 17000)
ok('C  …and the Deposit white card is STILL there (no settle)', sepView.forecast.some((r) => r.id === 'd'))
// One redivide: the human removes Deposit (it's paid) and spreads proportionally.
const kept = oliRows.filter((r) => r.id !== 'd')
const re = proportionalSplit(after.remaining, kept.map((r) => r.amount))
const oliAfter = kept.map((r, i) => ({ ...r, amount: re[i] }))
const settled = projectForecast(OLI, 'Oliveira', oliAfter, odd, 47529)
ok('C  one redivide → forecast foots, hint gone', settled.needsRedivide === false && settled.forecastTotal === 30529, { re, settled: settled.forecastTotal })
ok('C  …and reads sensibly (proportional: 30,529 × 15,319/32,000 = $14,615 / $15,914)', re[0] === 14615 && re[1] === 15914, re)

// ── D. A change order moves the contract, nothing else ─────────────────────
const co = projectForecast(OLI, 'Oliveira', oliRows, [], 47529 + 4500)
ok('D  CO +$4,500 → hint ("Forecast $47,529 vs $52,029 remaining")', co.needsRedivide && co.forecastTotal === 47529 && co.remaining === 52029)
ok('D  …rows not re-spread', JSON.stringify(co.rows.map((r) => r.amount)) === JSON.stringify([15529, 15319, 16681]))
const credit = projectForecast(OLI, 'Oliveira', oliRows, [], 47529 - 3000)
ok('D  credit CO −$3,000 → hint the other way (forecast over)', credit.needsRedivide && credit.gap === 3000)

// ── Edge: no contract, overpaid ────────────────────────────────────────────
const noC = projectForecast('n', 'UT', [row('u', 'n', 'Final', 6856, null)], [], 0)
ok('   no contract value → no hint (nothing to foot to)', noC.needsRedivide === false && noC.contractKnown === false)
const over = projectForecast('o', 'Over', [], [pay('o1', 'o', 11000, '2026-10-01')], 10000)
ok('   overpaid → remaining 0, credit $1,000, no hint with no rows', over.remaining === 0 && over.credit === 1000 && !over.needsRedivide)

// ── F. Redivide splits ─────────────────────────────────────────────────────
ok('F  even $49,610 / 2 = 24,805 ×2', JSON.stringify(evenSplit(49610, 2)) === '[24805,24805]')
const e3 = evenSplit(49610, 3)
ok('F  even $49,610 / 3 foots, whole dollars', sum(e3) === 49610 && e3.every((x) => Number.isInteger(x)), e3)
const ec = evenSplit(5833.5, 2)
ok('F  cents land on the LAST row only ($5,833.50 / 2)', sum(ec) === 5833.5 && Number.isInteger(ec[0]) && ec[1] % 1 !== 0, ec)
ok('F  proportional with all-zero weights falls back to even', JSON.stringify(proportionalSplit(100, [0, 0])) === '[50,50]')
ok('F  split of 0 is all zeros', JSON.stringify(splitByWeights(0, [1, 2, 3])) === '[0,0,0]')
let fuzzBad = 0
for (let i = 0; i < 2000; i++) {
  const n = 1 + Math.floor(Math.random() * 7)
  const t = Math.round(Math.random() * 300000 * 100) / 100
  const w = Array.from({ length: n }, () => (Math.random() < 0.2 ? 0 : Math.random() * 50000))
  const out = splitByWeights(t, w)
  if (Math.abs(sum(out) - t) > 0.001 || out.some((x) => x < 0) || out.slice(0, -1).some((x) => !Number.isInteger(x))) fuzzBad++
}
ok('F  fuzz: 2,000 random splits foot to the cent, never negative', fuzzBad === 0, fuzzBad)

// ── E. Months foot to their cards; every item lands once (fuzzed) ──────────
let footBad = 0
let onceBad = 0
for (let t = 0; t < 300; t++) {
  const rows = []
  const pays = []
  const nP = 1 + Math.floor(Math.random() * 6)
  for (let p = 0; p < nP; p++) {
    const pid = `p${p}`
    for (let k = 0; k < Math.floor(Math.random() * 6); k++) {
      const m = Math.floor(Math.random() * 12)
      const date = Math.random() < 0.15 ? null : `2026-${String(m + 1).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`
      rows.push(row(`${pid}r${k}`, pid, `Row ${k}`, Math.round(Math.random() * 40000 * 100) / 100, date, k))
    }
    for (let k = 0; k < Math.floor(Math.random() * 5); k++) {
      const m = Math.floor(Math.random() * 12)
      pays.push(pay(`${pid}x${k}`, pid, (Math.random() < 0.1 ? -1 : 1) * (1 + Math.round(Math.random() * 30000 * 100) / 100), `2026-${String(m + 1).padStart(2, '0')}-15`))
    }
  }
  const months = Array.from({ length: 12 }, (_, i) => ({ year: 2026, month: i }))
  const today = { year: 2026, month: Math.floor(Math.random() * 12) }
  const v = buildForecastView(rows, pays, months, today)
  for (const b of v.months) {
    if (Math.abs(sum(b.forecast.map((r) => r.amount)) - b.scheduled) > 0.001) footBad++
    if (Math.abs(sum(b.payments.map((e) => e.amount)) - b.receivedTotal) > 0.001) footBad++
  }
  // Whole year visible: every payment in exactly one month, every row in a
  // month or unscheduled (nothing can be outside a 12-month 2026 window).
  const seenPay = v.months.flatMap((b) => b.payments.map((e) => e.id))
  const seenRow = [...v.months.flatMap((b) => b.forecast.map((r) => r.id)), ...v.unscheduled.map((r) => r.id)]
  if (seenPay.length !== pays.length || new Set(seenPay).size !== pays.length) onceBad++
  if (seenRow.length !== rows.length || new Set(seenRow).size !== rows.length) onceBad++
  // forecastAll covers every project once.
  const all = forecastAll(rows, pays, {})
  if (new Set(all.map((p) => p.projectId)).size !== all.length) onceBad++
}
ok('E  fuzz: 300 boards — every month header = Σ its cards (both kinds)', footBad === 0, footBad)
ok('E  fuzz: every payment lands once, every forecast row lands once', onceBad === 0, onceBad)
// Overdue is relative to TODAY, not the window.
const od = buildForecastView([row('o', 'p', 'Old', 100, '2026-01-10')], [], [{ year: 2026, month: 5 }], { year: 2026, month: 5 })
ok('E  a row expected before this month surfaces as overdue', od.overdue.length === 1)
const fut = buildForecastView([row('f', 'p', 'Later', 100, '2026-12-10')], [], [{ year: 2026, month: 5 }], { year: 2026, month: 5 })
ok('E  a row beyond the window is NOT overdue', fut.overdue.length === 0)

// ── G. Static: the one invariant, in the source ────────────────────────────
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
/** The body of `export async function name(` up to the next top-level export. */
const fnBody = (src, name) => {
  const i = src.indexOf(`export async function ${name}(`)
  if (i < 0) return null
  const j = src.indexOf('\nexport ', i + 10)
  return src.slice(i, j < 0 ? undefined : j)
}
const payments = strip(read('lib/payments.ts'))
for (const fn of ['logPayment', 'updatePayment', 'deletePayment', 'projectReceivedTotal']) {
  const body = fnBody(payments, fn)
  ok(`G  ${fn} never touches cash_flow_receivables`, body && !body.includes('cash_flow_receivables'))
}
// Every write to the forecast table in lib/payments lives in saveForecast or reschedulePayment.
const writers = []
for (const m of payments.matchAll(/export async function (\w+)\(/g)) {
  const body = fnBody(payments, m[1])
  if (/from\('cash_flow_receivables'\)[\s\S]{0,80}\.(insert|update|delete|upsert)\(/.test(body)) writers.push(m[1])
}
ok('G  lib/payments: forecast writers are exactly saveForecast + reschedulePayment', JSON.stringify(writers.sort()) === JSON.stringify(['reschedulePayment', 'saveForecast']), writers)
const board = strip(read('components/payments/PaymentsBoard.tsx'))
ok('G  the board imports no Supabase client (writes only through its api)', !/lib\/supabase|from '@\/lib\/payments'(?!.*type)/.test(board.replace(/import type[^\n]*\n/g, '')))
ok('G  the board writes the forecast only via api.saveForecast + api.reschedule', !/saveForecast\(/.test(board.replace(/api\.saveForecast\(/g, '')) && (board.match(/api\.saveForecast\(/g) || []).length === 1)
ok('G  saveForecast is called by the board from the ForecastModal onSave only', /<ForecastModal[\s\S]*api\.saveForecast\(/.test(board))
const pf = strip(read('lib/payment-forecast.ts'))
ok('G  payment-forecast is pure (no supabase import)', !/supabase/.test(pf))
// The deleted machinery stays deleted.
const live = ['lib', 'app', 'components'].flatMap((d) => {
  const out = []
  const walk = (p) => {
    for (const f of fs.readdirSync(path.join(root, p), { withFileTypes: true })) {
      const q = path.join(p, f.name)
      if (f.isDirectory()) walk(q)
      else if (/\.(ts|tsx)$/.test(f.name)) out.push(q)
    }
  }
  walk(d)
  return out
})
const dead = /\b(reconcileProject|reconcileAll|reconcileEverything|DerivedDraw|buildPaymentsView|SettledCard|coDrawSlot|updateDrawSchedule|createDrawSchedule|DefineDrawsModal)\b|payment-ledger/
const resurrected = live.filter((f) => f !== 'lib/payment-forecast.ts' && dead.test(strip(read(f))))
ok('G  no live code references the deleted v3 machinery', resurrected.length === 0, resurrected)
const pinnedIn = ['lib/payments.ts', 'lib/payment-forecast.ts', 'lib/payment-schedule.ts', 'components/payments/PaymentsBoard.tsx', 'components/payments/ForecastModal.tsx', 'components/project/ProjectPaymentLedger.tsx', 'lib/client-portal.ts', 'app/(app)/payments/page.tsx', 'app/(app)/pm/page.tsx'].filter((f) => /amount_pinned|\bpinned\b/.test(strip(read(f))))
ok('G  amount_pinned is gone from every payments surface', pinnedIn.length === 0, pinnedIn)
ok('G  migration 130 adds project_payments.label idempotently + reloads schema', (() => {
  const m = read('db/migrations/130_payments_v4_ledger_label.sql')
  return /ADD COLUMN IF NOT EXISTS label/.test(m) && /NOTIFY pgrst, 'reload schema'/.test(m)
})())
ok('G  a sold job always gets the v4 panel (no fallback to the pre-sale builder)', /\{!isPresold\(project\.stage\) \? \(\s*<ProjectPaymentLedger/.test(read('app/(app)/projects/[id]/page.tsx')))

console.log(`\n${pass} passed · ${fail} failed`)
process.exit(fail ? 1 : 0)
