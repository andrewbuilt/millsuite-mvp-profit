import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { PLAN_SEAT_MINIMUM, validatePlan } from '@/lib/feature-flags'

// Called after Supabase auth signup — creates org + user + default settings.
//
// New orgs land in plan_status='pending'. The signup page immediately
// redirects to /api/checkout, where Stripe collects payment; the
// stripe-webhook then flips plan_status='active'. Until that flip,
// /app pages show a "complete payment" gate.

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { auth_user_id, email, shop_name } = body

    if (!auth_user_id || !email || !shop_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // The signup form passes ?plan= through. Anything outside the live
    // PLANS list (incl. legacy 'trial') falls back to 'starter' — we
    // don't ship a free tier anymore, but a stale URL shouldn't reject
    // the signup.
    const plan = validatePlan(body.plan) ?? 'starter'
    // Seats — signup form passes the customer's selection (defaults to
    // tier minimum, customer can bump via the +/- stepper). Floor to
    // the minimum so a stale form or URL hack can't undercut. The
    // checkout session may still bump this on Stripe's side via
    // adjustable_quantity; the webhook re-reads the actual subscription
    // quantity and overwrites org.seats when payment succeeds.
    const requestedSeats = Number(body.seats) || PLAN_SEAT_MINIMUM[plan]
    const seats = Math.max(requestedSeats, PLAN_SEAT_MINIMUM[plan])

    // Check if user already has an org
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', auth_user_id)
      .single()

    if (existingUser) {
      return NextResponse.json({
        org_id: existingUser.org_id,
        user_id: existingUser.id,
        plan,
        seats,
      })
    }

    // Create org. Slug needs to be unique — orgs.slug has a unique
    // index that we use for /join/[slug] routing. Common shop names
    // ("Built", "Cabinet Shop") will collide with seed data or with
    // existing customers, which used to surface as a generic "Failed
    // to create organization" error and stall the signup. PR #117:
    // try the clean slug first, fall back to appending a short random
    // suffix on collision. Five attempts is plenty.
    const baseSlug = shop_name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40) || 'shop'

    let slug = baseSlug
    let org: any = null
    let orgError: any = null
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await supabaseAdmin
        .from('orgs')
        .insert({
          name: shop_name,
          slug,
          plan,
          // Override the migration's 'active' default — new signups
          // must pay before they get access. The webhook flips this
          // to 'active' when Stripe confirms payment.
          plan_status: 'pending',
          seats,
        })
        .select()
        .single()
      if (result.data) {
        org = result.data
        orgError = null
        break
      }
      orgError = result.error
      // Postgres uniqueness violation: error code '23505'. Append a
      // short random suffix and retry. Anything else is a real error
      // — bail out so we don't loop on a constraint we can't recover
      // from (e.g. a missing required column).
      const isUniqueViolation =
        orgError?.code === '23505' ||
        (typeof orgError?.message === 'string' &&
          /duplicate key|unique constraint|already exists/i.test(orgError.message))
      if (!isUniqueViolation) break
      slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 50)
    }

    if (orgError || !org) {
      console.error('Org creation error:', orgError)
      return NextResponse.json(
        {
          error: orgError?.message
            ? `Failed to create organization: ${orgError.message}`
            : 'Failed to create organization',
        },
        { status: 500 },
      )
    }

    // Create user linked to auth + org
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        org_id: org.id,
        auth_user_id,
        email,
        name: shop_name,
        role: 'owner',
      })
      .select()
      .single()

    if (userError) {
      console.error('User creation error:', userError)
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }

    // Update org owner
    await supabaseAdmin
      .from('orgs')
      .update({ owner_id: user.id })
      .eq('id', org.id)

    // Create default shop rate settings
    await supabaseAdmin
      .from('shop_rate_settings')
      .insert({ org_id: org.id })

    // Seed the canonical 5 departments. Settings → Active departments
    // can toggle any of these off later (active=false hides them from
    // schedule / time clock / capacity without orphaning past time
    // entries). 8 hours/day default = 40 hours/week.
    const DEFAULT_DEPARTMENTS = [
      { name: 'Engineering', display_order: 1 },
      { name: 'CNC', display_order: 2 },
      { name: 'Assembly', display_order: 3 },
      { name: 'Finish', display_order: 4 },
      { name: 'Install', display_order: 5 },
    ]
    const { error: deptErr } = await supabaseAdmin.from('departments').insert(
      DEFAULT_DEPARTMENTS.map((d) => ({
        org_id: org.id,
        name: d.name,
        display_order: d.display_order,
        active: true,
        hours_per_day: 8,
      })),
    )
    if (deptErr) {
      // Non-fatal — the org is created, the operator can add departments
      // manually from Settings if the seed insert fails.
      console.warn('Department seed failed', deptErr)
    }

    return NextResponse.json({
      org_id: org.id,
      user_id: user.id,
      slug: org.slug,
      plan,
      seats,
    })
  } catch (err: any) {
    console.error('Auth setup error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
