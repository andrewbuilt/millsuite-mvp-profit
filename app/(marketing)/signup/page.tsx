'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { MLogo } from '@/components/logo'
import {
  PLAN_LABELS,
  PLAN_SEAT_PRICE,
  PLAN_SEAT_MINIMUM,
  validatePlan,
  type Plan,
} from '@/lib/feature-flags'

export default function SignupPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // Plan picked on /pricing — read from ?plan= on mount via the
  // browser-side URL so we don't need a Suspense boundary around
  // useSearchParams. validatePlan returns null on anything outside
  // the live PLANS list (incl. legacy 'trial'); 'starter' is the
  // documented fallback.
  const [plan, setPlan] = useState<Plan>('starter')
  // Seats — initialized to the tier minimum on mount, customer can
  // bump it via the +/- stepper. Stripe Checkout has its own
  // adjustable_quantity stepper too (PR #113-followup), so a customer
  // can change seats either here or on the Stripe side; either way
  // the webhook reads the actual subscription quantity from Stripe
  // and writes it to org.seats — this state is just for the live
  // price preview on the signup form.
  const [seats, setSeats] = useState<number>(PLAN_SEAT_MINIMUM.starter)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const param = new URLSearchParams(window.location.search).get('plan')
    const v = validatePlan(param)
    if (v) {
      setPlan(v)
      setSeats(PLAN_SEAT_MINIMUM[v])
    }
  }, [])

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password || !shopName.trim()) {
      setError('All fields are required')
      return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setError('')
    setLoading(true)

    try {
      // 1. Create Supabase auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      })

      if (authError) throw authError
      if (!authData.user) throw new Error('Signup failed')

      // 2. Create org + user via API (uses service role key + an atomic
      // SQL function). The route now derives the user identity from the
      // access token (L4), so ship the session token; shop_name / plan /
      // seats are the only body fields. The org lands in
      // plan_status='pending' — access only after Stripe confirms payment.
      const accessToken = authData.session?.access_token
      if (!accessToken) {
        throw new Error(
          'Signup session not established. Please confirm your email or try signing in.',
        )
      }
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          shop_name: shopName.trim(),
          plan,
          seats,
        }),
      })

      const setup = await res.json()
      if (!res.ok) throw new Error(setup.error || 'Failed to create account')

      // 3a. Base-tier trial (055): no card required. The org is already
      // 'trialing' with access for 30 days, so skip Stripe Checkout and go
      // straight into the app. They convert later from Settings → Billing.
      if (setup.trial) {
        window.location.href = '/dashboard?welcome=true'
        return
      }

      // 3b. Paid tiers — hand off to Stripe Checkout. On success, Stripe
      // redirects to /dashboard?welcome=true; the webhook will have flipped
      // plan_status to 'active' by then. On cancel → /settings?canceled=1,
      // where they hit the BillingGate since plan_status is still 'pending'.
      const checkoutRes = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: setup.org_id,
          plan: setup.plan ?? plan,
          seats: setup.seats,
        }),
      })

      const checkout = await checkoutRes.json()
      if (!checkoutRes.ok || !checkout.url) {
        // Account was created but checkout failed — send them to
        // settings so they can retry. They'll hit the BillingGate's
        // "Complete payment" screen because plan_status='pending'.
        console.error('Checkout failed after signup:', checkout)
        router.push('/settings?error=checkout-failed')
        return
      }

      // Full-page navigation to the Stripe-hosted Checkout page.
      window.location.href = checkout.url
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const planLabel = PLAN_LABELS[plan]
  const planPrice = PLAN_SEAT_PRICE[plan]
  const minSeats = PLAN_SEAT_MINIMUM[plan]
  const monthlyTotal = planPrice * seats

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06]" style={{ background: 'rgba(13,13,15,0.8)', backdropFilter: 'blur(20px)' }}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white"><MLogo size={22} color="white" /> MillSuite</Link>
          <Link href="/login" className="text-sm text-[#8B8B96] hover:text-white transition-colors">Log in</Link>
        </div>
      </nav>

      <div className="min-h-screen flex items-center justify-center px-6 pt-16">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">Create your account</h1>
            <p className="text-sm text-[#8B8B96]">
              Signing up for{' '}
              <span className="text-[#D4956A] font-semibold">{planLabel}</span>
              {' · '}
              <span className="font-mono">${planPrice}/seat/mo</span>
            </p>
            {plan === 'starter' && (
              <p className="text-xs text-[#7FB88A] mt-1.5 font-medium">
                30-day free trial · no credit card required
              </p>
            )}
            <p className="text-xs text-[#555] mt-1">
              Not the right tier?{' '}
              <Link href="/pricing" className="text-[#D4956A] hover:text-[#C4855A]">
                See pricing →
              </Link>
            </p>
          </div>

          <form onSubmit={handleSignup} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">Shop Name</label>
              <input
                type="text"
                value={shopName}
                onChange={e => setShopName(e.target.value)}
                placeholder="e.g. Watson Woodworks"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-[#555] outline-none focus:border-[#D4956A]/50 focus:ring-1 focus:ring-[#D4956A]/20 transition-colors"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@yourshop.com"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-[#555] outline-none focus:border-[#D4956A]/50 focus:ring-1 focus:ring-[#D4956A]/20 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full px-4 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl text-sm text-white placeholder:text-[#555] outline-none focus:border-[#D4956A]/50 focus:ring-1 focus:ring-[#D4956A]/20 transition-colors"
              />
            </div>

            {/* Seat picker — defaults to PLAN_SEAT_MINIMUM, customer can
                bump it. Live total updates as seats change. Customer can
                ALSO change quantity on Stripe Checkout via the
                adjustable_quantity stepper there; webhook reads the
                actual subscription quantity from Stripe so either path
                ends up at the right number. */}
            <div>
              <label className="block text-xs font-medium text-[#8B8B96] mb-1.5">
                Seats <span className="text-[#555] font-normal">(min {minSeats})</span>
              </label>
              <div className="flex items-center gap-3 px-3 py-3 bg-white/[0.05] border border-white/[0.1] rounded-xl">
                <button
                  type="button"
                  onClick={() => setSeats(s => Math.max(minSeats, s - 1))}
                  disabled={seats <= minSeats}
                  aria-label="Remove seat"
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.1] text-white text-lg leading-none hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  −
                </button>
                <span className="text-xl font-mono tabular-nums font-semibold text-white w-10 text-center">
                  {seats}
                </span>
                <button
                  type="button"
                  onClick={() => setSeats(s => Math.min(100, s + 1))}
                  disabled={seats >= 100}
                  aria-label="Add seat"
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-white/[0.05] border border-white/[0.1] text-white text-lg leading-none hover:bg-white/[0.1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  +
                </button>
                <div className="flex-1 text-right">
                  <div className="text-[10px] text-[#8B8B96] uppercase tracking-wider">Monthly</div>
                  <div className="text-base font-mono tabular-nums font-semibold text-[#D4956A]">
                    ${monthlyTotal.toLocaleString()}/mo
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-[#555] mt-1.5">
                You can change seat count anytime from Settings → Subscription.
              </p>
            </div>

            {error && (
              <div className="px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full px-6 py-3 bg-[#D4956A] text-white font-medium rounded-xl hover:bg-[#C4855A] transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account...' : `Create ${planLabel} account`}
            </button>
          </form>

          <p className="text-center text-xs text-[#555] mt-6">
            Already have an account? <Link href="/login" className="text-[#D4956A] hover:text-[#C4855A]">Log in</Link>
          </p>
        </div>
      </div>
    </>
  )
}
