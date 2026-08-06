'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/lib/auth-context'
import {
  isInternalPlan,
  isTrialActive,
  trialDaysLeft,
  PLAN_LABELS,
  PLAN_SEAT_PRICE,
  type Plan,
} from '@/lib/feature-flags'
import { MLogo } from '@/components/logo'

// BillingGate — wraps the (app) layout so unauthenticated-or-unpaid orgs
// can't reach the dashboard.
//
// State machine, driven by orgs.plan_status (set by the stripe-webhook):
//   active    → render children. Most common path.
//   past_due  → render children + soft top banner. Stripe is retrying;
//               don't yank access during transient card failures.
//   pending   → block. They signed up but bailed on Stripe Checkout.
//               Show a "complete payment" screen with a retry CTA.
//   canceled  → block. Subscription ended. Show a "reactivate" screen.
//   incomplete→ block. Initial payment failed or 3DS pending. Treat
//               like pending — retry checkout.
//
// While org is null (still loading) we render children normally. The
// AuthProvider already redirects unauthenticated users; this component
// only deals with the paid/unpaid axis.

export default function BillingGate({ children }: { children: React.ReactNode }) {
  const { org } = useAuth()

  // Loading, internal (not a customer — there's no subscription to check),
  // or genuinely-active orgs pass through with no banner.
  if (!org || isInternalPlan(org.plan) || org.plan_status === 'active') {
    return <>{children}</>
  }

  // Active no-card trial (055) — full access + a countdown banner nudging
  // them to add billing before it ends.
  if (isTrialActive(org.plan_status, org.trial_ends_at)) {
    return (
      <>
        <TrialBanner
          daysLeft={trialDaysLeft(org.trial_ends_at)}
          plan={org.plan as Plan}
          orgId={org.id}
          seats={org.seats}
        />
        {children}
      </>
    )
  }

  // past_due is a soft banner — they can still use the app while Stripe
  // retries the card. The banner nudges them to update payment info.
  if (org.plan_status === 'past_due') {
    return (
      <>
        <PastDueBanner orgId={org.id} />
        {children}
      </>
    )
  }

  // pending / canceled / incomplete / expired-trial — full-screen gate.
  // An expired trial is plan_status='trialing' with trial_ends_at in the
  // past (isTrialActive already returned false above).
  const trialExpired = org.plan_status === 'trialing'
  return (
    <BlockingGate
      plan={org.plan as Plan}
      planStatus={org.plan_status}
      orgId={org.id}
      seats={org.seats}
      trialExpired={trialExpired}
    />
  )
}

function TrialBanner({
  daysLeft,
  plan,
  orgId,
  seats,
}: {
  daysLeft: number
  plan: Plan
  orgId: string
  seats: number
}) {
  const [loading, setLoading] = useState(false)
  async function subscribe() {
    setLoading(true)
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, plan, seats }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else setLoading(false)
    } catch {
      setLoading(false)
    }
  }
  return (
    <div className="bg-[#EFF6FF] border-b border-[#BFDBFE] px-6 py-2.5 text-sm text-[#1E3A8A] flex items-center justify-between">
      <span>
        <strong>
          {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left
        </strong>{' '}
        in your free trial. Add billing anytime to keep your shop running without
        interruption.
      </span>
      <button
        onClick={subscribe}
        disabled={loading}
        className="px-3 py-1.5 bg-[#2563EB] text-white rounded-md text-xs font-medium hover:bg-[#1D4ED8] disabled:opacity-50 whitespace-nowrap"
      >
        {loading ? 'Opening…' : 'Add billing'}
      </button>
    </div>
  )
}

function PastDueBanner({ orgId }: { orgId: string }) {
  const [loading, setLoading] = useState(false)
  async function openPortal() {
    setLoading(true)
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, return_path: '/settings' }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else setLoading(false)
    } catch {
      setLoading(false)
    }
  }
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 text-sm text-amber-900 flex items-center justify-between">
      <span>
        <strong>Payment failed.</strong> Stripe is retrying — update your card to keep your subscription active.
      </span>
      <button
        onClick={openPortal}
        disabled={loading}
        className="px-3 py-1.5 bg-amber-900 text-white rounded-md text-xs font-medium hover:bg-amber-800 disabled:opacity-50"
      >
        {loading ? 'Opening…' : 'Update payment'}
      </button>
    </div>
  )
}

function BlockingGate({
  plan,
  planStatus,
  orgId,
  seats,
  trialExpired,
}: {
  plan: Plan
  planStatus: string
  orgId: string
  seats: number
  trialExpired?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function startCheckout() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, plan, seats }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not start checkout. Try again.')
        setLoading(false)
        return
      }
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message || 'Could not start checkout.')
      setLoading(false)
    }
  }

  const planLabel = PLAN_LABELS[plan] ?? plan
  const planPrice = PLAN_SEAT_PRICE[plan] ?? 0
  const monthly = planPrice * seats

  const headline = trialExpired
    ? 'Your free trial has ended'
    : planStatus === 'canceled'
      ? 'Reactivate your subscription'
      : planStatus === 'incomplete'
        ? 'Finish setting up payment'
        : 'Complete payment to activate'

  const subline = trialExpired
    ? 'Hope you got a feel for it — your data is all saved. Add billing to pick right back up.'
    : planStatus === 'canceled'
      ? 'Your subscription ended. Pick up where you left off — your data is preserved.'
      : planStatus === 'incomplete'
        ? 'Your card was declined or needs verification. Try again to activate.'
        : 'Your account is created. One more step — enter your card to unlock MillSuite.'

  return (
    <div className="min-h-screen bg-[#0D0D0F] text-white flex flex-col">
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-md text-center">
          <div className="flex justify-center mb-6">
            <MLogo size={40} color="#D4956A" />
          </div>
          <h1 className="text-2xl font-bold mb-2">{headline}</h1>
          <p className="text-sm text-[#8B8B96] mb-8">{subline}</p>

          <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-6 text-left mb-6">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm text-[#8B8B96]">Plan</span>
              <span className="text-sm font-medium text-white">{planLabel}</span>
            </div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-sm text-[#8B8B96]">Seats</span>
              <span className="text-sm font-medium text-white font-mono">{seats}</span>
            </div>
            <div className="flex items-baseline justify-between mb-3">
              <span className="text-sm text-[#8B8B96]">Per seat</span>
              <span className="text-sm font-medium text-white font-mono">${planPrice}/mo</span>
            </div>
            <div className="border-t border-white/[0.08] pt-3 flex items-baseline justify-between">
              <span className="text-sm font-medium text-white">Monthly total</span>
              <span className="text-base font-bold text-[#D4956A] font-mono">${monthly}/mo</span>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 mb-4">
              {error}
            </div>
          )}

          <button
            onClick={startCheckout}
            disabled={loading}
            className="w-full px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors disabled:opacity-50"
          >
            {loading ? 'Opening checkout…' : `Continue to payment`}
          </button>

          <p className="text-xs text-[#555] mt-6">
            <Link href="/pricing" className="text-[#8B8B96] hover:text-[#D4956A]">
              Switch plans
            </Link>
            {' · '}
            <Link href="/cancellation-policy" className="text-[#8B8B96] hover:text-[#D4956A]">
              Cancellation policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
