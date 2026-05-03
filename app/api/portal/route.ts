import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getStripe } from '@/lib/stripe'

// Stripe Billing Portal session — opens the hosted Customer Portal where
// the customer can update their card, view invoices, and cancel.
//
// Cancellation behavior is configured in Stripe Dashboard → Settings →
// Billing → Customer Portal (Andrew set "at end of billing period").
// When the customer cancels there, Stripe sends customer.subscription.
// updated with cancel_at_period_end=true; the webhook syncs that to our
// orgs row. The customer keeps access until current_period_end, then
// customer.subscription.deleted fires and plan_status flips to 'canceled'.
//
// Required env vars:
//   STRIPE_SECRET_KEY

export async function POST(req: NextRequest) {
  const stripe = getStripe()
  if (!stripe) {
    return NextResponse.json(
      { error: 'Billing not configured.' },
      { status: 503 },
    )
  }

  let body: { org_id?: string; return_path?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { org_id } = body
  if (!org_id) {
    return NextResponse.json({ error: 'org_id is required' }, { status: 400 })
  }

  const { data: org, error: orgErr } = await supabaseAdmin
    .from('orgs')
    .select('id, stripe_customer_id')
    .eq('id', org_id)
    .single()

  if (orgErr || !org) {
    return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
  }

  if (!org.stripe_customer_id) {
    return NextResponse.json(
      {
        error:
          'No Stripe customer on file. Complete checkout first.',
      },
      { status: 409 },
    )
  }

  const origin = req.nextUrl.origin
  const returnPath = body.return_path && body.return_path.startsWith('/')
    ? body.return_path
    : '/settings'

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${origin}${returnPath}`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: any) {
    console.error('Portal session error:', err)
    return NextResponse.json(
      { error: err.message || 'Failed to create portal session' },
      { status: 500 },
    )
  }
}
