// ============================================================================
// lib/eng-due-check.ts — the end-of-day engineering check (PURE)
// ============================================================================
// Andrew 2026-11-25: "a ritual that forces the engineer to respond to whether
// they finished or not … a way to alert Kaylin that the department is behind."
//
//   · 3:30 PM shop time, an engineer is asked about every job on their list
//     that is due TODAY and not marked Engineering done. An OVERDUE job is
//     asked about at any time of day until it's answered.
//   · Only jobs with a due date (eng_assignments.firm_date) are ever asked.
//   · Answered today (done / not yet) = not asked again today.
//
// Pure, so scripts/verify-eng-due-check.mjs can foot it. The writes live in
// lib/eng-due-check-server.ts (service role) behind /api/engineering/due-check.
// ============================================================================

/** 3:30 PM, in minutes after midnight, shop time. */
export const CHECK_AT_MINUTES = 15 * 60 + 30

export type DueAnswer = 'done' | 'not_yet' | 'missed'

export interface DueAssignmentLite {
  project_id: string
  member_id: string
  firm_date: string | null
  done_at: string | null
}

export interface DueCheckLite {
  project_id: string
  check_date: string
  answer: DueAnswer
}

export interface JobToAsk {
  projectId: string
  /** The due date being asked about (YYYY-MM-DD). */
  due: string
  /** Due before today (asked at any hour). */
  overdue: boolean
}

/** Jobs this engineer must answer for right now, oldest due first. */
export function jobsToAsk(
  assignments: DueAssignmentLite[],
  checks: DueCheckLite[],
  memberId: string,
  today: string,
  minutesNow: number,
): JobToAsk[] {
  const answeredToday = new Set(
    checks.filter((c) => c.check_date === today && (c.answer === 'done' || c.answer === 'not_yet')).map((c) => c.project_id),
  )
  return assignments
    .filter((a) => a.member_id === memberId && !a.done_at && !!a.firm_date && a.firm_date <= today)
    .filter((a) => !answeredToday.has(a.project_id))
    .filter((a) => a.firm_date! < today || minutesNow >= CHECK_AT_MINUTES)
    .map((a) => ({ projectId: a.project_id, due: a.firm_date!, overdue: a.firm_date! < today }))
    .sort((x, y) => x.due.localeCompare(y.due) || x.projectId.localeCompare(y.projectId))
}

/** Jobs nobody answered for: due before today, not done, and no answer of any
 *  kind on or after the due day. Each becomes one 'missed' row + one Critical
 *  task for the PM (the row's unique (project, day) key keeps it to one). */
export function missedJobs(assignments: DueAssignmentLite[], checks: DueCheckLite[], today: string): JobToAsk[] {
  return assignments
    .filter((a) => !a.done_at && !!a.firm_date && a.firm_date < today)
    .filter((a) => !checks.some((c) => c.project_id === a.project_id && c.check_date >= a.firm_date!))
    .map((a) => ({ projectId: a.project_id, due: a.firm_date!, overdue: true }))
}

/** A "not yet" answer is usable: a real date after today and a reason. */
export function validNotYet(newDate: string | null | undefined, reason: string | null | undefined, today: string): string | null {
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return 'Pick when it will be ready.'
  if (newDate <= today) return 'Pick a day after today.'
  if (!reason || !reason.trim()) return 'Say what’s holding it up.'
  if (reason.trim().length > 1000) return 'Keep the reason under 1,000 characters.'
  return null
}

/** The next workday after `today` (the "Not yet" date picker's default). */
export function nextWorkday(today: string): string {
  const [y, m, d] = today.split('-').map(Number)
  const dt = new Date(y, m - 1, d, 12)
  do dt.setDate(dt.getDate() + 1)
  while (dt.getDay() === 0 || dt.getDay() === 6)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** "Fri, Nov 27" for a YYYY-MM-DD key. */
export function fmtDueDay(k: string): string {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
