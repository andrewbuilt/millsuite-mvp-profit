// ============================================================================
// lib/project-pnl.ts — the project P&L panel's numbers (2026-10-29, Cowork)
// ============================================================================
// PURE — no supabase, so scripts/verify-project-pnl.mjs can pin it.
//
//   Contract        live bid_total (change orders land in it as lines)
//   Labor           budget  = estimated hours × the job's PINNED rate
//                   actual  = tracked hours   × the SAME rate
//   Material        allowance = budgeted material + hardware + options +
//                   custom/vendor + consumables (CO-aware: COs are lines)
//                   spent     = Σ vendor bills (the `invoices` ledger, 124)
//   Margin to date  contract − (labor actual + material spent)
//
// Calls (veto-able, from the spec):
//   · labor is valued at the pinned shop rate on BOTH sides, so margin means
//     margin-vs-quote. Real wages are owner-only data and don't belong on a
//     manager-visible panel.
//   · an imported job prices at $0/hr (its price is frozen) — but its HOURS
//     still cost the shop, so the P&L values them at the job's locked rate,
//     falling back to the org rate. That is what makes "margin measured from
//     actuals" literal on imports.
//   · early in a job the margin reads high by nature (little spent yet) — the
//     panel labels it "margin to date", never final.
// ============================================================================

export interface PnlInput {
  contract: number
  estHours: number
  trackedHours: number
  /** $/hr used for BOTH labor columns. */
  rate: number
  /** Budgeted non-labor cost (material + hardware + options + custom + consumables). */
  materialAllowance: number
  materialSpent: number
}

export interface PnlLine {
  budget: number
  actual: number
  /** budget − actual; negative = over. */
  remaining: number
  over: boolean
  /** actual ÷ budget, 0 when no budget. */
  ratio: number
}

export interface ProjectPnl {
  contract: number
  rate: number
  laborHours: PnlLine
  labor: PnlLine
  material: PnlLine
  /** contract − (labor actual + material spent). */
  marginToDate: number
  /** marginToDate ÷ contract, as a percent; null with no contract. */
  marginToDatePct: number | null
  /** What the quote expected: contract − (labor budget + material allowance). */
  plannedMargin: number
  plannedMarginPct: number | null
}

const r2 = (n: number) => Math.round(n * 100) / 100

function line(budget: number, actual: number): PnlLine {
  const b = r2(Math.max(0, budget))
  const a = r2(Math.max(0, actual))
  return { budget: b, actual: a, remaining: r2(b - a), over: a > b + 0.005, ratio: b > 0 ? a / b : 0 }
}

export function computeProjectPnl(i: PnlInput): ProjectPnl {
  const rate = Math.max(0, Number(i.rate) || 0)
  const contract = r2(Math.max(0, Number(i.contract) || 0))
  const laborHours = line(i.estHours, i.trackedHours)
  const labor = line(i.estHours * rate, i.trackedHours * rate)
  const material = line(i.materialAllowance, i.materialSpent)
  const marginToDate = r2(contract - (labor.actual + material.actual))
  const plannedMargin = r2(contract - (labor.budget + material.budget))
  const pct = (n: number) => (contract > 0 ? (n / contract) * 100 : null)
  return {
    contract,
    rate,
    laborHours,
    labor,
    material,
    marginToDate,
    marginToDatePct: pct(marginToDate),
    plannedMargin,
    plannedMarginPct: pct(plannedMargin),
  }
}

/** The rate a P&L values hours at: the job's pinned rate, else the org's.
 *  Deliberately NOT lib/pricing.effectiveShopRate, which is 0 on a frozen
 *  (imported) job — right for PRICING, wrong for what an hour COSTS. */
export function pnlRate(lockedShopRate: number | null | undefined, orgShopRate: number | null | undefined): number {
  return Number(lockedShopRate) || Number(orgShopRate) || 0
}
