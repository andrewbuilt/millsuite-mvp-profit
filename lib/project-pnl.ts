// ============================================================================
// lib/project-pnl.ts — the project P&L panel's numbers (2026-10-29)
// ============================================================================
// PURE — no supabase, so scripts/verify-project-pnl.mjs can pin it.
//
// Andrew's sketch (2026-10-29, second pass): the panel is about MONEY OUT vs
// MONEY IN so far, not margin against the contract.
//
//   Contract                  live bid_total (the headline, as before)
//   Labor     budget hours · value  →  AMOUNT SPENT (tracked × rate) · left
//   Material  allowance             →  AMOUNT SPENT (Σ vendor bills) · left
//   Amount received           Σ project_payments (the payments ledger)
//   Cash flow to date         received − (labor spent + material spent)
//
// ⛔ LABOR IS VALUED AT TODAY'S SHOP RATE, not the job's pinned (billed) rate
// — Andrew: "this should use the current hourly rate not what we billed".
// Spent is what the hours COST the shop now; the pinned rate is what the
// client was charged, which belongs to pricing (lib/pricing), not here. The
// budget's value uses the same rate so budget and spent compare like-for-like.
// ============================================================================

export interface PnlInput {
  contract: number
  estHours: number
  trackedHours: number
  /** $/hr for BOTH labor columns — today's shop rate (see pnlRate). */
  rate: number
  /** Budgeted non-labor cost (material + hardware + options + custom + consumables). */
  materialAllowance: number
  materialSpent: number
  /** Net cash received on the job (project_payments). */
  received: number
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
  /** labor.actual + material.actual */
  spent: number
  received: number
  /** received − spent. Negative = the shop is carrying the job. */
  cashFlowToDate: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

function line(budget: number, actual: number): PnlLine {
  const b = r2(Math.max(0, budget))
  const a = r2(Math.max(0, actual))
  return { budget: b, actual: a, remaining: r2(b - a), over: a > b + 0.005, ratio: b > 0 ? a / b : 0 }
}

export function computeProjectPnl(i: PnlInput): ProjectPnl {
  const rate = Math.max(0, Number(i.rate) || 0)
  const labor = line(i.estHours * rate, i.trackedHours * rate)
  const material = line(i.materialAllowance, i.materialSpent)
  const spent = r2(labor.actual + material.actual)
  const received = r2(Number(i.received) || 0)
  return {
    contract: r2(Math.max(0, Number(i.contract) || 0)),
    rate,
    laborHours: line(i.estHours, i.trackedHours),
    labor,
    material,
    spent,
    received,
    cashFlowToDate: r2(received - spent),
  }
}

/** The rate the P&L values hours at: TODAY's org shop rate (Andrew 10-29),
 *  falling back to the job's locked rate only if the org has none set.
 *  Deliberately not lib/pricing.effectiveShopRate — that's the BILLED rate
 *  (pinned, and $0 on a frozen imported job). */
export function pnlRate(orgShopRate: number | null | undefined, lockedShopRate: number | null | undefined): number {
  return Number(orgShopRate) || Number(lockedShopRate) || 0
}
