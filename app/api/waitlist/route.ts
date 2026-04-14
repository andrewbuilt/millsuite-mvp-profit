import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

const KLAVIYO_API = 'https://a.klaviyo.com/api'
const REVISION = '2024-10-15'

export async function POST(req: NextRequest) {
  try {
    const { email, tier } = await req.json()
    if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 })

    const cleanEmail = email.trim().toLowerCase()

    // Save to Supabase waitlist table
    await supabaseAdmin.from('waitlist').insert({
      email: cleanEmail,
      tier: tier || 'unknown',
    })

    // Sync to Klaviyo (non-blocking — don't break the UX if Klaviyo is down)
    const KLAVIYO_KEY = process.env.KLAVIYO_PRIVATE_KEY
    const KLAVIYO_LIST = process.env.KLAVIYO_LIST_ID

    if (KLAVIYO_KEY && KLAVIYO_LIST) {
      const headers = {
        'Authorization': `Klaviyo-API-Key ${KLAVIYO_KEY}`,
        'Content-Type': 'application/json',
        'revision': REVISION,
      }

      try {
        // Create or update profile
        const profileRes = await fetch(`${KLAVIYO_API}/profiles/`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            data: {
              type: 'profile',
              attributes: {
                email: cleanEmail,
                properties: {
                  source: 'millsuite_waitlist',
                  signup_page: 'millsuite.com',
                  tier: tier || 'unknown',
                  signed_up_at: new Date().toISOString(),
                },
              },
            },
          }),
        })

        let profileId: string | null = null
        if (profileRes.status === 201) {
          const data = await profileRes.json()
          profileId = data?.data?.id
        } else if (profileRes.status === 409) {
          const errorData = await profileRes.json()
          profileId = errorData?.errors?.[0]?.meta?.duplicate_profile_id || null
        }

        if (profileId) {
          // Add to list
          await fetch(`${KLAVIYO_API}/lists/${KLAVIYO_LIST}/relationships/profiles/`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              data: [{ type: 'profile', id: profileId }],
            }),
          })

          // Subscribe to email marketing so flows actually send
          await fetch(`${KLAVIYO_API}/profile-subscription-bulk-create-jobs/`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              data: {
                type: 'profile-subscription-bulk-create-job',
                attributes: {
                  profiles: {
                    data: [{ type: 'profile', attributes: { email: cleanEmail } }],
                  },
                },
                relationships: {
                  list: { data: { type: 'list', id: KLAVIYO_LIST } },
                },
              },
            }),
          })
        }

        // Fire the event
        await fetch(`${KLAVIYO_API}/events/`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            data: {
              type: 'event',
              attributes: {
                metric: { data: { type: 'metric', attributes: { name: 'Waitlist Signup' } } },
                profile: { data: { type: 'profile', attributes: { email: cleanEmail } } },
                properties: { source: 'millsuite', signup_page: 'millsuite.com', tier: tier || 'unknown' },
              },
            },
          }),
        })
      } catch (e) {
        console.error('Klaviyo sync failed (non-blocking):', e)
      }
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('Waitlist error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
