// ============================================================================
// verify-project-pnl.mjs — the P&L panel foots, and the ledger stays one ledger
// ============================================================================
// Run: npx tsx scripts/verify-project-pnl.mjs        (pure + static, no database)
//
// Pins lib/project-pnl (the arithmetic, by hand) and lib/project-expenses'
// duplicate warning, then greps the wiring: one spend table (`invoices`, 124),
// the parser writes through createExpense, the panel reads the pure module.
// ============================================================================
import fs from 'fs'
import { execSync } from 'child_process'
import { computeProjectPnl, pnlRate } from '../lib/project-pnl.ts'
import { findLikelyDuplicates, sumExpenses } from '../lib/project-expenses-math.ts'

let bad = 0
const ck = (label, ok) => {
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${label}`)
}
const near = (a, b) => Math.abs(a - b) < 0.01

// ── The panel foots by hand (Murtagh-shaped: $26,227 · 180h est · 69h tracked) ──
// Andrew's second pass: money out vs money in, labor at TODAY's shop rate.
const m = computeProjectPnl({ contract: 26227, estHours: 180, trackedHours: 69, rate: 77.98, materialAllowance: 6200, materialSpent: 2450.5, received: 13113 })
ck('labor budget value = 180h × $77.98 = $14,036.40', near(m.labor.budget, 14036.4))
ck('labor spent = 69h × $77.98 = $5,380.62', near(m.labor.actual, 5380.62))
ck('labor left = budget − spent', near(m.labor.remaining, 14036.4 - 5380.62) && !m.labor.over)
ck('material left = 6,200 − 2,450.50', near(m.material.remaining, 3749.5))
ck('spent = labor + material = $7,831.12', near(m.spent, 7831.12))
ck('cash flow to date = 13,113 − 7,831.12 = $5,281.88', near(m.cashFlowToDate, 5281.88))
ck('hours line carries raw hours', m.laborHours.budget === 180 && m.laborHours.actual === 69)
ck('contract is the headline, untouched by spend', m.contract === 26227)

// ── Leonard, from Andrew's screenshot: nothing received yet → the shop is carrying it ──
const l = computeProjectPnl({ contract: 172563, estHours: 648, trackedHours: 415.5, rate: 77.98, materialAllowance: 105809, materialSpent: 0, received: 0 })
ck('Leonard: cash flow is negative labor spent (−$32,400.69)', near(l.cashFlowToDate, -32400.69))

// ── Over ──
const o = computeProjectPnl({ contract: 10000, estHours: 40, trackedHours: 52, rate: 80, materialAllowance: 2000, materialSpent: 2600, received: 0 })
ck('labor over flags + negative remaining', o.labor.over && near(o.labor.remaining, -960))
ck('material over flags + negative remaining', o.material.over && near(o.material.remaining, -600))

// ── Edges ──
const z = computeProjectPnl({ contract: 0, estHours: 0, trackedHours: 5, rate: 80, materialAllowance: 0, materialSpent: 0, received: 0 })
ck('no budget → ratio 0, not Infinity', z.labor.ratio === 0)
ck('a refund (negative received) flows through', near(computeProjectPnl({ ...m, contract: 1, received: -500 }).received, -500))
ck('pnlRate: TODAY\'s org rate wins over the billed/locked rate', pnlRate(77.98, 81.21) === 77.98)
ck('pnlRate: no org rate → locked rate', pnlRate(null, 81.21) === 81.21 && pnlRate(0, 81.21) === 81.21)
ck('pnlRate: neither → 0', pnlRate(null, null) === 0)

// ── Duplicate warning ──
const ex = [
  { id: 'a', vendor_name: 'Rugby Architectural', amount: 1240.5, invoice_date: '2026-10-20' },
  { id: 'b', vendor_name: 'Hafele', amount: 88, invoice_date: '2026-09-01' },
]
ck('same vendor (case/punct-insensitive), same cents, within 7 days → warn', findLikelyDuplicates(ex, { vendor_name: 'RUGBY architectural.', amount: 1240.5, invoice_date: '2026-10-24' }).length === 1)
ck('8 days apart → no warning', findLikelyDuplicates(ex, { vendor_name: 'Rugby Architectural', amount: 1240.5, invoice_date: '2026-10-28' }).length === 0)
ck('different amount → no warning', findLikelyDuplicates(ex, { vendor_name: 'Rugby Architectural', amount: 1240.51, invoice_date: '2026-10-20' }).length === 0)
ck('unknown date + same vendor/amount → warn', findLikelyDuplicates(ex, { vendor_name: 'Hafele', amount: 88, invoice_date: null }).length === 1)
ck('sumExpenses rounds to cents', sumExpenses([{ amount: 0.1 }, { amount: 0.2 }]) === 0.3)

// ── Wiring ──
const read = (f) => fs.readFileSync(f, 'utf8')
const page = read('app/(app)/projects/[id]/page.tsx')
const parser = read('components/invoice-parser.tsx')
const mig = read('db/migrations/124_invoices_expense_ledger.sql')
ck('no project_expenses table anywhere (one ledger — Andrew 10-29)', !/from\('project_expenses'\)/.test(execSync('grep -rh "from(" lib app components || true').toString()))
ck('124 is idempotent + reloads the schema', /ADD COLUMN IF NOT EXISTS source/.test(mig) && /NOTIFY pgrst, 'reload schema'/.test(mig))
ck('124 org-scopes invoices + line items', /invoices_own_org/.test(mig) && /invoice_line_items_own_org/.test(mig))
ck('the parser saves through createExpense (line items carry org_id)', /createExpense\(/.test(parser) && !/from\('invoice_line_items'\)\.insert/.test(parser))
ck('project page computes the panel with computeProjectPnl', /computeProjectPnl\(/.test(page))
ck('project page values hours at today\'s rate (pnlRate(orgShopRate, …))', /pnlRate\(orgShopRate,/.test(page))
ck('panel shows received + cash flow, not margin', /received/.test(read('components/project/ProjectPnlPanel.tsx')) && /Cash flow to date/.test(read('components/project/ProjectPnlPanel.tsx')) && !/marginToDate/.test(read('components/project/ProjectPnlPanel.tsx')))
ck('time modal names come from the roster, not users (the "…" bug)', /loadRosterNamesByUserId/.test(read('components/project/TimeDashboardModal.tsx')) && !/from\('users'\)/.test(read('components/project/TimeDashboardModal.tsx')))
ck('stage actions live in the header (one stage-actions hook)', (page.match(/data-tour="stage-actions"/g) || []).length === 1)
ck('the old HOURS section left the panel', !/<ProjectHoursSection/.test(page))

console.log(bad === 0 ? '\nPASS' : `\nFAIL — ${bad}`)
process.exit(bad === 0 ? 0 : 1)
