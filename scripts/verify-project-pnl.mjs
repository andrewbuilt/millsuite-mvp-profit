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
const m = computeProjectPnl({ contract: 26227, estHours: 180, trackedHours: 69, rate: 81.21, materialAllowance: 6200, materialSpent: 2450.5 })
ck('labor budget = 180h × $81.21 = $14,617.80', near(m.labor.budget, 14617.8))
ck('labor actual = 69h × $81.21 = $5,603.49', near(m.labor.actual, 5603.49))
ck('labor remaining = budget − actual', near(m.labor.remaining, 14617.8 - 5603.49) && !m.labor.over)
ck('material remaining = 6,200 − 2,450.50', near(m.material.remaining, 3749.5))
ck('margin to date = 26,227 − (5,603.49 + 2,450.50) = $18,173.01', near(m.marginToDate, 18173.01))
ck('margin to date % = 69.3%', near(Math.round(m.marginToDatePct * 10) / 10, 69.3))
ck('planned margin = 26,227 − (14,617.80 + 6,200) = $5,409.20', near(m.plannedMargin, 5409.2))
ck('hours line carries raw hours', m.laborHours.budget === 180 && m.laborHours.actual === 69)

// ── Over ──
const o = computeProjectPnl({ contract: 10000, estHours: 40, trackedHours: 52, rate: 80, materialAllowance: 2000, materialSpent: 2600 })
ck('labor over flags + negative remaining', o.labor.over && near(o.labor.remaining, -960))
ck('material over flags + negative remaining', o.material.over && near(o.material.remaining, -600))
ck('margin to date can go negative-ish correctly', near(o.marginToDate, 10000 - (4160 + 2600)))

// ── Edges ──
const z = computeProjectPnl({ contract: 0, estHours: 0, trackedHours: 5, rate: 80, materialAllowance: 0, materialSpent: 0 })
ck('no contract → margin % is null, not NaN/Infinity', z.marginToDatePct === null && z.plannedMarginPct === null)
ck('no budget → ratio 0, not Infinity', z.labor.ratio === 0)
ck('pnlRate: locked wins', pnlRate(81.21, 77.98) === 81.21)
ck('pnlRate: no lock → org rate (imports still cost hours)', pnlRate(null, 77.98) === 77.98 && pnlRate(0, 77.98) === 77.98)
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
ck('project page values hours with pnlRate, not the frozen pricing rate', /pnlRate\(/.test(page))
ck('stage actions live in the header (one stage-actions hook)', (page.match(/data-tour="stage-actions"/g) || []).length === 1)
ck('the old HOURS section left the panel', !/<ProjectHoursSection/.test(page))

console.log(bad === 0 ? '\nPASS' : `\nFAIL — ${bad}`)
process.exit(bad === 0 ? 0 : 1)
