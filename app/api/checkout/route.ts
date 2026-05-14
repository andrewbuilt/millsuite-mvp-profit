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
    .select('id, name, plan, plan_status, stripe_customer_id, pending_checkout_session_id')
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

  // ── Idempotency (PR #116) ──
  // If we previously created a checkout session for this org and it's
  // still open, reuse it. Stops a customer from racking up duplicate
  // subscriptions by clicking "Continue to payment" multiple times.
  // (Stripe sessions are 'open' for 24 hours by default; after that
  // we fall through and create a fresh one.)
  if (org.pending_checkout_session_id) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(
        org.pending_checkout_session_id,
      )
      if (existing.status === 'open' && existing.url) {
        return NextResponse.json({ url: existing.url })
      }
      if (existing.status === 'complete') {
        // Already paid — webhook should activate any moment. Tell the
        // client to chill and refresh; don't let them create another one.
        return NextResponse.json(
          {
            error:
              'Payment is being processed. Refresh the page in a moment — you should land on the dashboard.',
          },
          { status: 409 },
        )
      }
      // 'expired' falls through and we'll create a new session below.
    } catch (err) {
      // If Stripe doesn't find the session (deleted, bad ID, etc.) just
      // log and proceed to create a new one. Don't break the flow.
      console.warn('Could not retrieve pending session, creating new:', err)
    }
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

  // ── Stripe customer reuse by email (PR #116) ──
  // If the org has no stripe_customer_id but the owner's email already
  // exists in Stripe (e.g. a previous failed signup attempt created a
  // customer that never got linked back), reuse it. Without this, every
  // /api/checkout call on a pending org creates a brand new Stripe
  // customer — which is what produced Bam Woodworks' 5 separate
  // customer records on May 10.
  let customerIdToUse = org.stripe_customer_id
  if (!customerIdToUse) {
    const { data: ownerUser } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('org_id', org.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .single()
    const ownerEmail = ownerUser?.email
    if (ownerEmail) {
      try {
        const existingCustomers = await stripe.customers.list({
          email: ownerEmail,
          limit: 1,
        })
        if (existingCustomers.data.length > 0) {
          customerIdToUse = existingCustomers.data[0].id
        }
      } catch (err) {
        // Non-fatal — Stripe will create a new customer if we don't
        // pass one. Log and continue.
        console.warn('Could not list customers by email:', err)
      }
    }
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity,
          // Stripe Checkout renders +/- buttons next to the quantity so
          // a customer signing up for Pro+ at the 5-seat minimum can bump
          // to 7 right on the Checkout page. The webhook fires with the
          // actual selected quantity (we don't need to trust the client).
          // Min mirrors PLAN_SEAT_MINIMUM; max is set high (100) so we
          // don't gate adoption — bigger shops can self-serve.
          adjustable_quantity: {
            enabled: true,
            minimum: PLAN_SEAT_MINIMUM[plan],
            maximum: 100,
          },
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
      // Reuse the existing Stripe customer when we have one — either
      // because the org row already has stripe_customer_id (re-subscribe
      // after cancellation) OR because we found a customer record by
      // email above (failed previous signup attempt). Otherwise Stripe
      // creates a fresh customer and the webhook captures the ID.
      ...(customerIdToUse ? { customer: customerIdToUse } : {}),
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

    // Save the session ID so the next /api/checkout call on this org
    // reuses this same session instead of creating a new one. The
    // webhook clears this column when payment succeeds and activation
    // completes (see /api/stripe-webhook handleCheckoutCompleted).
    const { error: saveErr } = await supabaseAdmin
      .from('orgs')
      .update({ pending_checkout_session_id: session.id })
      .eq('id', org.id)
    if (saveErr) {
      // Non-fatal — the session URL is still being returned, customer
      // can still pay. We just lose idempotency on this one click.
      console.warn('Could not save pending_checkout_session_id:', saveErr)
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
