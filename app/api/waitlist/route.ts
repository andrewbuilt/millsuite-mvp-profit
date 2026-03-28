import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { email, tier } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    await supabaseAdmin.from('waitlist').insert({
      email: email.trim().toLowerCase(),
      tier: tier || 'unknown',
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Waitlist error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
