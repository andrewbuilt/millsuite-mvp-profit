import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { PLAN_SEAT_MINIMUM, validatePlan, TRIAL_DAYS } from '@/lib/feature-flags'
import { deconflictSlug } from '@/lib/reserved-slugs'

// Called right after Supabase auth signup — creates org + owner user +
// default settings + departments, atomically (migration 053's
// create_org_with_owner function runs the whole thing in one transaction,
// so a partial failure can't orphan an org or let a retry duplicate one).
//
// New orgs land in plan_status='pending'. The signup page immediately
// redirects to /api/checkout, where Stripe collects payment; the
// stripe-webhook then flips plan_status='active'. Until that flip,
// /app pages show a "complete payment" gate.
//
// AUTH (L4): the caller's identity comes from the verified Supabase
// access token in the Authorization header — NOT from the request body.
// auth_user_id and email are read off the token so a client can't mint an
// org for someone else's user id. The signup page ships the token from
// the session it just created via supabase.auth.signUp().

export async function POST(req: NextRequest) {
  try {
    // ── Verify the session and derive identity (L4) ──
    const authHeader = req.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const { data: authData, error: authErr } =
      await supabaseAdmin.auth.getUser(token)
    if (authErr || !authData?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const authUserId = authData.user.id
    const email = authData.user.email
    if (!email) {
      return NextResponse.json(
        { error: 'Authenticated user has no email' },
        { status: 400 },
      )
    }

    const body = await req.json()
    const shopName =
      typeof body.shop_name === 'string' ? body.shop_name.trim() : ''
    if (!shopName) {
      return NextResponse.json(
        { error: 'shop_name is required' },
        { status: 400 },
      )
    }

    // The signup form passes ?plan= through. Anything outside the live
    // PLANS list (incl. legacy 'trial') falls back to 'starter'.
    const plan = validatePlan(body.plan) ?? 'starter'
    // Seats — floor to the tier minimum so a stale form or URL hack can't
    // undercut. The checkout session may bump this via adjustable_quantity;
    // the webhook re-reads the real subscription quantity on payment.
    const requestedSeats = Number(body.seats) || PLAN_SEAT_MINIMUM[plan]
    const seats = Math.max(requestedSeats, PLAN_SEAT_MINIMUM[plan])

    // Idempotency: if this auth user already has an org, return it.
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', authUserId)
      .single()

    if (existingUser) {
      return NextResponse.json({
        org_id: existingUser.org_id,
        user_id: existingUser.id,
        plan,
        seats,
      })
    }

    // Base slug from the shop name; the SQL function retries with a random
    // suffix on collision (orgs.slug is unique, used for /join/[slug]).
    // Org slugs sit at the URL root, so a shop named "Settings" or "Login"
    // would shadow a real route. orgs.slug is unique against other ORGS, not
    // against routes — nothing caught this before. deconflictSlug appends
    // "-shop" rather than rejecting, so signup never dead-ends on a name.
    const baseSlug = deconflictSlug(
      shopName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 40) || 'shop',
    )

    // ── Trial vs pay-immediately (055) ──
    // The base tier ('starter'/Profit) starts a 30-day no-card trial:
    // plan_status='trialing' + trial_ends_at grants access right away with
    // no checkout. Pro / Pro+ stay 'pending' and must pay at signup.
    const isTrial = plan === 'starter'
    const trialEndsAt = isTrial
      ? new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null
    const planStatus = isTrial ? 'trialing' : 'pending'

    // ── Atomic create (migrations 053 + 055) ──
    const { data: created, error: rpcErr } = await supabaseAdmin.rpc(
      'create_org_with_owner',
      {
        p_auth_user_id: authUserId,
        p_email: email,
        p_shop_name: shopName,
        p_plan: plan,
        p_seats: seats,
        p_base_slug: baseSlug,
        p_plan_status: planStatus,
        p_trial_ends_at: trialEndsAt,
      },
    )

    // rpc() returns the function's TABLE result as an array of rows.
    const row = Array.isArray(created) ? created[0] : created
    if (rpcErr || !row?.org_id) {
      console.error('create_org_with_owner failed:', rpcErr)
      return NextResponse.json(
        {
          error: rpcErr?.message
            ? `Failed to create organization: ${rpcErr.message}`
            : 'Failed to create organization',
        },
        { status: 500 },
      )
    }

    return NextResponse.json({
      org_id: row.org_id,
      user_id: row.user_id,
      slug: row.slug,
      plan,
      seats,
      // Base tier started a trial → the signup page skips Stripe Checkout.
      trial: isTrial,
    })
  } catch (err: any) {
    console.error('Auth setup error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
