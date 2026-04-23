'use client'

// ============================================================================
// useOnboardingStatus — read + write the two users columns migration 019
// added for onboarding state.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 5.
//
//   users.onboarded_at    → null = WelcomeOverlay mounts
//   users.onboarding_step → resume point if the user closes the tab mid-flow
//
// API:
//   const { loading, onboardedAt, step, advance, complete } = useOnboardingStatus()
//
//   - loading      — true until the initial users fetch settles
//   - onboardedAt  — timestamp or null; null = still onboarding
//   - step         — 'welcome' | 'shop_rate' | 'base_cabinet' | null
//   - advance(s)   — write onboarding_step; returns after persist
//   - complete()   — stamp onboarded_at = NOW() + clear onboarding_step
//
// Reads from the AppUser returned by useAuth() so we don't re-hit Supabase
// for values that are already cached in the auth provider — but the auth
// provider doesn't expose onboarded_at or onboarding_step, so this hook
// does its own select. Writes go direct to the users table via supabase.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

export type OnboardingStep = 'welcome' | 'shop_rate' | 'base_cabinet'

export interface OnboardingStatus {
  loading: boolean
  onboardedAt: string | null
  step: OnboardingStep | null
  /** Persist onboarding_step. Resolves after the users row updates. */
  advance: (step: OnboardingStep) => Promise<void>
  /** Stamp onboarded_at = NOW() + clear onboarding_step. */
  complete: () => Promise<void>
}

export function useOnboardingStatus(): OnboardingStatus {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [onboardedAt, setOnboardedAt] = useState<string | null>(null)
  const [step, setStep] = useState<OnboardingStep | null>(null)

  useEffect(() => {
    if (!user?.id) {
      setLoading(true)
      return
    }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('users')
        .select('onboarded_at, onboarding_step')
        .eq('id', user.id)
        .single()
      if (cancelled) return
      const row = (data || {}) as { onboarded_at: string | null; onboarding_step: string | null }
      setOnboardedAt(row.onboarded_at ?? null)
      setStep(isOnboardingStep(row.onboarding_step) ? row.onboarding_step : null)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const advance = useCallback(
    async (next: OnboardingStep) => {
      if (!user?.id) return
      const { error } = await supabase
        .from('users')
        .update({ onboarding_step: next })
        .eq('id', user.id)
      if (error) throw error
      setStep(next)
    },
    [user?.id]
  )

  const complete = useCallback(async () => {
    if (!user?.id) return
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('users')
      .update({ onboarded_at: now, onboarding_step: null })
      .eq('id', user.id)
    if (error) throw error
    setOnboardedAt(now)
    setStep(null)
  }, [user?.id])

  return { loading, onboardedAt, step, advance, complete }
}

function isOnboardingStep(v: unknown): v is OnboardingStep {
  return v === 'welcome' || v === 'shop_rate' || v === 'base_cabinet'
}
