'use client'

// ============================================================================
// WelcomeOverlay — first-login gate that sits on top of the app until the
// required calibrations are in.
// ============================================================================
// Per BUILD-ORDER Phase 12 item 5.
//
// Renders a full-screen, non-dismissible overlay when the current user's
// users.onboarded_at is null. Three sequential screens:
//
//   1. Welcome      — frames the two-step setup. Single CTA: Start setup.
//   2. Shop rate    — ShopRateWalkthrough (item 3)
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

import { useAuth } from '@/lib/auth-context'
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus'
import ShopRateWalkthrough from '@/components/walkthroughs/ShopRateWalkthrough'
import BaseCabinetWalkthrough from '@/components/walkthroughs/BaseCabinetWalkthrough'

export default function WelcomeOverlay() {
  const { user, org } = useAuth()
  const { loading, onboardedAt, step, advance, complete } = useOnboardingStatus()

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
            onComplete={() => advance('base_cabinet')}
            onCancel={() => advance('welcome')}
          />
        )}
        {current === 'base_cabinet' && (
          <BaseCabinetWalkthrough
            orgId={org.id}
            onComplete={() => complete()}
            onCancel={() => advance('shop_rate')}
          />
        )}
      </div>
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
      <p className="text-sm text-[#374151] leading-relaxed mb-2">
        We’re going to capture what you know, once, so your estimates match
        your shop.
      </p>
      <p className="text-sm text-[#6B7280] leading-relaxed mb-6">
        Two quick steps. Your per-department shop rate, and how long one
        8-foot run of base cabinets takes your shop. Both are editable
        anytime from Settings after setup.
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
