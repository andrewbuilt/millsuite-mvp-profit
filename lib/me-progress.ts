'use client'

// ============================================================================
// lib/me-progress.ts — browser client for /api/me/progress
// ============================================================================
// The one way to write your own onboarding / walkthrough state. It goes through
// an API route rather than supabase.from('users').update() because `users` has
// RLS with no UPDATE policy: a direct write matches zero rows and reports
// success. See the header of app/api/me/progress/route.ts for the full story.
//
// Reads still go direct — users_select_self covers them.
// ============================================================================

import { supabase } from '@/lib/supabase'
import type { TourId } from '@/lib/walkthroughs'

/** Everything that lives in users.walkthrough_state: the tours, plus the
 *  dashboard setup checklist, which is the same kind of per-user onboarding
 *  state and doesn't earn a column of its own. */
export type StateKey = TourId | 'setup-checklist'

export interface TourProgress {
  step?: number
  offered_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  dismissed_at?: string | null
  /** Setup checklist only — the invoicing-mode item has no observable "done"
   *  signal, because 'internal' is both a real choice and the default. */
  acked_invoicing_at?: string | null
}

export type WalkthroughState = Partial<Record<StateKey, TourProgress>>

export interface MyProgress {
  onboarded_at: string | null
  onboarding_step: string | null
  walkthrough_state: WalkthroughState
}

async function authedFetch(body: unknown): Promise<MyProgress> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const res = await fetch('/api/me/progress', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}))
    throw new Error((msg as { error?: string }).error || `Save failed (${res.status})`)
  }
  return (await res.json()) as MyProgress
}

export function saveOnboardingStep(step: string) {
  return authedFetch({ action: 'onboarding_step', step })
}

export function completeOnboarding() {
  return authedFetch({ action: 'onboarding_complete' })
}

export function saveTourProgress(tourId: StateKey, patch: TourProgress) {
  return authedFetch({ action: 'tour', tourId, patch })
}

export function resetTourProgress(tourId: StateKey) {
  return authedFetch({ action: 'tour_reset', tourId })
}

/** Read the caller's own row. Direct select — users_select_self allows it, and
 *  it saves a round trip through the API on every page load.
 *
 *  Two-step on purpose: before migration 088 runs, asking for
 *  `walkthrough_state` doesn't return null, it fails the WHOLE select with
 *  "column does not exist" — which would take `onboarded_at` down with it and
 *  pop the setup wizard at an owner who'd already finished it. So the
 *  onboarding columns are read on their own, and the tour column is a separate
 *  best-effort read that degrades to "no tours started". */
export async function loadMyProgress(userId: string): Promise<MyProgress> {
  const { data } = await supabase
    .from('users')
    .select('onboarded_at, onboarding_step')
    .eq('id', userId)
    .single()
  const row = (data || {}) as Partial<MyProgress>

  const { data: wt } = await supabase
    .from('users')
    .select('walkthrough_state')
    .eq('id', userId)
    .single()

  return {
    onboarded_at: row.onboarded_at ?? null,
    onboarding_step: row.onboarding_step ?? null,
    walkthrough_state: ((wt as { walkthrough_state?: WalkthroughState } | null)?.walkthrough_state) ?? {},
  }
}
