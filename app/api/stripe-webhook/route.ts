import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Stripe webhook — creates org + user when checkout completes
// Set this URL in Stripe Dashboard → Webhooks

export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    // TODO: Verify Stripe signature with STRIPE_WEBHOOK_SECRET
    const event = JSON.parse(body)

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const email = session.customer_email || session.customer_details?.email
      const customerId = session.customer
      const subscriptionId = session.subscription

      if (!email) {
        console.error('No email in checkout session')
        return NextResponse.json({ received: true })
      }

      // Create org
      const { data: org } = await supabaseAdmin.from('orgs').insert({
        name: email.split('@')[0] + "'s Shop",
        slug: email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-'),
        stripe_customer_id: customerId,
        stripe_subscription_id: subscriptionId,
        plan: 'starter',
      }).select().single()

      if (org) {
        // Create user
        await supabaseAdmin.from('users').insert({
          org_id: org.id,
          email,
          name: email.split('@')[0],
          role: 'owner',
        })

        // Create default shop rate settings
        await supabaseAdmin.from('shop_rate_settings').insert({
          org_id: org.id,
        })
      }
    }

    return NextResponse.json({ received: true })
  } catch (err: any) {
    console.error('Webhook error:', err)
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
}
