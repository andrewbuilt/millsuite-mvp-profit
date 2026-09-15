// ============================================================================
// lib/time-filters.ts — week maths + the /time filter predicate. PURE.
// ============================================================================
// ⛔ NO SUPABASE IMPORT. `mondayOf` and `isoDate` used to live in
// lib/worker-time, which builds a client at module scope — so nothing could
// test them. They moved here and worker-time re-exports them, which keeps
// every existing call site working. Same split as lib/payment-schedule and
// lib/supply-item.
//
// ⛔ EVERY DATE HERE IS LOCAL. `toISOString().slice(0,10)` is the UTC day and
// rolls at 8pm Eastern, which on a time sheet means an evening's work lands on
// tomorrow — and on a Sunday evening, in next week's bar. This codebase has
// been bitten by that on payments and on `received_date`; don't reintroduce it.
// ============================================================================

/**
 * The week bar: hours logged against a person's own weekly target.
 *
 * ⛔ EXTRACTED SO /me AND /team CANNOT DISAGREE. This math lived inside /me's
 * `WeekHoursBar`. /team's roster now shows the same bar on each collapsed row,
 * and two copies of "am I at 100% this week?" would eventually answer
 * differently for the same person on the same day — which is worse than not
 * showing it at all.
 *
 * ⛔ PLAIN `hours_per_week`, NOT PTO-ADJUSTED (scoped explicitly). Capacity
 * already computes a PTO-aware week; folding that in makes the bar move for
 * reasons the reader didn't cause — a target that shrinks because you booked a
 * day off reads as the app losing your hours.
 *
 * ⚠️ `liveMinutes` IS THE RUNNING CLOCK. Closed entries carry
 * `duration_minutes`; an open shift doesn't. Without it, someone four hours
 * into the day watches the bar sit still all morning and concludes it's broken.
 *
 * The colours are deliberately not a performance score: amber on the way,
 * green once the week is made, blue past it.
 */
export interface WeekBar {
  /** Logged + running, in minutes. */
  total: number
  targetMinutes: number
  pct: number
  /** `pct` clamped to 0–100, for the fill width. */
  width: number
  over: boolean
  color: string
}

export function weekBar(minutes: number, liveMinutes: number, targetHours: number): WeekBar {
  const total = Math.max(0, minutes || 0) + Math.max(0, liveMinutes || 0)
  // ⚠️ NEVER ZERO. A 0h target divides by zero and paints every bar full — and
  // 0 is a real value on the roster for anyone who isn't on a weekly schedule.
  const targetMinutes = Math.max(1, Math.round((targetHours > 0 ? targetHours : 40) * 60))
  const pct = (total / targetMinutes) * 100
  return {
    total,
    targetMinutes,
    pct,
    width: Math.max(0, Math.min(100, pct)),
    over: pct > 100,
    color: pct > 100 ? '#2563EB' : pct >= 100 ? '#059669' : '#D97706',
  }
}

/** Monday of the week containing `d`. Sunday belongs to the week just ended,
 *  matching the schedule board's convention. */
export function mondayOf(d: Date): Date {
  const x = new Date(d)
  const dow = x.getDay() // 0 Sun … 6 Sat
  const diff = dow === 0 ? -6 : 1 - dow
  x.setDate(x.getDate() + diff)
  x.setHours(0, 0, 0, 0)
  return x
}

/** 'YYYY-MM-DD' from a LOCAL date. Never `toISOString`. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type TimeRangeChip = 'today' | 'this_week' | 'last_week' | null

/** Inclusive local-day bounds for a chip, or null for "no date limit". */
export function chipRange(
  chip: TimeRangeChip,
  now: Date = new Date(),
): { from: string; to: string } | null {
  if (!chip) return null
  if (chip === 'today') {
    const t = isoDate(now)
    return { from: t, to: t }
  }
  const monday = mondayOf(now)
  if (chip === 'last_week') monday.setDate(monday.getDate() - 7)
  const sunday = new Date(monday)
  // ⚠️ Monday..SUNDAY, not Monday..Friday. /me shows a Mon–Fri work week, but
  // a FILTER that hides Saturday's entries would make logged time vanish from
  // the list with no explanation. A week here is all seven days.
  sunday.setDate(sunday.getDate() + 6)
  return { from: isoDate(monday), to: isoDate(sunday) }
}

/** The shape the predicate needs — a subset of the page's TimeEntry. */
export interface FilterableEntry {
  projectId: string | null
  /** Roster member id, resolved from the entry's login id. Null when the
   *  login isn't on the roster. */
  memberId: string | null
  /** The entry's LOCAL calendar day, 'YYYY-MM-DD'. */
  day: string
  /** Everything a text search should look at, already joined and lowercased
   *  by the caller — project name, subproject, department, notes, who. */
  haystack: string
}

export interface TimeFilter {
  text: string
  projectId: string
  memberId: string
  /** A single local day, or '' for none. Applied ALONGSIDE the chip. */
  date: string
  chip: TimeRangeChip
}

export const EMPTY_TIME_FILTER: TimeFilter = {
  text: '',
  projectId: '',
  memberId: '',
  date: '',
  chip: null,
}

export function isFilterActive(f: TimeFilter): boolean {
  return !!(f.text.trim() || f.projectId || f.memberId || f.date || f.chip)
}

/**
 * Does this entry survive the filter?
 *
 * ⛔ EVERY CONDITION IS AND-ED. A time sheet is something people reconcile
 * against payroll, so a filter that quietly widens the result is worse than
 * one that shows nothing — "no entries match" is a fact you can act on.
 *
 * Text terms are AND-ed across the WHOLE row rather than per field, so
 * "kaylin murtagh" finds Kaylin's entries on Murtagh Bar. Same rule as the
 * supplies search, for the same reason.
 */
export function matchesTimeFilter(
  entry: FilterableEntry,
  f: TimeFilter,
  /** ⛔ INJECTED, NOT READ FROM THE CLOCK. The chips resolve against "now",
   *  so without this the predicate's answer changes with the wall clock and
   *  no test can pin it — a verification script would pass in one week and
   *  fail the next. Defaulted so callers don't have to care. */
  now: Date = new Date(),
): boolean {
  if (f.projectId && entry.projectId !== f.projectId) return false
  if (f.memberId && entry.memberId !== f.memberId) return false
  if (f.date && entry.day !== f.date) return false

  const range = chipRange(f.chip, now)
  if (range && (entry.day < range.from || entry.day > range.to)) return false

  const q = f.text.trim().toLowerCase()
  if (q) {
    const terms = q.split(/\s+/)
    if (!terms.every((t) => entry.haystack.includes(t))) return false
  }
  return true
}
