import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Called after Supabase auth signup — creates org + user + default settings

export async function POST(req: NextRequest) {
  try {
    const { auth_user_id, email, shop_name } = await req.json()

    if (!auth_user_id || !email || !shop_name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

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
        plan: 'trial',
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
