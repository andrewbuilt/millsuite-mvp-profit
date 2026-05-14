import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSeatStatus } from '@/lib/seats'

// Called when a team member signs up via /join/[slug] — adds them to an
// existing org. PR #115 hard-gates this on seat availability: if the
// org is at its seat limit, the join fails with a 402 (Payment Required)
// and the front-end /join/[slug] page surfaces a "ask the owner to add
// seats" message. Owners add seats via Settings → Subscription →
// Manage subscription → Customer Portal.

export async function POST(req: NextRequest) {
  try {
    const { auth_user_id, email, name, slug } = await req.json()

    if (!auth_user_id || !email || !name || !slug) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Check if user already exists
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, org_id')
      .eq('auth_user_id', auth_user_id)
      .single()

    if (existingUser) {
      return NextResponse.json({ org_id: existingUser.org_id, user_id: existingUser.id })
    }

    // Look up the org by slug
    const { data: org, error: orgError } = await supabaseAdmin
      .from('orgs')
      .select('id, name')
      .eq('slug', slug)
      .single()

    if (orgError || !org) {
      return NextResponse.json({ error: 'Shop not found' }, { status: 404 })
    }

    // Seat enforcement (PR #115). If the org is already at its seat
    // limit, refuse the join. Returns 402 with structured error so the
    // join page can show a clear "no seats available — ask the owner
    // to add seats" message instead of a generic 500.
    const seatStatus = await getSeatStatus(org.id)
    if (seatStatus.atLimit) {
      return NextResponse.json(
        {
          error: 'no_seats_available',
          message: `${org.name} has used all ${seatStatus.limit} of its seats. Ask the shop owner to add more seats from Settings → Subscription before joining.`,
          used: seatStatus.used,
          limit: seatStatus.limit,
        },
        { status: 402 },
      )
    }

    // Create user linked to this org as a member
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        org_id: org.id,
        auth_user_id,
        email,
        name,
        role: 'member',
      })
      .select()
      .single()

    if (userError) {
      console.error('User creation error:', userError)
      return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
    }

    return NextResponse.json({
      org_id: org.id,
      user_id: user.id,
      org_name: org.name,
    })
  } catch (err: any) {
    console.error('Join error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
