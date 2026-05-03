'use client'

import { useState } from 'react'
import { useAuth } from '@/lib/auth-context'
import { PLAN_LABELS, PLAN_SEAT_PRICE } from '@/lib/feature-flags'

// BillingSection — the Subscription card on the Settings page. Shows
// plan / seats / next billing date / status, and exposes the Stripe
// Customer Portal for self-serve cancellation, payment-method updates,
// and invoice downloads.
//
// Customers with no Stripe subscription yet (e.g. the two beta orgs that
// were created before billing existed and got plan_status='active' as
// the migration default) see a "Set up billing" CTA that routes to
// /api/checkout. Customers with a stripe_customer_id see "Manage
// subscription" → opens the Customer Portal.

export default function BillingSection() {
  const { org } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!org) return null

  const planLabel = PLAN_LABELS[org.plan as keyof typeof PLAN_LABELS] ?? org.plan
  const planPrice = PLAN_SEAT_PRICE[org.plan as keyof typeof PLAN_SEAT_PRICE] ?? 0
  const monthly = planPrice * org.seats
  const nextBilling = org.current_period_end
    ? new Date(org.current_period_end).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : null

  const statusLabel: Record<string, { label: string; tone: string }> = {
    active: { label: 'Active', tone: 'bg-green-50 border-green-200 text-green-700' },
    pending: { label: 'Awaiting payment', tone: 'bg-amber-50 border-amber-200 text-amber-800' },
    past_due: { label: 'Past due', tone: 'bg-red-50 border-red-200 text-red-700' },
    canceled: { label: 'Canceled', tone: 'bg-gray-100 border-gray-200 text-gray-600' },
    incomplete: { label: 'Incomplete', tone: 'bg-amber-50 border-amber-200 text-amber-800' },
  }
  const status = statusLabel[org.plan_status] ?? {
    label: org.plan_status,
    tone: 'bg-gray-100 border-gray-200 text-gray-600',
  }

  async function openPortal() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org!.id, return_path: '/settings' }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not open portal.')
        setLoading(false)
        return
      }
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message || 'Could not open portal.')
      setLoading(false)
    }
  }

  async function startCheckout() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: org!.id, plan: org!.plan, seats: org!.seats }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error || 'Could not start checkout.')
        setLoading(false)
        return
      }
      window.location.href = data.url
    } catch (err: any) {
      setError(err.message || 'Could not start checkout.')
      setLoading(false)
    }
  }

  // Three button states:
  //   - has stripe_customer_id → "Manage subscription" (Customer Portal)
  //   - active but no Stripe customer → "Set up billing" (start checkout)
  //   - everything else (pending, canceled, etc.) → "Complete payment"
  const hasStripe = !!org.stripe_customer_id
  const action = hasStripe
    ? { label: 'Manage subscription', onClick: openPortal }
    : org.plan_status === 'active'
      ? { label: 'Set up billing', onClick: startCheckout }
      : { label: 'Complete payment', onClick: startCheckout }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden mb-6">
      <div className="px-6 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-base font-semibold">Subscription</h2>
        <p className="text-xs text-[#9CA3AF] mt-0.5">
          Your plan, billing, and payment details.
        </p>
      </div>
      <div className="px-6 py-4 space-y-3">
        <Row label="Plan">
          <span className="text-sm font-medium text-[#111]">{planLabel}</span>
        </Row>
        <Row label="Seats" border>
          <span className="text-sm font-mono tabular-nums text-[#111]">{org.seats}</span>
        </Row>
        <Row label="Per seat" border>
          <span className="text-sm font-mono tabular-nums text-[#111]">${planPrice}/mo</span>
        </Row>
        <Row label="Monthly total" border>
          <span className="text-sm font-mono tabular-nums font-semibold text-[#111]">
            ${monthly}/mo
          </span>
        </Row>
        <Row label="Status" border>
          <span className={`text-xs px-2 py-1 rounded-md border font-medium ${status.tone}`}>
            {status.label}
          </span>
        </Row>
        {nextBilling && (
          <Row label={org.cancel_at_period_end ? 'Access ends' : 'Next billing date'} border>
            <span className="text-sm text-[#111]">{nextBilling}</span>
          </Row>
        )}
        {org.cancel_at_period_end && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 mt-2">
            Your subscription is set to cancel at the end of the current billing period.
            You'll keep access until then.
          </div>
        )}

        {error && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-[#F3F4F6]">
          <a
            href="/cancellation-policy"
            className="text-xs text-[#9CA3AF] hover:text-[#2563EB]"
          >
            Cancellation policy
          </a>
          <button
            onClick={action.onClick}
            disabled={loading}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {loading ? 'Opening…' : action.label}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({
  label,
  border,
  children,
}: {
  label: string
  border?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex items-center justify-between py-2 ${
        border ? 'border-t border-[#F3F4F6]' : ''
      }`}
    >
      <span className="text-sm text-[#6B7280]">{label}</span>
      {children}
    </div>
  )
}
