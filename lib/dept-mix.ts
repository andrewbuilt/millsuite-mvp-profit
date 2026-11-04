// ============================================================================
// lib/dept-mix.ts — how one person's day divides across their departments
// ============================================================================
// (STATE 2026-11-06, item 3 — the LEARNED DEPARTMENT SPLIT.) A member in
// CNC + Engineering used to give each dept exactly half their day, always.
// Now the split comes from, in order:
//
//   1. PINNED  — the member's `dept_split` on /team ("Eng 100%"), when the
//                future won't look like the past. Unpin → learning resumes.
//   2. LEARNED — their trailing-4-week TRACKED hours by department (the
//                clock-in dept picker makes entries dept-true), once there's
//                at least LEARN_MIN_HOURS of it in their counting depts.
//   3. EVEN    — not enough data: an equal share per dept, exactly as before.
//
// ⛔ THE INVARIANT (Andrew, 2026-11-06): A MEMBER'S HOURS ARE NEVER COUNTED
// TWICE. Their fractions sum to EXACTLY 1 — pinned, learned or even alike.
// Pinned + learned shares are whole basis points (1/10,000) by largest
// remainder, so they sum to 10,000 exactly; even is 1/n. Σ(dept capacity) is
// therefore Σ(member hours), and changing HOW a day splits can only move
// hours BETWEEN departments, never add or lose any.
// (scripts/verify-dept-mix.mjs asserts it per member and shop-wide.)
//
// Only the member's COUNTING depts take a share (dept_assignments minus
// management-style depts, migration 128). Time tracked in a dept they aren't
// assigned to is ignored — it says nothing about how to split THEIR roster.
//
// PTO and holidays don't skew it: it's a ratio of what they tracked, and the
// capacity PTO subtraction uses this SAME split (shop-rate-setup).
//
// Pure — no database. The loader lives in shop-rate-setup.
// ============================================================================

/** The trailing window the learned split reads. */
export const LEARN_WINDOW_DAYS = 28
/** Below this many tracked hours (in their counting depts) → even split. */
export const LEARN_MIN_HOURS = 20
/** Pinned / learned shares are whole basis points. */
export const MIX_GRID = 10000

export type MixSource = 'pinned' | 'learned' | 'even'

export interface DeptMix {
  /** [deptId, fraction] in the member's dept order; Σ fraction = 1 exactly
   *  (empty when the member has no counting dept). */
  shares: Array<[string, number]>
  source: MixSource
  /** Tracked hours in their counting depts over the window (0 = none read). */
  trackedHours: number
}

/** The part of a team member this needs (TeamMember satisfies it). */
export interface MixMember {
  dept_assignments: string[]
  /** deptId → percent, set on /team. null / empty = not pinned. */
  dept_split?: Record<string, number> | null
}

/** Whole-number parts of `grid` in proportion to `weights` (largest
 *  remainder; ties → earlier). Σ = grid exactly. All-zero → even. */
export function largestRemainder(weights: number[], grid = MIX_GRID): number[] {
  const n = weights.length
  if (n === 0) return []
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0))
  const sum = w.reduce((a, b) => a + b, 0)
  const raw = sum > 0 ? w.map((x) => (grid * x) / sum) : w.map(() => grid / n)
  const out = raw.map((v) => Math.floor(v))
  let left = grid - out.reduce((a, b) => a + b, 0)
  const order = raw.map((v, i) => ({ i, r: v - Math.floor(v) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const o of order) {
    if (left <= 0) break
    out[o.i] += 1
    left -= 1
  }
  return out
}

/**
 * How a member's day divides across their counting departments.
 *
 * @param depts          their COUNTING depts (dept_assignments minus excluded)
 * @param trackedMinutes deptId → minutes they tracked in the window; omit
 *                       when the caller didn't load it (→ pinned or even).
 */
export function memberDeptMix(
  m: MixMember,
  depts: string[],
  trackedMinutes?: Record<string, number> | null,
): DeptMix {
  const trackedHours = depts.reduce((a, d) => a + (Number(trackedMinutes?.[d]) || 0), 0) / 60
  if (depts.length === 0) return { shares: [], source: 'even', trackedHours: 0 }

  const pin = m.dept_split || null
  const pinW = depts.map((d) => Number(pin?.[d]) || 0)
  if (pinW.some((x) => x > 0)) {
    const parts = largestRemainder(pinW)
    return { shares: depts.map((d, i) => [d, parts[i] / MIX_GRID]), source: 'pinned', trackedHours }
  }

  if (trackedMinutes && trackedHours >= LEARN_MIN_HOURS) {
    const parts = largestRemainder(depts.map((d) => Number(trackedMinutes[d]) || 0))
    return { shares: depts.map((d, i) => [d, parts[i] / MIX_GRID]), source: 'learned', trackedHours }
  }

  // EVEN — 1/n, the pre-2026-11-06 behaviour to the bit.
  return { shares: depts.map((d) => [d, 1 / depts.length]), source: 'even', trackedHours }
}

/** "CNC 64% · Eng 36%" (names via `nameOf`); "" with no depts. */
export function mixLabel(mix: DeptMix, nameOf: (deptId: string) => string): string {
  return mix.shares
    .map(([d, f]) => `${nameOf(d)} ${Math.round(f * 100)}%`)
    .join(' · ')
}

/** Where the split came from, said plainly. */
export function mixSourceLabel(mix: DeptMix): string {
  if (mix.source === 'pinned') return 'pinned'
  if (mix.source === 'learned') return `from the last ${LEARN_WINDOW_DAYS / 7} weeks (${Math.round(mix.trackedHours)}h tracked)`
  return mix.trackedHours > 0
    ? `even — only ${Math.round(mix.trackedHours)}h tracked in ${LEARN_WINDOW_DAYS / 7} weeks (needs ${LEARN_MIN_HOURS}h)`
    : 'even — no tracked time yet'
}
