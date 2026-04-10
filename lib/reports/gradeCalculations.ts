// lib/reports/gradeCalculations.ts
// Grade scoring, cap logic, and letter assignment for the reports page.
// Pure functions — no React, no Supabase.

// ── Grade Scale ──
// A: 90-100  B: 75-89  C: 60-74  D: 40-59  F: 0-39

export interface GradeColors {
  letter: string
  bg: string
  text: string
  fill: string
}

const GRADE_THRESHOLDS = [
  { min: 90, grade: 'A' },
  { min: 75, grade: 'B' },
  { min: 60, grade: 'C' },
  { min: 40, grade: 'D' },
  { min: 0, grade: 'F' },
] as const

export function getGrade(score: number): string {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t.grade
  }
  return 'F'
}

export function getGradeColors(grade: string): GradeColors {
  switch (grade) {
    case 'A': return { letter: grade, bg: '#EAF3DE', text: '#3B6D11', fill: '#059669' }
    case 'B': return { letter: grade, bg: '#E6F1FB', text: '#185FA5', fill: '#2563EB' }
    case 'C': return { letter: grade, bg: '#FAEEDA', text: '#854F0B', fill: '#D97706' }
    case 'D': return { letter: grade, bg: '#FAECE7', text: '#993C1D', fill: '#D85A30' }
    default:  return { letter: 'F', bg: '#FCEBEB', text: '#A32D2D', fill: '#DC2626' }
  }
}

// Grade ordering for the cap rule
const GRADE_ORDER = ['F', 'D', 'C', 'B', 'A'] as const

function gradeMin(a: string, b: string): string {
  const ai = GRADE_ORDER.indexOf(a as any)
  const bi = GRADE_ORDER.indexOf(b as any)
  return ai <= bi ? a : b
}

// ── Completed Project Type ──

export interface CompletedProject {
  id: string
  name: string
  completionDate: string
  estimatedHours: number
  actualHours: number
  revenue: number
  profit: number
  marginPct: number
}

// ── Estimating Accuracy ──

export interface EstimatingAccuracy {
  score: number        // 0-100, maps to grade
  grade: string
  hitCount: number     // projects within 5%
  totalCount: number
  avgVariancePct: number  // avg % over/under on hours
  colors: GradeColors
}

export function computeEstimatingAccuracy(projects: CompletedProject[]): EstimatingAccuracy {
  if (projects.length === 0) {
    return { score: 0, grade: 'F', hitCount: 0, totalCount: 0, avgVariancePct: 0, colors: getGradeColors('F') }
  }

  let hitCount = 0
  let totalVariance = 0

  for (const p of projects) {
    const variance = Math.abs(p.actualHours - p.estimatedHours) / p.estimatedHours
    if (variance <= 0.05) hitCount++
    totalVariance += (p.actualHours - p.estimatedHours) / p.estimatedHours
  }

  const hitRate = hitCount / projects.length
  const score = hitRate * 100
  const grade = getGrade(score)
  const avgVariancePct = Math.round((totalVariance / projects.length) * 1000) / 10

  return { score, grade, hitCount, totalCount: projects.length, avgVariancePct, colors: getGradeColors(grade) }
}

// ── Crew Utilization ──

export interface CrewUtilization {
  rawScore: number
  rawGrade: string
  cappedGrade: string
  isCapped: boolean
  utilizationPct: number
  colors: GradeColors
  rawColors: GradeColors
}

function mapUtilToScore(util: number): number {
  // 80%+ = A range (90-100), 65-79% = B (75-89), 50-64% = C (60-74), 35-49% = D (40-59), <35% = F
  if (util >= 80) return Math.min(100, 90 + (util - 80) * 0.5)
  if (util >= 65) return 75 + ((util - 65) / 15) * 14
  if (util >= 50) return 60 + ((util - 50) / 15) * 14
  if (util >= 35) return 40 + ((util - 35) / 15) * 19
  return Math.max(0, (util / 35) * 39)
}

export function computeCrewUtilization(
  utilizationPct: number,
  estAccuracyGrade: string
): CrewUtilization {
  const rawScore = mapUtilToScore(utilizationPct)
  const rawGrade = getGrade(rawScore)
  const cappedGrade = gradeMin(rawGrade, estAccuracyGrade)
  const isCapped = cappedGrade !== rawGrade

  return {
    rawScore,
    rawGrade,
    cappedGrade,
    isCapped,
    utilizationPct,
    colors: getGradeColors(cappedGrade),
    rawColors: getGradeColors(rawGrade),
  }
}

// ── Shop Grade (Overall) ──

export interface ShopGradeResult {
  grade: string
  colors: GradeColors
  estimating: EstimatingAccuracy
  utilization: CrewUtilization
}

export function computeShopGradeV2(
  projects: CompletedProject[],
  utilizationPct: number
): ShopGradeResult {
  const estimating = computeEstimatingAccuracy(projects)
  const utilization = computeCrewUtilization(utilizationPct, estimating.grade)

  // Overall grade = the lower of the two (which is always estimating since util is capped by it)
  const grade = estimating.grade

  return {
    grade,
    colors: getGradeColors(grade),
    estimating,
    utilization,
  }
}

// ── Margin helpers ──

export function marginBarColor(marginPct: number, target: number): string {
  if (marginPct >= target) return '#059669'       // green — at or above target
  if (marginPct >= target - 5) return '#D97706'   // amber — within 5% below
  return '#DC2626'                                 // red — more than 5% below
}
