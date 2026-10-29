// ============================================================================
// lib/project-expenses-math.ts — the pure half of lib/project-expenses
// ============================================================================
// Split out so scripts can import it: lib/project-expenses builds a Supabase
// client at module scope, which throws without env (same reason as
// lib/swt-features-math, 10-23).
// ============================================================================

import type { ProjectExpense } from './project-expenses'

export function sumExpenses(rows: { amount: number }[]): number {
  return Math.round(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100
}

/**
 * Likely duplicates of a bill about to be saved: same vendor (case/space
 * insensitive), same amount to the cent, dates within 7 days (or either date
 * unknown). A WARNING, never a block — two identical bills a week apart are
 * real (a standing order); the person entering it decides.
 */
export function findLikelyDuplicates<T extends Pick<ProjectExpense, 'vendor_name' | 'amount' | 'invoice_date'>>(
  existing: T[],
  next: { vendor_name: string; amount: number; invoice_date: string | null },
): T[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const v = norm(next.vendor_name)
  const cents = Math.round(next.amount * 100)
  const day = (d: string | null) => (d ? Date.parse(`${d.slice(0, 10)}T00:00:00Z`) : NaN)
  const nd = day(next.invoice_date)
  return existing.filter((e) => {
    if (!v || norm(e.vendor_name) !== v) return false
    if (Math.round(e.amount * 100) !== cents) return false
    const ed = day(e.invoice_date)
    if (!Number.isFinite(nd) || !Number.isFinite(ed)) return true
    return Math.abs(nd - ed) <= 7 * 86400000
  })
}

