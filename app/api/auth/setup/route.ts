import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { validatePlan } from '@/lib/feature-flags'

// Called after Supabase auth signup — creates org + user + default settings

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

    // Check if user already has an org
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', auth_user_id)
      .single()

    if (existingUser) {
      return NextResponse.json({ org_id: existingUser.org_id, user_id: existingUser.id })
    }

    // Create org
    const slug = shop_name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 40)

    const { data: org, error: orgError } = await supabaseAdmin
      .from('orgs')
      .insert({
        name: shop_name,
        slug,
        plan,
      })
      .select()
      .single()

    if (orgError || !org) {
      console.error('Org creation error:', orgError)
      return NextResponse.json({ error: 'Failed to create organization' }, { status: 500 })
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
    })
  } catch (err: any) {
    console.error('Auth setup error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
