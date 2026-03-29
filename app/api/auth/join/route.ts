import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Called when a team member signs up via /join/[slug] — adds them to an existing org

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
