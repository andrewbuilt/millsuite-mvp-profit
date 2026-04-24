// lib/onboarding.ts — confidence ramp helpers.
// Everything else in this file was Phase 11 wizard state (business-card,
// past-estimate, bank-statement, dept-rate sliders) — retired April 2026
// in favor of the Phase 12 WelcomeOverlay + first-principles shop-rate
// walkthrough. The wizard helpers, stashed-baseline machinery, and
// per-dept reference rates are gone. Tables `onboarding_progress` and
// `onboarding_stashed_baselines` drop in migration 026.
//
// What's left: confidence ramp helpers called from lib/suggestions.ts
// every closed-job scan. These have no dependency on the retired wizard
// state and carry their own weight in the learning loop.

import { supabase } from './supabase'

export type ItemConfidence = 'untested' | 'few_jobs' | 'well_tested' | 'looking_weird'

/**
 * Map (jobCount, drift) to a confidence bucket.
 *   drift = |actual/estimate - 1|
 *   large drift with enough evidence → looking_weird
 */
export function deriveConfidence(jobCount: number, drift: number): ItemConfidence {
  if (drift > 0.35 && jobCount >= 3) return 'looking_weird'
  if (jobCount >= 5) return 'well_tested'
  if (jobCount >= 1) return 'few_jobs'
  return 'untested'
}

/**
 * Bump an item's confidence metadata after a closed-job scan. Increments
 * confidence_job_count, stamps confidence_last_used_at, and re-derives
 * the bucket via deriveConfidence.
 */
export async function bumpItemConfidence(args: {
  rateBookItemId: string
  jobCount: number
  drift: number
}): Promise<void> {
  const { rateBookItemId, jobCount, drift } = args
  const confidence = deriveConfidence(jobCount, drift)
  await supabase
    .from('rate_book_items')
    .update({
      confidence,
      confidence_job_count: jobCount,
      confidence_last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', rateBookItemId)
}
