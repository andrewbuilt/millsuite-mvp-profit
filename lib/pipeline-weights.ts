// ============================================================================
// lib/pipeline-weights.ts — probability weights for pipeline overlay
// ============================================================================
// Pipeline projects (new_lead / fifty_fifty / ninety_percent) on the
// capacity calendar contribute weighted hours rather than full hours so
// the operator sees "what'll happen if these prospects close."
// Sold-and-beyond runs at 100%; lost runs at 0%.
//
// Single source of truth for weights — anywhere we render or compute
// pipeline-aware numbers should read from here, not hardcode percents
// inline.
// ============================================================================

import type { ProjectStage } from './types'

/** Probability weight applied to each stage. Sold-onward is unweighted
 *  (1.0); lost contributes nothing (0.0); pipeline scales by close
 *  probability. */
export const STAGE_WEIGHT: Record<ProjectStage, number> = {
  new_lead: 0.25,
  fifty_fifty: 0.5,
  ninety_percent: 0.9,
  sold: 1.0,
  production: 1.0,
  installed: 1.0,
  complete: 1.0,
  lost: 0.0,
}

export function isPipelineStage(stage: ProjectStage | string): boolean {
  return (
    stage === 'new_lead' ||
    stage === 'fifty_fifty' ||
    stage === 'ninety_percent'
  )
}

/** Display percent for a pipeline pill. Returns null for non-pipeline
 *  stages so the caller can hide the badge entirely. */
export function pipelinePercent(stage: ProjectStage | string): number | null {
  if (!isPipelineStage(stage)) return null
  const w = STAGE_WEIGHT[stage as ProjectStage] ?? 0
  return Math.round(w * 100)
}
