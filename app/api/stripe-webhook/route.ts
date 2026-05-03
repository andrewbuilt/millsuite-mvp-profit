import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getStripe } from '@/lib/stripe'
import { validatePlan } from '@/lib/feature-flags'

// Stripe webhook — single source of truth for subscription state.
//
// Set the endpoint URL in Stripe Dashboard → Developers → Webhooks:
//   https://millsuite.com/api/stripe-webhook
// Subscribe to these events:
//   - checkout.session.completed       (initial activation)
//   - invoice.payment_succeeded        (renewal — extend period_end)
//   - invoice.payment_failed           (mark past_due so the gate kicks in)
//   - customer.subscription.updated    (cancel scheduled, seats changed, etc.)
//   - customer.subscription.deleted    (final cancellation after period end)
//
// Then copy the signing secret into env STRIPE_WEBHOOK_SECRET.
//
// Required env vars:
//   STRIPE_SECRET_KEY      (used to look up subscriptions by id)
//   STRIPE_WEBHOOK_SECRET  (whsec_... — used to verify signatures)

export const runtime = 'nodejs'  // need raw body for signature verification

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!stripe || !webhookSecret) {
    console.error('Webhook called without STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  }

  // Stripe needs the raw request body (bytes-exact) to verify the
  // signature. NextRequest.text() preserves the bytes.
  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return NextResponse.json({ error: `Invalid signature: ${err.message}` }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(stripe, event.data.object as Stripe.Checkout.Session)
        break
      case 'invoice.payment_succeeded':
        await handleInvoicePaid(event.data.object as Stripe.Invoice)
        break
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      default:
        // Stripe sends a lot of events. Ignoring the ones we haven't
        // wired up is fine — Stripe will not retry unless we 4xx/5xx.
        break
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error(`Error handling webhook ${event.type}:`, err)
    // Return 500 so Stripe retries — failure is usually a transient DB
    // issue. Don't 4xx unless the event itself is malformed.
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Event handlers ──────────────────────────────────────────────────────────

async function handleCheckoutCompleted(stripe: Stripe, session: Stripe.Checkout.Session) {
  const orgId = session.metadata?.org_id
  if (!orgId) {
    console.error('checkout.session.completed missing metadata.org_id', session.id)
    return
  }

  const plan = validatePlan(session.metadata?.plan)
  if (!plan) {
    console.error('checkout.session.completed missing/invalid metadata.plan', session.id)
    return
  }

  // session.subscription is either a string ID or expanded object.
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription?.id

  const customerId =
    typeof session.customer === 'string' ? session.customer : session.customer?.id

  if (!subscriptionId || !customerId) {
    console.error('checkout.session.completed missing subscription or customer', session.id)
    return
  }

  // Pull the subscription so we can get current_period_end and the real
  // quantity (in case Stripe adjusted it).
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const seats = subscription.items.data[0]?.quantity ?? 1
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()

  const { error } = await supabaseAdmin
    .from('orgs')
    .update({
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      plan,
      plan_status: subscription.status === 'active' || subscription.status === 'trialing'
        ? 'active'
        : 'incomplete',
      seats,
      current_period_end: periodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end,
    })
    .eq('id', orgId)

  if (error) {
    console.error('Failed to activate org:', orgId, error)
    throw error
  }

  console.log(`✅ Activated org ${orgId} with subscription ${subscriptionId} (${plan}, ${seats} seats)`)
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id
  if (!subscriptionId) return

  // Recurring invoice paid — extend current_period_end and clear past_due.
  // We re-read period_end from the period covered on the invoice line.
  const lineEnd = invoice.lines.data[0]?.period?.end
  if (!lineEnd) return

  const { error } = await supabaseAdmin
    .from('orgs')
    .update({
      plan_status: 'active',
      current_period_end: new Date(lineEnd * 1000).toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)

  if (error) {
    console.error('Failed to extend period_end:', subscriptionId, error)
    throw error
  }
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id
  if (!subscriptionId) return

  const { error } = await supabaseAdmin
    .from('orgs')
    .update({ plan_status: 'past_due' })
    .eq('stripe_subscription_id', subscriptionId)

  if (error) {
    console.error('Failed to mark past_due:', subscriptionId, error)
    throw error
  }
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  // Catches: customer canceled (cancel_at_period_end=true), seat count
  // changed via the Customer Portal, plan changed, etc.
  const seats = subscription.items.data[0]?.quantity ?? 1
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString()

  // Map Stripe subscription status to our plan_status. 'trialing' and
  // 'active' both grant access; everything else gates.
  const planStatus =
    subscription.status === 'active' || subscription.status === 'trialing'
      ? 'active'
      : subscription.status === 'past_due'
        ? 'past_due'
        : subscription.status === 'canceled'
          ? 'canceled'
          : 'incomplete'

  const { error } = await supabaseAdmin
    .from('orgs')
    .update({
      plan_status: planStatus,
      seats,
      current_period_end: periodEnd,
      cancel_at_period_end: subscription.cancel_at_period_end,
    })
    .eq('stripe_subscription_id', subscription.id)

  if (error) {
    console.error('Failed to sync subscription update:', subscription.id, error)
    throw error
  }
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  // Final cancellation — fires when the subscription actually ends, either
  // immediately on canceled-now or at period_end on canceled-at-period-end.
  const { error } = await supabaseAdmin
    .from('orgs')
    .update({
      plan_status: 'canceled',
      cancel_at_period_end: false,
    })
    .eq('stripe_subscription_id', subscription.id)

  if (error) {
    console.error('Failed to mark org canceled:', subscription.id, error)
    throw error
  }
}
