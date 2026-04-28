'use client'

// ============================================================================
// WelcomeOverlay — first-login gate that sits on top of the app until the
// required calibrations are in.
// ============================================================================
// Per BUILD-ORDER Phase 12 items 5 + 12.
//
// Renders a full-screen, non-dismissible overlay when the current user's
// users.onboarded_at is null. Three sequential steps:
//
//   1. Welcome      — frames the two-step setup. Single CTA: Start setup.
//   2. Shop rate    — ShopRateWalkthrough (4 inner screens — item 12)
//   3. Base cabinet — BaseCabinetWalkthrough (item 4)
//
// Advances persist users.onboarding_step on every transition so a mid-
// flow tab close re-mounts at the same step. Completing the base-cab
// walkthrough stamps users.onboarded_at = NOW() + clears onboarding_step,
// which unmounts the overlay via the hook's state flip.
//
// Non-dismissible: no close X, no ESC handler, no backdrop click-out.
// The user can only move forward (via walkthrough Continue) or back
// within the overlay (via the walkthrough's onCancel). The app behind
// the overlay is inert until onboarding finishes.
//
// No auth / loading chrome. The hook gates on useAuth()'s user — if the
// user isn't loaded yet we render nothing, letting the route handle its
// own unauth redirect.
// ============================================================================

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus'
import { hasAccess } from '@/lib/feature-flags'
import ShopRateWalkthrough from '@/components/walkthroughs/ShopRateWalkthrough'
import BaseCabinetWalkthrough from '@/components/walkthroughs/BaseCabinetWalkthrough'

const DASHBOARD_TOAST_KEY = 'millsuite.welcomeJustCompleted'

export default function WelcomeOverlay() {
  const { user, org } = useAuth()
  const router = useRouter()
  const { loading, onboardedAt, step, advance, complete } = useOnboardingStatus()
  // Brief save-confirmation toast that appears between walkthroughs.
  // Doesn't block — auto-dismisses after 3s.
  const [toast, setToast] = useState<string | null>(null)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  // Gate: need an authenticated user + org row before we know whether to
  // show anything. And don't flash the overlay before the initial users
  // fetch settles.
  if (!user?.id || !org?.id) return null
  if (loading) return null
  if (onboardedAt) return null

  // Default the step to 'welcome' when it's null — first visit, nothing
  // persisted yet. We don't write that default; advance() fires on the
  // first Start click.
  const current = step ?? 'welcome'

  return (
    <div
      // role="dialog" + aria-modal wires screen readers. The overlay is
      // deliberately non-dismissible: no ESC handler, no click-outside.
      role="dialog"
      aria-modal="true"
      aria-label="MillSuite onboarding"
      className="fixed inset-0 z-[100] bg-[#0F172A]/85 backdrop-blur-sm flex flex-col overflow-y-auto"
    >
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        {current === 'welcome' && (
          <WelcomeScreen onStart={() => advance('shop_rate')} />
        )}
        {current === 'shop_rate' && (
          <ShopRateWalkthrough
            orgId={org.id}
            onComplete={(rate) => {
              setToast(`Shop rate saved: $${(rate || 0).toFixed(2)}/hr`)
              advance('base_cabinet')
            }}
            onCancel={() => advance('welcome')}
          />
        )}
        {current === 'base_cabinet' && (
          <BaseCabinetWalkthrough
            orgId={org.id}
            onComplete={() => {
              setToast('Base cabinet calibrated. Slab door style ready to use.')
              // Stash a one-shot flag the dashboard reads on its next mount
              // so the user gets a final completion toast there. Cleared
              // by the dashboard after rendering. (Toast still fires if
              // the user navigates back to /dashboard later.)
              if (typeof window !== 'undefined') {
                window.localStorage.setItem(DASHBOARD_TOAST_KEY, '1')
              }
              complete()
              // Land the freshly-onboarded user on /sales — that's the
              // surface that does what MillSuite actually does (intake
              // new work). /dashboard for a brand-new account is mostly
              // empty rollups; users got confused thinking the app
              // wasn't doing anything. Pro and Pro+AI plans have sales
              // gated; Starter falls back to /projects.
              const target = hasAccess(org.plan, 'sales') ? '/sales' : '/projects'
              router.push(target)
            }}
            onCancel={() => advance('shop_rate')}
          />
        )}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[110] px-4 py-2.5 bg-[#111] text-white text-sm rounded-lg shadow-lg max-w-md text-center">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Welcome screen ──

function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="max-w-[520px] mx-auto bg-white border border-[#E5E7EB] rounded-2xl p-8 shadow-xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
        Welcome
      </div>
      <h1 className="text-[26px] font-semibold text-[#111] tracking-tight leading-tight mb-4">
        You already know your craft.
      </h1>
      <p className="text-sm text-[#374151] leading-relaxed mb-3">
        Quick setup so MillSuite prices jobs at YOUR rates, not generic ones.
      </p>
      <p className="text-sm text-[#374151] leading-relaxed mb-2">
        Two steps, about 5 minutes total:
      </p>
      <ol className="list-decimal list-inside text-sm text-[#374151] leading-relaxed mb-3 space-y-1 pl-1">
        <li>
          <span className="font-semibold text-[#111]">Your shop rate</span> —
          what an hour of your shop's time actually costs.
        </li>
        <li>
          <span className="font-semibold text-[#111]">Your base cabinet labor</span> —
          how long an 8-foot run takes you.
        </li>
      </ol>
      <p className="text-[12.5px] text-[#6B7280] leading-relaxed mb-6">
        Edit either one anytime from Settings.
      </p>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onStart}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white text-sm font-semibold rounded-lg hover:bg-[#1D4ED8] transition-colors"
        >
          Start setup →
        </button>
      </div>
    </div>
  )
}
