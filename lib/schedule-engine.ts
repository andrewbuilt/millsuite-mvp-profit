// lib/schedule-engine.ts
// Production schedule engine — simplified for MVP
// Pure functions, no React, no Supabase.
//
// Core concept: projects flow through departments in order.
// Each department allocation has a start date and duration (working days).
// Blocks are placed on the timeline and can be dragged to reschedule.

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

export interface ScheduleBlock {
  allocationId: string
  projectId: string
  projectName: string
  projectColor: string
  subprojectId: string
  subprojectName: string
  departmentId: string
  departmentName: string
  departmentColor: string
  startDate: string          // YYYY-MM-DD
  days: number               // working days
  hours: number              // estimated hours
  actualHours: number
  completed: boolean
  progress: number           // 0-100
}

export interface DayCapacity {
  date: string               // YYYY-MM-DD
  departments: Record<string, {
    available: number        // hours available
    allocated: number        // hours allocated
    utilization: number      // 0-1
  }>
  totalAvailable: number
  totalAllocated: number
}

// ═══════════════════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════════════════

export function toDateKey(d: Date): string {
  return d.toISOString().split('T')[0]
}

export function parseDate(s: string): Date {
  const d = new Date(s + 'T12:00:00')
  return d
}

export function isWorkDay(d: Date): boolean {
  const day = d.getDay()
  return day >= 1 && day <= 4 // Mon-Thu (millwork standard)
}

export function getMonday(d: Date): Date {
  const result = new Date(d)
  result.setHours(12, 0, 0, 0)
  const day = result.getDay()
  const diff = day === 0 ? -6 : 1 - day
  result.setDate(result.getDate() + diff)
  return result
}

export function addWorkDays(start: Date, days: number): Date {
  const result = new Date(start)
  result.setHours(12, 0, 0, 0)
  let added = 0
  while (added < days) {
    result.setDate(result.getDate() + 1)
    if (isWorkDay(result)) added++
  }
  return result
}

export function getWorkDaysBetween(start: Date, end: Date): number {
  let count = 0
  const d = new Date(start)
  d.setHours(12, 0, 0, 0)
  while (d < end) {
    if (isWorkDay(d)) count++
    d.setDate(d.getDate() + 1)
  }
  return count
}

export function generateWorkDays(start: Date, count: number): Date[] {
  const days: Date[] = []
  const d = new Date(start)
  d.setHours(12, 0, 0, 0)
  let added = 0
  // Start from start date, go forward
  while (added < count) {
    if (isWorkDay(d)) {
      days.push(new Date(d))
      added++
    }
    d.setDate(d.getDate() + 1)
  }
  return days
}

export function getWeekLabel(d: Date): string {
  const mon = getMonday(d)
  return `${mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

// ═══════════════════════════════════════════════════════════════════
// BLOCK BUILDER
// ═══════════════════════════════════════════════════════════════════

interface BuildBlocksInput {
  allocations: {
    id: string
    subproject_id: string
    department_id: string
    estimated_hours: number
    actual_hours: number
    scheduled_date: string | null
    scheduled_days: number | null
    completed: boolean
  }[]
  subprojects: { id: string; name: string; project_id: string }[]
  projects: { id: string; name: string; client_name: string | null }[]
  departments: { id: string; name: string; color: string; hours_per_day: number }[]
}

const PROJECT_COLORS = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444',
  '#06B6D4', '#EC4899', '#6366F1', '#14B8A6', '#F97316',
]

export function buildBlocks(input: BuildBlocksInput): ScheduleBlock[] {
  const { allocations, subprojects, projects, departments } = input
  const blocks: ScheduleBlock[] = []

  // Assign colors to projects
  const projectColorMap = new Map<string, string>()
  projects.forEach((p, i) => projectColorMap.set(p.id, PROJECT_COLORS[i % PROJECT_COLORS.length]))

  for (const alloc of allocations) {
    if (!alloc.scheduled_date) continue

    const sub = subprojects.find(s => s.id === alloc.subproject_id)
    if (!sub) continue
    const proj = projects.find(p => p.id === sub.project_id)
    if (!proj) continue
    const dept = departments.find(d => d.id === alloc.department_id)
    if (!dept) continue

    const hoursPerDay = dept.hours_per_day || 8
    const days = alloc.scheduled_days || Math.ceil(alloc.estimated_hours / hoursPerDay)
    const progress = alloc.estimated_hours > 0
      ? Math.min(Math.round((alloc.actual_hours / alloc.estimated_hours) * 100), 100)
      : 0

    blocks.push({
      allocationId: alloc.id,
      projectId: proj.id,
      projectName: proj.name,
      projectColor: projectColorMap.get(proj.id) || '#6B7280',
      subprojectId: sub.id,
      subprojectName: sub.name,
      departmentId: dept.id,
      departmentName: dept.name,
      departmentColor: dept.color,
      startDate: alloc.scheduled_date,
      days,
      hours: alloc.estimated_hours,
      actualHours: alloc.actual_hours,
      completed: alloc.completed,
      progress,
    })
  }

  return blocks
}

// ═══════════════════════════════════════════════════════════════════
// CAPACITY CALCULATOR
// ═══════════════════════════════════════════════════════════════════

export function calculateDayCapacity(
  date: string,
  blocks: ScheduleBlock[],
  departments: { id: string; hours_per_day: number }[],
  memberCountByDept: Record<string, number>,
): DayCapacity {
  const depts: DayCapacity['departments'] = {}
  let totalAvailable = 0
  let totalAllocated = 0

  for (const dept of departments) {
    const memberCount = memberCountByDept[dept.id] || 0
    const available = memberCount * dept.hours_per_day

    // Sum hours allocated on this date for this department
    const dateObj = parseDate(date)
    let allocated = 0
    for (const block of blocks) {
      if (block.departmentId !== dept.id) continue
      const blockStart = parseDate(block.startDate)
      const blockEnd = addWorkDays(blockStart, block.days)
      if (dateObj >= blockStart && dateObj < blockEnd) {
        // This block covers this date — allocate proportional hours
        allocated += block.hours / Math.max(block.days, 1)
      }
    }

    const utilization = available > 0 ? allocated / available : 0
    depts[dept.id] = { available, allocated, utilization }
    totalAvailable += available
    totalAllocated += allocated
  }

  return { date, departments: depts, totalAvailable, totalAllocated }
}
