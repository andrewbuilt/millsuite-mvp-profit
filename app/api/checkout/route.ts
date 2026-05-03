import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getStripe, resolvePriceId } from '@/lib/stripe'
import {
  PLAN_SEAT_MINIMUM,
  validatePlan,
  type Plan,
} from '@/lib/feature-flags'

// Stripe Checkout session — redirects user to Stripe hosted payment page.
//
// Called from:
//   1. /signup — right after /api/auth/setup creates the org with
//      plan_status='pending'. POST { org_id, plan, seats }.
//   2. Settings → Billing "Reactivate" button on past_due / canceled orgs.
//
// On success, Stripe webhook (/api/stripe-webhook) handles the
// checkout.session.completed event and flips the org to active. The
// success_url just lands the user on /dashboard?welcome=true.
//
// Required env vars:
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_PRO_AI    (and STARTER / PRO when those tiers go live)
//   STRIPE_PRICE_ID        (legacy fallback — used when only one tier
//                           is wired up)

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Billing not configured. Set STRIPE_SECRET_KEY.' },
      { status: 503 },
    )
  }

  let body: { org_id?: string; plan?: string; seats?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { org_id } = body
  if (!org_id) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }

  const plan = validatePlan(body.plan)
  if (!plan) {
    return NextResponse.json(
      { error: `Invalid plan. Must be one of: starter, pro, pro-ai.` },
      { status: 400 },
    )
  }

  // Look up the org. We trust org_id from the caller (it was just minted
  // by /api/auth/setup or fetched from the authed session) — payment
  // can only activate an org that exists, and the webhook is the source
  // of truth for activation, so a faked org_id at most lets an attacker
  // pay Andrew money to activate someone else's account. That's not a
  // meaningful attack.
  const { data: org, error: orgErr } = await supabaseAdmin
    .from('orgs')
    .select('id, name, plan, plan_status, stripe_customer_id')
    .eq('id', org_id)
    .single()

  if (orgErr || !org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  // Don't double-charge an active subscription. Active orgs should go
  // through the Customer Portal (/api/portal) to upgrade or change seats.
  if (org.plan_status === 'active') {
    return NextResponse.json(
      {
        error: 'Subscription already active. Use the Customer Portal to make changes.',
      },
      { status: 409 },
    )
  }

  const minSeats = PLAN_SEAT_MINIMUM[plan]
  const requestedSeats = typeof body.seats === 'number' ? body.seats : minSeats
  const quantity = Math.max(requestedSeats, minSeats)

  const priceId = resolvePriceId(plan)
  if (!priceId) {
    return NextResponse.json(
      {
        error: `No price ID configured for plan "${plan}". Set ${
          plan === 'pro-ai'
            ? 'STRIPE_PRICE_PRO_AI'
            : plan === 'pro'
              ? 'STRIPE_PRICE_PRO'
              : 'STRIPE_PRICE_STARTER'
        } in env vars.`,
      },
      { status: 503 },
    )
  }

  const origin = req.nextUrl.origin

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity,
        },
      ],
      // No trial — Andrew chose to charge immediately for the first
      // customer. Add `subscription_data.trial_period_days` here later
      // if/when we want to layer trials on for new tiers.
      subscription_data: {
        metadata: {
          org_id: org.id,
          plan,
          seats: String(quantity),
        },
      },
      // Top-level metadata is set on the Checkout Session object itself
      // (not the resulting subscription) and is what we read in the
      // checkout.session.completed webhook to find the org.
      metadata: {
        org_id: org.id,
        plan,
        seats: String(quantity),
      },
      // If we already have a Stripe customer for this org (e.g. they
      // canceled and are re-subscribing), reuse it so all their billing
      // history stays under one customer record. Otherwise let Stripe
      // create one and we'll capture customer_id in the webhook.
      ...(org.stripe_customer_id
        ? { customer: org.stripe_customer_id }
        : {}),
      allow_promotion_codes: true,
      success_url: `${origin}/dashboard?welcome=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/settings?canceled=1`,
    })

    if (!session.url) {
      console.error('Stripe session missing URL:', session.id)
      return NextResponse.json(
        { error: 'Stripe did not return a checkout URL.' },
        { status: 502 },
      )
    }

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Checkout session error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to create checkout session' },
      { status: 500 },
    )
  }
}
