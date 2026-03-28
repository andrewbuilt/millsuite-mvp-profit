import { NextRequest, NextResponse } from 'next/server'

// Stripe Checkout session — redirects user to Stripe hosted payment page
// After payment, Stripe webhook creates org + user in Supabase

export async function GET(req: NextRequest) {
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY

  if (!STRIPE_SECRET_KEY) {
    // No Stripe key yet — redirect to signup page or dashboard for now
    return NextResponse.redirect(new URL('/dashboard', req.url))
  }

  try {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'subscription',
        'line_items[0][price]': process.env.STRIPE_PRICE_ID || '',
        'line_items[0][quantity]': '1',
        'subscription_data[trial_period_days]': '14',
        'success_url': `${req.nextUrl.origin}/dashboard?welcome=true`,
        'cancel_url': `${req.nextUrl.origin}/pricing`,
        'allow_promotion_codes': 'true',
      }),
    })

    const session = await response.json()

    if (session.url) {
      return NextResponse.redirect(session.url)
    }

    console.error('Stripe session error:', session)
    return NextResponse.redirect(new URL('/pricing?error=checkout', req.url))
  } catch (err) {
    console.error('Checkout error:', err)
    return NextResponse.redirect(new URL('/pricing?error=checkout', req.url))
  }
}
