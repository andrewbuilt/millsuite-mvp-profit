// ============================================================================
// lib/payment-schedule.ts — the calendar half of the payments model
// ============================================================================
// Andrew: "automatically populates with the upcoming draw payments · drag the
// payment to another month · mark as received · total needed for the month ·
// the math of what has come in this month."
//
// ⛔ THE TABLE IS `cash_flow_receivables`, NOT `project_milestones`. Milestones
// piggyback on the receivables table with `type='receivable'` (see
// lib/milestones). There is no project_milestones table; the scope note that
// said otherwise was wrong.
//
// ⛔ NO MIGRATION WAS NEEDED. The scope note asked whether marking a milestone
// received records WHEN. It does: `markMilestoneReceived` has always stamped
// `received_date`, and the column was verified present on prod 2026-09-11. It
// simply wasn't exposed on the `ProjectMilestone` type, which is why it looked
// absent.
//
// ── TWO DATES, AND THEY ARE NOT INTERCHANGEABLE ────────────────────────────
// `expected_date` = when we PLAN for the money. Drives "needed this month".
// `received_date` = when the money ACTUALLY ARRIVED. Drives "received this
// month".
// A draw expected in August but paid in September is September cash and August
// shortfall. Bucketing both by the same date would quietly answer a different
// question from the one being asked.
//
// ── ⛔ THE TIMEZONE TRAP (read before touching any date here) ───────────────
// `expected_date` and `received_date` are DATE columns — bare 'YYYY-MM-DD'.
// `new Date('2026-09-01')` parses that as UTC midnight, which in any negative
// UTC offset is 2026-08-31 LOCAL. `.getMonth()` then returns August and the
// draw renders in the wrong month — silently, and only for shops west of
// Greenwich, which is all of them here.
// So: date-only strings go through `parseLocalDate`, and dates are written
// back with `formatLocalDate`. Never `new Date(str)` and never `.toISOString()`
// on a value that represents a calendar day.
//
// ⛔ NO DATABASE IMPORT, ON PURPOSE. This module is pure so the timezone guard
// (scripts/verify-payments.mjs) can import it with no credentials and no
// network. It used to live in lib/payments.ts, which constructs a Supabase
// client at module scope — so the guard threw "supabaseUrl is required" before
// reaching its first assertion. A safety net that can't run isn't one.
// ============================================================================

import type { ProjectStage } from './types'

export interface PaymentRow {
  id: string
  projectId: string
  projectName: string
  clientName: string | null
  stage: ProjectStage
  label: string
  amount: number
  status: 'projected' | 'invoiced' | 'received' | 'cancelled'
  /** Bare 'YYYY-MM-DD' or null. */
  expectedDate: string | null
  /** Bare 'YYYY-MM-DD' or null. */
  receivedDate: string | null
  /** Position in the AUTHORED schedule (deposit → … → final).
   *  ⛔ THE WATERFALL ORDERS BY THIS, NEVER BY `expectedDate`. See
   *  `reconcileAll`. Encoded as `order:N` in the row's `notes` (093). */
  sortOrder: number
  /** Tiebreak when two rows carry the same `order:N`. */
  createdAt: string | null
}

// ── Calendar-day helpers (see the timezone trap above) ──────────────────────

/** Parse a bare 'YYYY-MM-DD' as LOCAL midnight. Returns null for anything
 *  that isn't a well-formed date-only string. */
export function parseLocalDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const out = new Date(y, mo, d)
  // Reject a date the calendar rolled over (2026-02-31 → Mar 3).
  if (out.getFullYear() !== y || out.getMonth() !== mo || out.getDate() !== d) {
    return null
  }
  return out
}

/** Render a Date as a bare 'YYYY-MM-DD' using its LOCAL parts.
 *  ⛔ Not `.toISOString().slice(0,10)` — that converts to UTC first and can
 *  shift the day by one. */
export function formatLocalDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A calendar month. `month` is 0-based, matching Date. */
export interface MonthKey {
  year: number
  month: number
}

/** Stable string form, for map keys and React keys. */
export function monthId(k: MonthKey): string {
  return `${k.year}-${String(k.month + 1).padStart(2, '0')}`
}

export function monthOf(d: Date): MonthKey {
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** The month containing today, in the viewer's timezone. */
export function currentMonth(now = new Date()): MonthKey {
  return { year: now.getFullYear(), month: now.getMonth() }
}

/** Shift a month by n (handles year rollover in both directions). */
export function addMonths(k: MonthKey, n: number): MonthKey {
  const total = k.year * 12 + k.month + n
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

export function sameMonth(a: MonthKey, b: MonthKey): boolean {
  return a.year === b.year && a.month === b.month
}

/** Days in a given month — used to clamp a day-of-month on reschedule. */
export function daysInMonth(k: MonthKey): number {
  return new Date(k.year, k.month + 1, 0).getDate()
}

export function monthLabel(k: MonthKey): string {
  return new Date(k.year, k.month, 1).toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

export function monthLabelShort(k: MonthKey): string {
  return new Date(k.year, k.month, 1).toLocaleString(undefined, { month: 'short' })
}

/**
 * The `expected_date` a row should get when dragged into `target`.
 *
 * Preserves the day of month, because "the 15th" is usually the meaningful
 * part of a draw date. ⛔ CLAMPED, not rolled: the 31st dragged into a 30-day
 * month must become the 30th. `new Date(y, m, 31)` for a 30-day month silently
 * rolls into the FIRST of the month AFTER the one the operator dropped it in,
 * so the card would jump out of the column they just dropped it into.
 *
 * A row with no date at all lands on the 1st — it has no day to preserve, and
 * the 1st sorts it to the top of the month where it's most visible.
 */
export function rescheduleTo(row: PaymentRow, target: MonthKey): string {
  const existing = parseLocalDate(row.expectedDate)
  const day = existing ? existing.getDate() : 1
  const clamped = Math.min(day, daysInMonth(target))
  return formatLocalDate(new Date(target.year, target.month, clamped))
}

// ── Classification ──────────────────────────────────────────────────────────

/** Still owed: everything that isn't already in the bank or called off. */
export function isOutstanding(r: PaymentRow): boolean {
  return r.status === 'projected' || r.status === 'invoiced'
}
