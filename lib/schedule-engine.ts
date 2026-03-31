// lib/schedule-engine.ts
// Production schedule engine — pure functions, no React, no Supabase.
//
// CREW-SLOT MODEL (v12.1 — adaptive crew + fixed dependencies + PTO/holiday):
// Each department has headcount people. Engine distributes available
// people across concurrent subs: crew = floor(available / pending_subs).
// No idle workers when there's work to do.
//
// PTO/Holiday support (v12.1): HeadcountOverrides map reduces available
// headcount on specific days per department. Built from capacity_overrides
// + approved pto_requests by the page, passed to autoPlace/cascadeMove.
//
// Dept-by-dept placement for parallel distribution.
// Dependency tracking uses actual source dept (not assumed previous).
//
// Block duration = ceil(estimated_hours / (crew_size × hours_per_person_per_day))
// Queue priority: (1) in-progress first, (2) due date ASC, (3) FIFO

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

/** Department sequence — fixed for millwork shops */
export const DEPT_ORDER = ['engineering', 'cnc', 'assembly', 'finish', 'install'] as const
export type DeptKey = (typeof DEPT_ORDER)[number]

/** Gap days between departments (cure time, QC buffer, etc.) */
export const DEPT_GAPS: Record<string, number> = {
  'engineering→cnc': 0,
  'cnc→assembly': 1,       // QC buffer
  'assembly→finish': 0,
  'finish→install': 2,     // cure time
}

export function getGap(from: DeptKey, to: DeptKey): number {
  return DEPT_GAPS[`${from}→${to}`] ?? 0
}

/** Short labels for UI */
export const DEPT_SHORT: Record<DeptKey, string> = {
  engineering: 'ENG', cnc: 'CNC', assembly: 'ASM', finish: 'FIN', install: 'INS',
}

/** Priority sort weight */
const PRIORITY_WEIGHT: Record<string, number> = { high: 0, medium: 1, low: 2 }

/** A department_allocation row from the DB */
export interface Allocation {
  id: string
  subproject_id: string
  department_id: string
  dept_key: DeptKey              // derived from department name
  scheduled_date: string | null  // ISO date string — null = unscheduled
  scheduled_days: number | null  // actual working days this block spans (set by engine)
  estimated_hours: number
  actual_hours: number
  completed: boolean
  crew_size: number | null       // null = use department default
}

/** Project with scheduling context */
export interface ScheduleProject {
  id: string
  name: string
  client: string
  color: string
  priority: 'high' | 'medium' | 'low'
  due: string | null             // ISO date
  status: string
}

/** Subproject with scheduling context */
export interface ScheduleSub {
  id: string
  name: string
  project_id: string
  sub_due_date: string | null
  schedule_order: number
}

/** A visual block for the timeline — derived from Allocation + project context */
export interface PlacedBlock {
  allocationId: string           // department_allocations.id
  projectId: string
  subId: string
  subName: string
  projectName: string
  projectColor: string
  dept: DeptKey
  startDate: string              // ISO date
  days: number                   // working days this block spans
  hours: number
  crewSize: number               // actual crew size used for this block
  progress: number               // 0-100
  completed: boolean
  manuallyMoved: boolean         // future: track if user dragged this
}

/** Department configuration for scheduling */
export interface DeptConfig {
  [dept: string]: {
    defaultCrewSize: number      // minimum crew per project (1-3)
    headcount: number            // total people in department
    hoursPerPerson: number       // typically 8
    maxSlots: number             // computed: floor(headcount / defaultCrewSize)
  }
}

/** Daily capacity per department (hours — for backward compat with display) */
export interface DeptCapacity {
  [dept: string]: number         // dept_key → hours per day
}

/**
 * PTO/Holiday headcount overrides — reduces available people on specific days.
 * Built by the page from capacity_overrides + approved pto_requests.
 *
 * Key: "YYYY-MM-DD::dept_key" → number of people OUT that day in that dept.
 * A company holiday (no dept) reduces ALL departments.
 *
 * Example:
 *   "2026-03-25::assembly" → 1   (one assembler on PTO)
 *   "2026-07-04::*" → 999        (company holiday — everyone off)
 */
export interface HeadcountOverrides {
  [dateKeyDept: string]: number
}

/**
 * Get effective headcount for a department on a given date,
 * accounting for PTO/holidays.
 */
export function getEffectiveHeadcount(
  dateKey: string,
  dept: DeptKey,
  config: DeptConfig,
  overrides?: HeadcountOverrides,
): number {
  const base = config[dept]?.headcount || 1

  if (!overrides) return base

  // Company holiday — everyone off
  const holidayKey = `${dateKey}::*`
  if (overrides[holidayKey]) return 0

  // Department-specific reduction (PTO, equipment, etc.)
  const deptKey = `${dateKey}::${dept}`
  const reduction = overrides[deptKey] || 0

  return Math.max(0, base - reduction)
}

/** Slot occupancy per date per department — tracks PEOPLE assigned, not block count */
export interface SlotMap {
  [dateKey: string]: { [dept: string]: number }  // people assigned on this day
}

/** Capacity used on a specific date (hours-based for display) */
export interface CapacityMap {
  [dateKey: string]: { [dept: string]: number }
}

/** Schedule alert */
export interface ScheduleAlert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string
  projectId: string
  resolution: {
    label: string
    action: 'push_due' | 'set_due' | 'prioritize' | 'accept' | 'flag' | 'reschedule'
    value?: string               // new date or priority value
  }[]
}

/** Result of auto-placement */
export interface PlacementResult {
  /** Allocation updates to write to DB */
  updates: { id: string; scheduled_date: string; scheduled_days: number; crew_size: number }[]
  /** The placed blocks (for immediate rendering without re-query) */
  blocks: PlacedBlock[]
}

/** Result of cascade move */
export interface CascadeResult {
  /** All allocation updates to write to DB */
  updates: { id: string; scheduled_date: string; scheduled_days: number; crew_size: number }[]
  /** Warnings (e.g., "Assembly now overloaded on Mar 18") */
  warnings: string[]
}


// ═══════════════════════════════════════════════════════════════════
// DATE HELPERS — all scheduling math happens in workday space
// ═══════════════════════════════════════════════════════════════════

/** ISO date string from a Date. Returns '' for invalid dates. */
export function toDateKey(d: Date): string {
  if (!d || isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0]
}

/** Stable date from ISO string (noon to avoid timezone drift). */
export function parseDate(iso: string): Date {
  if (!iso || typeof iso !== 'string') return new Date(NaN)
  return new Date(iso + 'T12:00:00')
}

/** Is this a working day? (Mon-Fri) */
export function isWorkDay(d: Date): boolean {
  const dow = d.getDay()
  return dow !== 0 && dow !== 6
}

/**
 * Is this an effective working day? Checks weekday AND not a company holiday.
 * Use this in placement logic instead of raw isWorkDay when overrides are available.
 */
export function isEffectiveWorkDay(d: Date, overrides?: HeadcountOverrides): boolean {
  if (!isWorkDay(d)) return false
  if (!overrides) return true
  const key = `${toDateKey(d)}::*`
  return !overrides[key]
}

/** Add N working days to a date. Negative values go backward. */
export function addWorkDays(from: Date, days: number): Date {
  const d = new Date(from)
  d.setHours(12, 0, 0, 0)
  const step = days >= 0 ? 1 : -1
  let remaining = Math.abs(days)
  while (remaining > 0) {
    d.setDate(d.getDate() + step)
    if (isWorkDay(d)) remaining--
  }
  return d
}

/**
 * Add N effective working days (skipping weekends AND company holidays).
 */
export function addEffectiveWorkDays(from: Date, days: number, overrides?: HeadcountOverrides): Date {
  if (!overrides) return addWorkDays(from, days)
  const d = new Date(from)
  d.setHours(12, 0, 0, 0)
  const step = days >= 0 ? 1 : -1
  let remaining = Math.abs(days)
  while (remaining > 0) {
    d.setDate(d.getDate() + step)
    if (isEffectiveWorkDay(d, overrides)) remaining--
  }
  return d
}

/** Count working days between two dates (exclusive of `from`, inclusive of `to`). */
export function workDaysBetween(from: Date, to: Date): number {
  const a = new Date(from); a.setHours(12, 0, 0, 0)
  const b = new Date(to); b.setHours(12, 0, 0, 0)
  if (b <= a) return 0
  let count = 0
  const d = new Date(a)
  while (d < b) {
    d.setDate(d.getDate() + 1)
    if (isWorkDay(d)) count++
  }
  return count
}

/** Generate an array of workday Date objects starting from `start`. */
export function genWorkDays(start: Date, count: number): Date[] {
  const days: Date[] = []
  const d = new Date(start); d.setHours(12, 0, 0, 0)
  if (isWorkDay(d)) { days.push(new Date(d)); count-- }
  while (count > 0) {
    d.setDate(d.getDate() + 1)
    if (isWorkDay(d)) { days.push(new Date(d)); count-- }
  }
  return days
}

/** Get Monday of the week containing `date`. */
export function getMonday(date: Date): Date {
  const d = new Date(date); d.setHours(12, 0, 0, 0)
  const dow = d.getDay()
  const offset = dow === 0 ? -6 : 1 - dow
  d.setDate(d.getDate() + offset)
  return d
}


// ═══════════════════════════════════════════════════════════════════
// DEPT CONFIG BUILDER
// ═══════════════════════════════════════════════════════════════════

/** Default crew sizes per department (used when DB value is missing) */
const DEFAULT_CREW_SIZES: Record<DeptKey, number> = {
  engineering: 1, cnc: 1, assembly: 2, finish: 2, install: 2,
}

/** Default hours per person per day */
const DEFAULT_HOURS_PER_PERSON = 8

/**
 * Build DeptConfig from department metadata and team member counts.
 * This is the single source of truth for crew-slot calculations.
 */
export function buildDeptConfig(
  deptData: { key: DeptKey; defaultCrewSize?: number; headcount: number; hoursPerPerson?: number }[],
): DeptConfig {
  const config: DeptConfig = {}
  for (const d of deptData) {
    const crewSize = d.defaultCrewSize || DEFAULT_CREW_SIZES[d.key] || 2
    const hpp = d.hoursPerPerson || DEFAULT_HOURS_PER_PERSON
    config[d.key] = {
      defaultCrewSize: crewSize,
      headcount: d.headcount,
      hoursPerPerson: hpp,
      maxSlots: Math.max(1, Math.floor(d.headcount / crewSize)),
    }
  }
  // Ensure all departments exist with at least defaults
  for (const key of DEPT_ORDER) {
    if (!config[key]) {
      config[key] = {
        defaultCrewSize: DEFAULT_CREW_SIZES[key],
        headcount: DEFAULT_CREW_SIZES[key],
        hoursPerPerson: DEFAULT_HOURS_PER_PERSON,
        maxSlots: 1,
      }
    }
  }
  return config
}

/**
 * Convert DeptConfig to flat DeptCapacity (total hours per day) for display compatibility.
 * Used by Timeline, DailyDetail, and capacity % calculations.
 */
export function deptConfigToCapacity(config: DeptConfig): DeptCapacity {
  const cap: DeptCapacity = {}
  for (const [dept, c] of Object.entries(config)) {
    cap[dept] = c.headcount * c.hoursPerPerson
  }
  return cap
}


// ═══════════════════════════════════════════════════════════════════
// CREW-SIZE HELPERS
// ═══════════════════════════════════════════════════════════════════

/** Get effective crew size for an allocation (explicit override or department default). */
export function getCrewSize(alloc: Allocation, config: DeptConfig): number {
  if (alloc.crew_size && alloc.crew_size > 0) return alloc.crew_size
  return config[alloc.dept_key]?.defaultCrewSize || DEFAULT_CREW_SIZES[alloc.dept_key] || 2
}

/** How many slots does a crew of this size occupy? */
export function slotsForCrew(crewSize: number, defaultCrewSize: number): number {
  return Math.max(1, Math.ceil(crewSize / defaultCrewSize))
}

/** How many working days does a block span given hours, crew size, and hours per person? */
export function blockDays(hours: number, crewSize: number, hoursPerPerson: number = DEFAULT_HOURS_PER_PERSON): number {
  if (hours <= 0 || crewSize <= 0) return 1
  return Math.max(1, Math.ceil(hours / (crewSize * hoursPerPerson)))
}

/** Legacy overload — blockDays from dept capacity (used by display when no config available) */
export function blockDaysLegacy(hours: number, deptKey: string, capacity: DeptCapacity): number {
  const cap = capacity[deptKey] || 8
  if (cap <= 0) return 1
  return Math.max(1, Math.ceil(hours / cap))
}


// ═══════════════════════════════════════════════════════════════════
// SLOT TRACKING — crew slots occupied per date per dept
// ═══════════════════════════════════════════════════════════════════

/**
 * Build people-occupancy map from placed blocks.
 * Tracks how many PEOPLE are assigned per department per day.
 */
export function buildSlotMap(blocks: PlacedBlock[], config?: DeptConfig): SlotMap {
  const map: SlotMap = {}
  for (const b of blocks) {
    if (b.completed) continue
    const start = parseDate(b.startDate)
    if (isNaN(start.getTime())) continue

    const d = new Date(start); d.setHours(12, 0, 0, 0)
    let placed = 0
    while (placed < b.days && placed < 200) {
      if (isWorkDay(d)) {
        const key = toDateKey(d)
        if (key) {
          if (!map[key]) map[key] = {}
          map[key][b.dept] = (map[key][b.dept] || 0) + b.crewSize
        }
        placed++
      }
      d.setDate(d.getDate() + 1)
    }
  }
  return map
}

/** Build hours-based capacity map from placed blocks (for display: capacity %, heatmap). */
export function buildCapacityMap(blocks: PlacedBlock[], _capacity: DeptCapacity): CapacityMap {
  const map: CapacityMap = {}
  for (const b of blocks) {
    if (b.completed) continue
    const start = parseDate(b.startDate)
    if (isNaN(start.getTime())) continue
    // hours per day = crew_size × hours_per_person
    const hoursPerDay = b.crewSize * DEFAULT_HOURS_PER_PERSON
    let placed = 0
    const d = new Date(start); d.setHours(12, 0, 0, 0)
    while (placed < b.days && placed < 200) {
      if (isWorkDay(d)) {
        const key = toDateKey(d)
        if (key) {
          if (!map[key]) map[key] = {}
          map[key][b.dept] = (map[key][b.dept] || 0) + hoursPerDay
        }
        placed++
      }
      d.setDate(d.getDate() + 1)
    }
  }
  return map
}

/** Get available hours for a dept on a date (for display). */
export function getAvailable(
  dateKey: string, dept: string,
  capacityMap: CapacityMap, dailyCap: DeptCapacity,
): number {
  const used = capacityMap[dateKey]?.[dept] || 0
  const cap = dailyCap[dept] || 8
  return Math.max(0, cap - used)
}


// ═══════════════════════════════════════════════════════════════════
// SLOT-BASED PLACEMENT HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Find the earliest workday where at least `minCrew` people are available
 * for `durationDays` consecutive working days in the given department.
 * Available = effectiveHeadcount - people already assigned on that day.
 *
 * v12.1: Uses getEffectiveHeadcount to account for PTO/holidays.
 * On company holidays, effective headcount is 0 → day is skipped entirely.
 * On PTO days, headcount is reduced → fewer concurrent blocks fit.
 */
function findSlotStart(
  earliest: Date,
  dept: DeptKey,
  durationDays: number,
  minCrew: number,
  config: DeptConfig,
  slotMap: SlotMap,
  overrides?: HeadcountOverrides,
): Date {
  const d = new Date(earliest); d.setHours(12, 0, 0, 0)

  // Advance to first effective workday (skip weekends + company holidays)
  while (!isEffectiveWorkDay(d, overrides)) d.setDate(d.getDate() + 1)

  let safety = 0
  while (safety < 365) {
    let allClear = true
    const check = new Date(d); check.setHours(12, 0, 0, 0)
    let daysCounted = 0

    while (daysCounted < durationDays) {
      if (isEffectiveWorkDay(check, overrides)) {
        const key = toDateKey(check)
        const effectiveHC = getEffectiveHeadcount(key, dept, config, overrides)
        const peopleUsed = slotMap[key]?.[dept] || 0
        if (peopleUsed + minCrew > effectiveHC) {
          allClear = false
          break
        }
        daysCounted++
      } else if (isWorkDay(check)) {
        // It's a weekday but a company holiday — skip it, don't count as a working day
        // The block will span over this day (duration stays the same, calendar days increase)
      }
      check.setDate(check.getDate() + 1)
    }

    if (allClear) return new Date(d)

    d.setDate(d.getDate() + 1)
    while (!isEffectiveWorkDay(d, overrides)) d.setDate(d.getDate() + 1)
    safety++
  }

  return new Date(d)
}

/**
 * Reserve people in a department for a block's duration.
 * Adds crewSize to the people map for each effective working day.
 * Skips company holidays (they don't count as working days).
 */
function reserveSlot(
  start: Date,
  dept: DeptKey,
  durationDays: number,
  crewSize: number,
  slotMap: SlotMap,
  overrides?: HeadcountOverrides,
): number {
  const d = new Date(start); d.setHours(12, 0, 0, 0)
  let reserved = 0

  while (reserved < durationDays) {
    if (isEffectiveWorkDay(d, overrides)) {
      const key = toDateKey(d)
      if (!slotMap[key]) slotMap[key] = {}
      slotMap[key][dept] = (slotMap[key][dept] || 0) + crewSize
      reserved++
    } else if (isWorkDay(d)) {
      // Company holiday on a weekday — skip, don't count
    }
    d.setDate(d.getDate() + 1)
  }
  return reserved
}


// ═══════════════════════════════════════════════════════════════════
// BLOCK COMPUTATION — turn allocations into visual blocks
// ═══════════════════════════════════════════════════════════════════

/** Convert raw allocations + project/sub context into PlacedBlocks for rendering. */
export function buildBlocks(
  allocations: Allocation[],
  projects: ScheduleProject[],
  subs: ScheduleSub[],
  capacity: DeptCapacity,
  config?: DeptConfig,
): PlacedBlock[] {
  const projMap = new Map(projects.map(p => [p.id, p]))
  const subMap = new Map(subs.map(s => [s.id, s]))

  return allocations
    .filter(a => {
      if (!a.scheduled_date) return false
      const d = new Date(a.scheduled_date + 'T12:00:00')
      return !isNaN(d.getTime())
    })
    .map(a => {
      const sub = subMap.get(a.subproject_id)
      const proj = sub ? projMap.get(sub.project_id) : null
      const progress = a.completed ? 100
        : a.estimated_hours > 0 ? Math.min(100, Math.round((a.actual_hours / a.estimated_hours) * 100))
        : 0

      const crewSize = a.crew_size || config?.[a.dept_key]?.defaultCrewSize || DEFAULT_CREW_SIZES[a.dept_key] || 2
      const hpp = config?.[a.dept_key]?.hoursPerPerson || DEFAULT_HOURS_PER_PERSON
      const days = a.scheduled_days || blockDays(a.estimated_hours, crewSize, hpp)

      return {
        allocationId: a.id,
        projectId: sub?.project_id || '',
        subId: a.subproject_id,
        subName: sub?.name || '',
        projectName: proj?.name || '',
        projectColor: proj?.color || '#94A3B8',
        dept: a.dept_key,
        startDate: a.scheduled_date!,
        days,
        hours: a.estimated_hours,
        crewSize,
        progress,
        completed: a.completed,
        manuallyMoved: false,
      }
    })
}


// ═══════════════════════════════════════════════════════════════════
// AUTO-PLACEMENT — schedule a project using adaptive crew model
// ═══════════════════════════════════════════════════════════════════

/**
 * Place all unscheduled allocations for a project.
 *
 * v12.1: Added optional `overrides` parameter (HeadcountOverrides).
 * When provided, the engine reduces available headcount on PTO days
 * and skips company holidays entirely. Blocks stretch over holidays
 * (same working-day duration, more calendar days).
 */
export function autoPlace(
  project: ScheduleProject,
  projectSubs: ScheduleSub[],
  allocations: Allocation[],
  existingBlocks: PlacedBlock[],
  capacity: DeptCapacity,
  config?: DeptConfig,
  startAfter?: Date,
  overrides?: HeadcountOverrides,
): PlacementResult {
  const cfg = config || buildDefaultConfig(capacity)
  const slotMap = buildSlotMap(existingBlocks, cfg)
  const earliest = startAfter || new Date()
  earliest.setHours(12, 0, 0, 0)

  // Sort subs by: sub_due_date → schedule_order
  const sortedSubs = [...projectSubs].sort((a, b) => {
    const aDue = a.sub_due_date || project.due || '2099-01-01'
    const bDue = b.sub_due_date || project.due || '2099-01-01'
    const dateCmp = aDue.localeCompare(bDue)
    if (dateCmp !== 0) return dateCmp
    return (a.schedule_order ?? 0) - (b.schedule_order ?? 0)
  })

  // Index allocations by sub+dept for fast lookup
  const allocLookup = new Map<string, Allocation>()
  for (const a of allocations) {
    allocLookup.set(`${a.subproject_id}::${a.dept_key}`, a)
  }

  // Track exit date AND source department per sub
  const subExit = new Map<string, { date: Date; dept: DeptKey }>()

  const updates: PlacementResult['updates'] = []
  const newBlocks: PlacedBlock[] = []

  // Process department by department (enables parallel crew distribution)
  for (let deptIdx = 0; deptIdx < DEPT_ORDER.length; deptIdx++) {
    const dept = DEPT_ORDER[deptIdx]
    const deptCfg = cfg[dept]
    if (!deptCfg) continue
    const hpp = deptCfg.hoursPerPerson || DEFAULT_HOURS_PER_PERSON
    const defaultCrew = deptCfg.defaultCrewSize
    const headcount = deptCfg.headcount

    // Collect all subs that need this department
    type PendingItem = { sub: ScheduleSub; alloc: Allocation; earliestStart: Date }
    const pending: PendingItem[] = []

    for (const sub of sortedSubs) {
      const alloc = allocLookup.get(`${sub.id}::${dept}`)
      if (!alloc || alloc.completed || alloc.estimated_hours <= 0) continue

      // Earliest start: project start or exit from previous dept + gap
      let blockEarliest = new Date(earliest)

      const exitInfo = subExit.get(sub.id)
      if (exitInfo) {
        const gap = getGap(exitInfo.dept, dept)
        const afterGap = addEffectiveWorkDays(exitInfo.date, gap, overrides)
        if (afterGap > blockEarliest) blockEarliest = afterGap
      }

      pending.push({ sub, alloc, earliestStart: blockEarliest })
    }

    if (pending.length === 0) continue

    // Sort by earliest start, then due date
    pending.sort((a, b) => {
      const timeDiff = a.earliestStart.getTime() - b.earliestStart.getTime()
      if (Math.abs(timeDiff) > 43200000) return timeDiff // >12h difference
      const aDue = a.sub.sub_due_date || project.due || '2099-01-01'
      const bDue = b.sub.sub_due_date || project.due || '2099-01-01'
      return aDue.localeCompare(bDue)
    })

    // Place each sub with adaptive crew sizing
    for (let i = 0; i < pending.length; i++) {
      const { sub, alloc, earliestStart } = pending[i]
      const remaining = pending.length - i

      let crewSize: number

      if (alloc.crew_size && alloc.crew_size > 0) {
        // Manual override always wins
        crewSize = alloc.crew_size
      } else {
        // Advance to first effective workday before checking slotMap
        const checkDate = new Date(earliestStart); checkDate.setHours(12, 0, 0, 0)
        while (!isEffectiveWorkDay(checkDate, overrides)) checkDate.setDate(checkDate.getDate() + 1)
        const eKey = toDateKey(checkDate)

        // Use effective headcount (reduced by PTO) instead of static headcount
        const effectiveHC = getEffectiveHeadcount(eKey, dept, cfg, overrides)
        const usedAtEarliest = slotMap[eKey]?.[dept] || 0
        const availableAtEarliest = Math.max(0, effectiveHC - usedAtEarliest)

        crewSize = Math.max(defaultCrew, Math.floor(availableAtEarliest / remaining))
        // Cap at base headcount (not reduced — crew CAN be larger than one day's availability
        // because the engine will find days where the full crew fits)
        crewSize = Math.min(crewSize, headcount)
      }

      // Compute duration with this crew
      const duration = blockDays(alloc.estimated_hours, crewSize, hpp)

      // Find the earliest date where this crew fits for the full duration
      let startDate = findSlotStart(earliestStart, dept, duration, crewSize, cfg, slotMap, overrides)

      // Re-check available people at actual start (more might be free after push)
      if (!(alloc.crew_size && alloc.crew_size > 0)) {
        const sKey = toDateKey(startDate)
        const effectiveHCAtStart = getEffectiveHeadcount(sKey, dept, cfg, overrides)
        const usedAtStart = slotMap[sKey]?.[dept] || 0
        const availableAtStart = Math.max(0, effectiveHCAtStart - usedAtStart)
        const adjustedCrew = Math.min(Math.max(defaultCrew, Math.floor(availableAtStart / remaining)), headcount)

        if (adjustedCrew !== crewSize) {
          crewSize = adjustedCrew
          const newDuration = blockDays(alloc.estimated_hours, crewSize, hpp)
          startDate = findSlotStart(startDate, dept, newDuration, crewSize, cfg, slotMap, overrides)
        }
      }

      // Final duration with potentially-adjusted crew
      const finalDuration = blockDays(alloc.estimated_hours, crewSize, hpp)

      const dateKey = toDateKey(startDate)

      // Reserve people for this block (skips holidays)
      const actualDays = reserveSlot(startDate, dept, finalDuration, crewSize, slotMap, overrides)

      // Track exit for downstream dependency
      const exitDate = addEffectiveWorkDays(startDate, actualDays, overrides)
      subExit.set(sub.id, { date: exitDate, dept })

      updates.push({ id: alloc.id, scheduled_date: dateKey, scheduled_days: actualDays, crew_size: crewSize })

      newBlocks.push({
        allocationId: alloc.id,
        projectId: project.id,
        subId: sub.id,
        subName: sub.name,
        projectName: project.name,
        projectColor: project.color,
        dept,
        startDate: dateKey,
        days: actualDays,
        hours: alloc.estimated_hours,
        crewSize,
        progress: 0,
        completed: false,
        manuallyMoved: false,
      })
    }
  }

  return { updates, blocks: newBlocks }
}

/** Build a minimal DeptConfig from DeptCapacity for backward compatibility. */
function buildDefaultConfig(capacity: DeptCapacity): DeptConfig {
  const config: DeptConfig = {}
  for (const key of DEPT_ORDER) {
    const totalHours = capacity[key] || DEFAULT_HOURS_PER_PERSON
    const crewSize = DEFAULT_CREW_SIZES[key]
    const headcount = Math.max(1, Math.round(totalHours / DEFAULT_HOURS_PER_PERSON))
    config[key] = {
      defaultCrewSize: crewSize,
      headcount,
      hoursPerPerson: DEFAULT_HOURS_PER_PERSON,
      maxSlots: Math.max(1, Math.floor(headcount / crewSize)),
    }
  }
  return config
}


// ═══════════════════════════════════════════════════════════════════
// CASCADE MOVE — drag a block, push downstream deps in same sub
// ═══════════════════════════════════════════════════════════════════

/**
 * When a block is dragged to a new start date, cascade downstream
 * departments in the same subproject.
 * v12.1: Added optional overrides parameter for PTO/holiday awareness.
 */
export function cascadeMove(
  allBlocks: PlacedBlock[],
  movedBlockId: string,
  newStartDate: string,
  capacity: DeptCapacity,
  config?: DeptConfig,
  overrides?: HeadcountOverrides,
): CascadeResult {
  const movedBlock = allBlocks.find(b => b.allocationId === movedBlockId)
  if (!movedBlock) return { updates: [], warnings: [] }

  const cfg = config || buildDefaultConfig(capacity)

  const subBlocks = allBlocks
    .filter(b => b.subId === movedBlock.subId)
    .sort((a, b) => DEPT_ORDER.indexOf(a.dept) - DEPT_ORDER.indexOf(b.dept))

  const movedDeptIdx = DEPT_ORDER.indexOf(movedBlock.dept)
  const updates: CascadeResult['updates'] = []
  const warnings: string[] = []

  // Build slot map from ALL blocks EXCEPT the ones we're moving
  const movingIds = new Set<string>()
  movingIds.add(movedBlockId)
  for (const b of subBlocks) {
    if (DEPT_ORDER.indexOf(b.dept) >= movedDeptIdx) {
      movingIds.add(b.allocationId)
    }
  }
  const staticBlocks = allBlocks.filter(b => !movingIds.has(b.allocationId))
  const slotMap = buildSlotMap(staticBlocks, cfg)

  // Place the moved block at its new position
  const crewSize = movedBlock.crewSize
  const hpp = cfg[movedBlock.dept]?.hoursPerPerson || DEFAULT_HOURS_PER_PERSON
  const duration = blockDays(movedBlock.hours, crewSize, hpp)

  let prevEndDate = parseDate(newStartDate)
  const actualDays = reserveSlot(prevEndDate, movedBlock.dept, duration, crewSize, slotMap, overrides)
  updates.push({ id: movedBlockId, scheduled_date: newStartDate, scheduled_days: actualDays, crew_size: crewSize })
  prevEndDate = addEffectiveWorkDays(prevEndDate, actualDays - 1, overrides)

  // Check for people overload warnings
  const headcount = cfg[movedBlock.dept]?.headcount || 1
  const movedStart = parseDate(newStartDate)
  for (let i = 0; i < actualDays; i++) {
    const checkDate = addEffectiveWorkDays(movedStart, i, overrides)
    const dateKey = toDateKey(checkDate)
    const effectiveHC = getEffectiveHeadcount(dateKey, movedBlock.dept, cfg, overrides)
    const peopleUsed = slotMap[dateKey]?.[movedBlock.dept] || 0
    if (peopleUsed > effectiveHC) {
      warnings.push(
        `${DEPT_SHORT[movedBlock.dept]} has ${peopleUsed} people assigned on ${checkDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (only ${effectiveHC} available)`
      )
    }
  }

  // Cascade downstream departments in the same sub
  let prevDept = movedBlock.dept
  for (const b of subBlocks) {
    const bDeptIdx = DEPT_ORDER.indexOf(b.dept)
    if (bDeptIdx <= movedDeptIdx) continue
    if (b.completed) continue

    const gap = getGap(prevDept, b.dept)
    const cascadeEarliest = addEffectiveWorkDays(prevEndDate, gap, overrides)

    const bCrewSize = b.crewSize
    const bHpp = cfg[b.dept]?.hoursPerPerson || DEFAULT_HOURS_PER_PERSON
    const bDuration = blockDays(b.hours, bCrewSize, bHpp)

    const startDate = findSlotStart(cascadeEarliest, b.dept, bDuration, bCrewSize, cfg, slotMap, overrides)
    const dateKey = toDateKey(startDate)
    const cascadeDays = reserveSlot(startDate, b.dept, bDuration, bCrewSize, slotMap, overrides)

    updates.push({ id: b.allocationId, scheduled_date: dateKey, scheduled_days: cascadeDays, crew_size: bCrewSize })
    prevEndDate = addEffectiveWorkDays(startDate, cascadeDays - 1, overrides)
    prevDept = b.dept
  }

  return { updates, warnings }
}


// ═══════════════════════════════════════════════════════════════════
// SCHEDULE ANALYSIS — alerts
// ═══════════════════════════════════════════════════════════════════

/**
 * Compute alerts for the current schedule.
 * Checks: slot overloads, deadline overrun, tight deadlines, missing due dates.
 */
export function computeAlerts(
  blocks: PlacedBlock[],
  projects: ScheduleProject[],
  subs: ScheduleSub[],
  capacity?: DeptCapacity,
  config?: DeptConfig,
): ScheduleAlert[] {
  const alerts: ScheduleAlert[] = []
  const today = new Date(); today.setHours(0, 0, 0, 0)

  // ── CAPACITY OVERLOAD ALERTS ──
  if (capacity && blocks.length > 0) {
    const capMap = buildCapacityMap(blocks, capacity)
    const deptOverloads: Record<string, { dates: string[]; peakPct: number; peakHours: number; cap: number }> = {}

    for (const [dateKey, deptUsage] of Object.entries(capMap)) {
      const d = parseDate(dateKey)
      if (isNaN(d.getTime()) || d < today) continue

      for (const [dept, used] of Object.entries(deptUsage)) {
        const cap = capacity[dept] || 0
        if (cap <= 0) continue
        const pct = (used / cap) * 100
        if (pct > 100) {
          if (!deptOverloads[dept]) deptOverloads[dept] = { dates: [], peakPct: 0, peakHours: 0, cap }
          deptOverloads[dept].dates.push(dateKey)
          if (pct > deptOverloads[dept].peakPct) {
            deptOverloads[dept].peakPct = Math.round(pct)
            deptOverloads[dept].peakHours = Math.round(used)
          }
        }
      }
    }

    for (const [dept, data] of Object.entries(deptOverloads)) {
      const short = DEPT_SHORT[dept as DeptKey] || dept.toUpperCase().slice(0, 3)
      const dayCount = data.dates.length
      const severity = data.peakPct > 150 ? 'critical' as const : 'warning' as const

      alerts.push({
        id: `alert-capacity-${dept}`,
        severity,
        title: `${short} overloaded — ${dayCount} day${dayCount !== 1 ? 's' : ''} over capacity`,
        description: `${short} peaks at ${data.peakPct}% (${data.peakHours}h / ${data.cap}h per day). ${dayCount} working days exceed capacity.`,
        projectId: '',
        resolution: [
          { label: `Reschedule all to flatten ${short} load`, action: 'reschedule' },
          { label: 'Add overtime / temp staff', action: 'flag' },
          { label: 'Accept overload', action: 'accept' },
        ],
      })
    }
  }

  // ── DEADLINE ALERTS ──
  for (const project of projects) {
    const pBlocks = blocks.filter(b => b.projectId === project.id && !b.completed)
    if (pBlocks.length === 0) continue

    let latestEnd = new Date(0)
    for (const b of pBlocks) {
      const end = addWorkDays(parseDate(b.startDate), b.days)
      if (end > latestEnd) latestEnd = end
    }

    const projectedEndStr = latestEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

    if (!project.due) {
      alerts.push({
        id: `alert-${project.id}`,
        severity: 'info',
        title: `${project.name} — no due date`,
        description: `Projected completion ~${projectedEndStr}. Set a due date to track deadline risk.`,
        projectId: project.id,
        resolution: [
          { label: `Set due date to ${projectedEndStr}`, action: 'set_due', value: toDateKey(latestEnd) },
        ],
      })
      continue
    }

    const dueDate = parseDate(project.due)
    const overrunDays = workDaysBetween(dueDate, latestEnd)
    const floatDays = workDaysBetween(latestEnd, dueDate)

    if (latestEnd > dueDate) {
      const suggestedDue = addWorkDays(latestEnd, 5)
      const suggestedStr = suggestedDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      alerts.push({
        id: `alert-${project.id}`,
        severity: overrunDays > 10 ? 'critical' : 'warning',
        title: `${project.name} — ${overrunDays}d past due`,
        description: `Ends ~${projectedEndStr}, due ${dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. ${overrunDays} working days over.`,
        projectId: project.id,
        resolution: [
          { label: `Push due date to ${suggestedStr}`, action: 'push_due', value: toDateKey(suggestedDue) },
          { label: 'Prioritize this project', action: 'prioritize', value: 'high' },
          { label: 'Flag for client extension', action: 'flag' },
        ],
      })
    } else if (floatDays < 5) {
      alerts.push({
        id: `alert-${project.id}`,
        severity: 'warning',
        title: `${project.name} — tight (${floatDays}d float)`,
        description: `Ends ~${projectedEndStr}, due ${dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Only ${floatDays} working days of buffer.`,
        projectId: project.id,
        resolution: [
          { label: 'Accept tight schedule', action: 'accept' },
          { label: 'Prioritize this project', action: 'prioritize', value: 'high' },
        ],
      })
    }
  }

  const sevOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  alerts.sort((a, b) => (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2))

  return alerts
}


// ═══════════════════════════════════════════════════════════════════
// BUILD HEADCOUNT OVERRIDES — helper for page to call
// ═══════════════════════════════════════════════════════════════════

/**
 * Build HeadcountOverrides map from capacity_overrides + approved pto_requests.
 * Call this once in the page's loadData, pass the result to autoPlace/cascadeMove.
 *
 * @param capacityOverrides - rows from capacity_overrides table
 * @param ptoRequests - approved rows from pto_requests table
 * @param teamMembers - for mapping team_member_id → department
 * @param deptIdToKey - department UUID → lowercase key (e.g., 'assembly')
 */
export function buildHeadcountOverrides(
  capacityOverrides: { override_date: string; team_member_id: string | null; department_id: string | null; reason: string; hours_reduction: number; is_full_day: boolean }[],
  ptoRequests: { team_member_id: string; request_date: string }[],
  teamMemberDeptMap: Record<string, string>,  // team_member_id → dept_key
  deptIdToKey: Record<string, string>,         // department UUID → dept_key
): HeadcountOverrides {
  const overrides: HeadcountOverrides = {}

  for (const ov of capacityOverrides) {
    const dateKey = ov.override_date

    // Company holiday — no team member, affects all depts
    if (!ov.team_member_id && !ov.department_id && ov.is_full_day) {
      overrides[`${dateKey}::*`] = 999
      continue
    }

    // Company holiday with department_id but no team_member_id (alternate pattern)
    if (!ov.team_member_id && ov.department_id) {
      const dk = deptIdToKey[ov.department_id]
      if (dk) {
        // Equipment down or dept-level reduction — convert hours to people
        const personEquiv = Math.max(1, Math.ceil(ov.hours_reduction / 8))
        overrides[`${dateKey}::${dk}`] = (overrides[`${dateKey}::${dk}`] || 0) + personEquiv
      }
      continue
    }

    // Individual PTO / out — find their department, reduce headcount by 1
    if (ov.team_member_id && ov.is_full_day) {
      // Skip reassignments — those are handled differently (person moves depts, not removed)
      if (ov.reason?.startsWith('Reassigned to')) continue

      const deptKey = teamMemberDeptMap[ov.team_member_id]
      if (deptKey) {
        overrides[`${dateKey}::${deptKey}`] = (overrides[`${dateKey}::${deptKey}`] || 0) + 1
      }
    }
  }

  // Approved PTO requests → reduce headcount by 1 in their department
  for (const pto of ptoRequests) {
    const dateKey = pto.request_date
    const deptKey = teamMemberDeptMap[pto.team_member_id]
    if (deptKey) {
      overrides[`${dateKey}::${deptKey}`] = (overrides[`${dateKey}::${deptKey}`] || 0) + 1
    }
  }

  return overrides
}


// ═══════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════

/** Sort projects by priority then due date. */
export function sortProjects(projects: ScheduleProject[]): ScheduleProject[] {
  return [...projects].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority] ?? 1
    const pb = PRIORITY_WEIGHT[b.priority] ?? 1
    if (pa !== pb) return pa - pb
    const da = a.due || '2099-01-01'
    const db = b.due || '2099-01-01'
    return da.localeCompare(db)
  })
}

/** Group blocks by project ID. */
export function blocksByProject(blocks: PlacedBlock[]): Map<string, PlacedBlock[]> {
  const map = new Map<string, PlacedBlock[]>()
  for (const b of blocks) {
    if (!map.has(b.projectId)) map.set(b.projectId, [])
    map.get(b.projectId)!.push(b)
  }
  return map
}

/** Group blocks by subproject ID. */
export function blocksBySub(blocks: PlacedBlock[]): Map<string, PlacedBlock[]> {
  const map = new Map<string, PlacedBlock[]>()
  for (const b of blocks) {
    if (!map.has(b.subId)) map.set(b.subId, [])
    map.get(b.subId)!.push(b)
  }
  return map
}

/** Get the latest end date across all blocks for a project. */
export function projectEndDate(blocks: PlacedBlock[], projectId: string): Date | null {
  const pBlocks = blocks.filter(b => b.projectId === projectId)
  if (pBlocks.length === 0) return null
  let latest = new Date(0)
  for (const b of pBlocks) {
    const end = addWorkDays(parseDate(b.startDate), b.days)
    if (end > latest) latest = end
  }
  return latest
}

/** Check if a block overlaps a specific date. */
export function blockOverlapsDate(block: PlacedBlock, dateKey: string): boolean {
  const start = parseDate(block.startDate)
  const d = new Date(start); d.setHours(12, 0, 0, 0)
  let counted = 0
  while (counted < block.days) {
    if (isWorkDay(d)) {
      if (toDateKey(d) === dateKey) return true
      counted++
    }
    d.setDate(d.getDate() + 1)
  }
  return false
}

/** Get blocks that overlap a specific date, optionally filtered by department. */
export function blocksForDate(
  blocks: PlacedBlock[], dateKey: string, dept?: DeptKey,
): PlacedBlock[] {
  return blocks.filter(b => {
    if (dept && b.dept !== dept) return false
    return blockOverlapsDate(b, dateKey)
  })
}

/** Color palette for projects (rotates) */
export const PROJECT_COLORS = [
  '#3B82F6', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6366F1',
  '#14B8A6', '#E11D48', '#A855F7', '#0EA5E9', '#D97706',
  '#7C3AED', '#059669', '#DC2626', '#2563EB', '#CA8A04',
]