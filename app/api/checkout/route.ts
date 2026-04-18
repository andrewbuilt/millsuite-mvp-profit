import { NextRequest, NextResponse } from 'next/server'

// Stripe Checkout session — redirects user to Stripe hosted payment page
// After payment, Stripe webhook creates/updates org + user in Supabase.
//
// Query params:
//   ?plan=starter|pro|pro-ai   (default: starter)
//   ?seats=N                   (default: 1; min enforced per tier)
//
// Required env vars (per-tier, with legacy fallback):
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_STARTER       // per-seat recurring price ID
//   STRIPE_PRICE_PRO
//   STRIPE_PRICE_PRO_AI
//   STRIPE_PRICE_ID            // fallback if the per-tier price isn't set

const PLAN_PRICE_ENV: Record<string, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  pro: 'STRIPE_PRICE_PRO',
  'pro-ai': 'STRIPE_PRICE_PRO_AI',
}

const PLAN_SEAT_MIN: Record<string, number> = {
  starter: 1,
  pro: 3,
  'pro-ai': 5,
}

export async function GET(req: NextRequest) {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY

  if (!STRIPE_SECRET_KEY) {
    // No Stripe key configured — send the user to pricing (which has waitlist forms)
    return NextResponse.redirect(new URL('/pricing', req.url))
  }

  const url = new URL(req.url)
  const plan = (url.searchParams.get('plan') || 'starter').toLowerCase()
  const requestedSeats = parseInt(url.searchParams.get('seats') || '1', 10) || 1
  const minSeats = PLAN_SEAT_MIN[plan] ?? 1
  const quantity = Math.max(requestedSeats, minSeats)

  // Resolve the price ID — per-tier env first, fall back to legacy single price
  const envKey = PLAN_PRICE_ENV[plan]
  const priceId =
    (envKey && process.env[envKey]) ||
    process.env.STRIPE_PRICE_ID ||
    ''

  if (!priceId) {
    return NextResponse.redirect(
      new URL(`/settings?error=no-price-configured&plan=${plan}`, req.url)
    )
  }

  try {
    const body = new URLSearchParams({
      'mode': 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': String(quantity),
      'subscription_data[trial_period_days]': '14',
      'subscription_data[metadata][plan]': plan,
      'subscription_data[metadata][seats]': String(quantity),
      'metadata[plan]': plan,
      'metadata[seats]': String(quantity),
      'success_url': `${req.nextUrl.origin}/dashboard?welcome=true`,
      'cancel_url': `${req.nextUrl.origin}/settings`,
      'allow_promotion_codes': 'true',
    })

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    })

    const session = await response.json()

    if (session.url) {
      return NextResponse.redirect(session.url)
    }

    console.error('Stripe session error:', session)
    return NextResponse.redirect(new URL('/settings?error=checkout', req.url))
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.redirect(new URL('/settings?error=checkout', req.url))
  }
}
