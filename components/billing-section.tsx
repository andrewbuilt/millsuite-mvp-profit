'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/lib/auth-context'
import { supabase } from '@/lib/supabase'
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
  const [usedSeats, setUsedSeats] = useState<number | null>(null)

  // Count active users in the org. Used to show "X of Y seats used"
  // and to surface "add seats" CTA when the org is at its limit.
  // PR #115 — seat enforcement runs server-side at /api/auth/join, this
  // is just the customer-facing display.
  useEffect(() => {
    if (!org?.id) return
    let cancelled = false
    ;(async () => {
      const { count } = await supabase
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', org.id)
      if (!cancelled) setUsedSeats(count ?? 0)
    })()
    return () => {
      cancelled = true
    }
  }, [org?.id])

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
          <div className="text-right">
            <div className="text-sm font-mono tabular-nums text-[#111]">
              {usedSeats !== null ? (
                <>
                  <span className={usedSeats >= org.seats ? 'text-amber-700 font-semibold' : ''}>
                    {usedSeats}
                  </span>
                  <span className="text-[#9CA3AF]"> of {org.seats} used</span>
                </>
              ) : (
                <span className="text-[#9CA3AF]">{org.seats} total</span>
              )}
            </div>
            {/* Visual usage bar — fills as seats fill, turns amber at
                limit. Only show once we've loaded the count. */}
            {usedSeats !== null && (
              <div className="mt-1.5 h-1 w-32 bg-[#F3F4F6] rounded-full overflow-hidden ml-auto">
                <div
                  className={`h-full transition-all ${
                    usedSeats >= org.seats
                      ? 'bg-amber-500'
                      : usedSeats >= org.seats * 0.8
                        ? 'bg-amber-400'
                        : 'bg-[#2563EB]'
                  }`}
                  style={{ width: `${Math.min(100, (usedSeats / Math.max(1, org.seats)) * 100)}%` }}
                />
              </div>
            )}
            {usedSeats !== null && usedSeats >= org.seats && (
              <div className="text-[11px] text-amber-700 mt-1">
                At seat limit — add more to invite team members.
              </div>
            )}
          </div>
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

        {/* Seat-downgrade gap (L1): you lowered seats in Stripe below your
            active user count, so billing dropped but everyone keeps access.
            Surface it so the owner can finish the downgrade. */}
        {org.pending_seat_downgrade != null &&
          usedSeats !== null &&
          usedSeats > org.pending_seat_downgrade && (
            <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 mt-2">
              You reduced your subscription to{' '}
              <span className="font-semibold">{org.pending_seat_downgrade} seats</span>, but
              your team has <span className="font-semibold">{usedSeats} users</span>. Everyone
              still has access, but you're only being billed for{' '}
              {org.pending_seat_downgrade}. Remove{' '}
              <span className="font-semibold">{usedSeats - org.pending_seat_downgrade}</span> from
              the Team page to finish the downgrade.
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
