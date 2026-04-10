// lib/reports/outlookCalculations.ts
// Utilization projection, effective rate, and target-finder for the Outlook section.
// Pure functions — no React, no Supabase.

export interface BookedProject {
  name: string
  estimatedHours: number
  startMonth: string  // e.g. "2026-03"
  endMonth: string    // e.g. "2026-06"
}

export interface MonthlyProjection {
  month: string       // e.g. "Apr"
  monthKey: string    // e.g. "2026-04"
  bookedHours: number
  availableHours: number
  utilization: number // percentage
  effectiveRate: number
}

export interface OutlookResult {
  months: MonthlyProjection[]
  avgUtil: number
  peakUtil: number
  peakMonth: string
  effRate: number
  hoursGap: number
  totalBooked: number
  totalAvailable: number
}

const HRS_PER_PERSON = 160

// ── Distribute hours evenly across project months ──

function monthsBetween(startKey: string, endKey: string): string[] {
  const months: string[] = []
  const [sy, sm] = startKey.split('-').map(Number)
  const [ey, em] = endKey.split('-').map(Number)
  let y = sy, m = sm

  while (y < ey || (y === ey && m <= em)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return months
}

export function distributeHours(projects: BookedProject[], monthKeys: string[]): Record<string, number> {
  const hoursByMonth: Record<string, number> = {}
  for (const k of monthKeys) hoursByMonth[k] = 0

  for (const p of projects) {
    const projMonths = monthsBetween(p.startMonth, p.endMonth)
    const hrsPerMonth = p.estimatedHours / projMonths.length

    for (const m of projMonths) {
      if (m in hoursByMonth) {
        hoursByMonth[m] += hrsPerMonth
      }
    }
  }

  return hoursByMonth
}

// ── Month label helper ──

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthLabel(key: string): string {
  const m = parseInt(key.split('-')[1], 10)
  return MONTH_NAMES[m - 1]
}

// ── Compute outlook projections ──

export function computeOutlook(
  projects: BookedProject[],
  crewSize: number,
  overhead: number,
  avgWage: number,
  monthKeys: string[]
): OutlookResult {
  const hoursByMonth = distributeHours(projects, monthKeys)
  const months: MonthlyProjection[] = []

  for (const key of monthKeys) {
    const booked = Math.round(hoursByMonth[key])
    const available = crewSize * HRS_PER_PERSON
    const util = available > 0 ? (booked / available) * 100 : 0

    // Effective rate: total monthly cost / billable hours
    const laborCost = crewSize * avgWage * HRS_PER_PERSON
    const totalCost = laborCost + overhead
    const billableHours = (util / 100) * crewSize * HRS_PER_PERSON
    const rate = billableHours > 0 ? totalCost / billableHours : 0

    months.push({
      month: monthLabel(key),
      monthKey: key,
      bookedHours: booked,
      availableHours: available,
      utilization: Math.round(util),
      effectiveRate: Math.round(rate),
    })
  }

  const totalBooked = months.reduce((s, m) => s + m.bookedHours, 0)
  const totalAvailable = months.reduce((s, m) => s + m.availableHours, 0)
  const avgUtil = months.length > 0 ? Math.round(months.reduce((s, m) => s + m.utilization, 0) / months.length) : 0
  const peakIdx = months.reduce((pi, m, i, arr) => m.utilization > arr[pi].utilization ? i : pi, 0)
  const peakUtil = months[peakIdx]?.utilization || 0
  const peakMonth = months[peakIdx]?.month || ''

  const validRates = months.filter(m => m.effectiveRate > 0)
  const effRate = validRates.length > 0 ? Math.round(validRates.reduce((s, m) => s + m.effectiveRate, 0) / validRates.length) : 0

  return {
    months,
    avgUtil,
    peakUtil,
    peakMonth,
    effRate,
    hoursGap: totalBooked - totalAvailable,
    totalBooked,
    totalAvailable,
  }
}

// ── Find crew size for ~80% utilization ──

export function find80Target(
  projects: BookedProject[],
  overhead: number,
  avgWage: number,
  monthKeys: string[]
): number | null {
  for (let hc = 6; hc <= 30; hc++) {
    const result = computeOutlook(projects, hc, overhead, avgWage, monthKeys)
    if (result.avgUtil >= 75 && result.avgUtil <= 85) return hc
  }
  return null
}

// ── Alert logic ──

export type AlertLevel = 'danger' | 'warning' | 'good' | null

export interface AlertInfo {
  level: AlertLevel
  message: string
}

export function computeAlert(outlook: OutlookResult, crewSize: number): AlertInfo {
  if (outlook.peakUtil > 100) {
    return {
      level: 'danger',
      message: `You'll exceed capacity in ${outlook.peakMonth} at ${crewSize} people. Either push timelines, hire, or sub out work.`,
    }
  }
  if (outlook.avgUtil < 45) {
    const neededPeople = Math.ceil(outlook.totalBooked / (HRS_PER_PERSON * outlook.months.length))
    return {
      level: 'danger',
      message: `Average utilization is ${outlook.avgUtil}%. You're paying for ${crewSize} people but only have work for roughly ${neededPeople}.`,
    }
  }
  if (outlook.avgUtil < 65) {
    return {
      level: 'warning',
      message: `Utilization averaging ${outlook.avgUtil}%. You need more booked work or fewer people to protect your rate.`,
    }
  }
  if (outlook.avgUtil >= 75 && outlook.peakUtil <= 100) {
    return {
      level: 'good',
      message: `Capacity looks balanced at ${crewSize} people for the booked work ahead.`,
    }
  }
  return { level: null, message: '' }
}

// ── Generate next 6 month keys from current date ──

export function getNextMonthKeys(count: number = 6): string[] {
  const now = new Date()
  const keys: string[] = []
  let y = now.getFullYear()
  let m = now.getMonth() + 1 // 1-indexed

  for (let i = 0; i < count; i++) {
    keys.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return keys
}
