// ============================================================================
// lib/eng-board-math.ts — the engineering board's packing math (PURE)
// ============================================================================
// The model, in one line: plan in strips, burn by the time clock, re-divide by
// hand only when needed.
//
//   · A STRIP is a project's REMAINING engineering hours: est eng hours (the
//     estimate rollup, same figure /capacity reads) − tracked eng time (the
//     time clock). Tracked time eats it automatically; nobody edits the board
//     when reality interrupts.
//   · Each lane (engineer) packs its strips forward from TODAY, in priority
//     order, at the engineer's daily hours (hours_per_week / 5, less PTO /
//     holidays, less what they already tracked today).
//   · A DIVIDED strip (the divide modal) keeps its hand-set days. Tracked time
//     eats it from the left; hours whose day has passed unworked roll forward
//     after its last day. Divided days are reserved BEFORE the auto strips
//     pack, so auto strips fill around them — that's the point of dividing.
//   · "Drawings by" = the strip's last day. A firm date the pack can't make
//     flags AT RISK; nothing slides silently.
//
// Pure (no Supabase) so scripts/verify-eng-board.mjs can foot it by hand.
// Dates are local 'YYYY-MM-DD' keys; workdays are Mon–Fri.
// ============================================================================

export interface Division { date: string; hours: number }

export interface LaneInput {
  memberId: string
  /** hours_per_week / 5 */
  dailyHours: number
  /** date → hours OUT that day (PTO / holiday). ≥ daily = a day off. */
  outByDay: Record<string, number>
  /** date → eng hours this engineer already tracked that day (all projects). */
  trackedByDay: Record<string, number>
}

export interface StripInput {
  projectId: string
  memberId: string
  priority: number
  estHours: number
  trackedHours: number
  divisions: Division[] | null
  firmDate: string | null
}

export interface PackedStrip {
  projectId: string
  memberId: string
  remaining: number
  /** date → planned hours (only days with > 0). */
  days: Record<string, number>
  start: string | null
  end: string | null
  divided: boolean
  /** Couldn't place everything inside the horizon. */
  overflow: number
  atRisk: boolean
}

export interface PackedLane {
  memberId: string
  /** date → { cap, planned, tracked } for every workday in the horizon. */
  load: Record<string, { cap: number; planned: number; tracked: number }>
  strips: PackedStrip[]
  queued: number
}

const EPS = 1e-6

export function parseKey(k: string): Date {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1, 12)
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function isWorkday(k: string): boolean {
  const g = parseKey(k).getDay()
  return g !== 0 && g !== 6
}

/** The next `n` workdays starting at `fromKey` (inclusive when it's a workday). */
export function workdaysFrom(fromKey: string, n: number): string[] {
  const out: string[] = []
  const d = parseKey(fromKey)
  while (out.length < n) {
    const k = dateKey(d)
    if (isWorkday(k)) out.push(k)
    d.setDate(d.getDate() + 1)
  }
  return out
}

export function mondayOfKey(k: string): string {
  const d = parseKey(k)
  const g = d.getDay()
  d.setDate(d.getDate() - (g === 0 ? 6 : g - 1))
  return dateKey(d)
}

/** Remaining = est − tracked, never negative. */
export function remainingHours(est: number, tracked: number): number {
  return Math.max(0, (Number(est) || 0) - (Number(tracked) || 0))
}

/** A lane's packable capacity on a day: daily − out, and today also − what
 *  they already tracked today (that part of the day is spent). */
export function dayCapacity(lane: LaneInput, day: string, today: string): number {
  if (day < today) return 0
  let cap = Math.max(0, lane.dailyHours - (lane.outByDay[day] || 0))
  if (day === today) cap = Math.max(0, cap - (lane.trackedByDay[day] || 0))
  return cap
}

/** Eat `remaining` out of a divided plan: past days drop, tracked time eats
 *  from the left, unworked hours roll forward after the last day. Returns the
 *  planned days (future only) + the hours still to auto-place after them. */
export function eatDivisions(
  divisions: Division[],
  remaining: number,
  today: string,
): { days: Array<{ date: string; hours: number }>; rollForward: number; after: string | null } {
  const future = divisions
    .filter((d) => d.date >= today && (Number(d.hours) || 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, hours: Number(d.hours) || 0 }))
  const futureSum = future.reduce((s, d) => s + d.hours, 0)
  if (remaining >= futureSum - EPS) {
    return {
      days: future,
      rollForward: Math.max(0, remaining - futureSum),
      after: future.length ? future[future.length - 1].date : null,
    }
  }
  // Tracked time eats from the left.
  let toEat = futureSum - remaining
  const days: Array<{ date: string; hours: number }> = []
  for (const d of future) {
    if (toEat >= d.hours - EPS) { toEat -= d.hours; continue }
    days.push({ date: d.date, hours: d.hours - toEat })
    toEat = 0
  }
  return { days, rollForward: 0, after: null }
}

/**
 * Pack one lane. `horizon` = every workday from today forward that we're
 * willing to place hours on (long enough that "by" dates are real).
 */
export function packLane(
  lane: LaneInput,
  strips: StripInput[],
  today: string,
  horizon: string[],
): PackedLane {
  const ordered = [...strips].sort((a, b) => a.priority - b.priority || a.projectId.localeCompare(b.projectId))
  const free: Record<string, number> = {}
  for (const d of horizon) free[d] = dayCapacity(lane, d, today)

  const out: PackedStrip[] = []
  const byId = new Map<string, PackedStrip>()
  const pendingRoll: Array<{ s: PackedStrip; hours: number; after: string | null }> = []

  // 1) Divided strips reserve their hand-set days first.
  for (const s of ordered) {
    const remaining = remainingHours(s.estHours, s.trackedHours)
    const p: PackedStrip = {
      projectId: s.projectId, memberId: s.memberId, remaining, days: {},
      start: null, end: null, divided: !!(s.divisions && s.divisions.length), overflow: 0, atRisk: false,
    }
    byId.set(s.projectId, p)
    if (!p.divided || remaining <= EPS) continue
    const eaten = eatDivisions(s.divisions!, remaining, today)
    for (const d of eaten.days) {
      p.days[d.date] = (p.days[d.date] || 0) + d.hours
      if (d.date in free) free[d.date] = Math.max(0, free[d.date] - d.hours)
    }
    if (eaten.rollForward > EPS) pendingRoll.push({ s: p, hours: eaten.rollForward, after: eaten.after })
  }

  // 2) Auto strips (and divided roll-forward) pack greedily in priority order.
  const fill = (p: PackedStrip, hours: number, afterDay: string | null) => {
    let left = hours
    for (const d of horizon) {
      if (left <= EPS) break
      if (afterDay && d <= afterDay) continue
      const take = Math.min(free[d], left)
      if (take <= EPS) continue
      p.days[d] = (p.days[d] || 0) + take
      free[d] -= take
      left -= take
    }
    p.overflow += Math.max(0, left)
  }
  for (const s of ordered) {
    const p = byId.get(s.projectId)!
    if (!p.divided && p.remaining > EPS) fill(p, p.remaining, null)
    const roll = pendingRoll.find((r) => r.s === p)
    if (roll) fill(p, roll.hours, roll.after)
    const keys = Object.keys(p.days).filter((k) => p.days[k] > EPS).sort()
    p.start = keys[0] || null
    p.end = keys[keys.length - 1] || null
    p.atRisk = !!s.firmDate && p.remaining > EPS && (p.overflow > EPS || (!!p.end && p.end > s.firmDate))
    out.push(p)
  }

  const load: PackedLane['load'] = {}
  for (const d of horizon) {
    load[d] = { cap: Math.max(0, lane.dailyHours - (lane.outByDay[d] || 0)), planned: 0, tracked: lane.trackedByDay[d] || 0 }
  }
  for (const p of out) for (const [d, h] of Object.entries(p.days)) if (load[d]) load[d].planned += h

  return { memberId: lane.memberId, load, strips: out, queued: out.reduce((s, p) => s + p.remaining, 0) }
}

/** Even split of `total` over `n` days, in half-hours, remainder up front. */
export function evenDivide(total: number, dates: string[]): Division[] {
  const n = dates.length
  if (n === 0) return []
  const halves = Math.round(total * 2)
  const base = Math.floor(halves / n)
  let extra = halves - base * n
  return dates.map((date) => {
    const h = base + (extra > 0 ? 1 : 0)
    if (extra > 0) extra--
    return { date, hours: h / 2 }
  })
}

/** The divide modal's sum gate: matches the remaining hours to the half-hour. */
export function divisionsMatch(rows: Division[], remaining: number): boolean {
  const sum = rows.reduce((s, r) => s + (Number(r.hours) || 0), 0)
  return Math.abs(sum - remaining) < 0.26
}

/** A priority that lands between two neighbours (rail drag). */
export function priorityBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return 1
  if (before == null) return after! - 1
  if (after == null) return before + 1
  return (before + after) / 2
}

/** Hours for display: whole when whole, else one decimal. */
export function fmtH(n: number): string {
  const r = Math.round(n * 10) / 10
  return Number.isInteger(r) ? String(r) : r.toFixed(1)
}
