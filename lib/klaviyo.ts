// lib/klaviyo.ts
// Klaviyo integration for MillSuite OS. Server-side only — never import from
// client components. Ported from millsuite-tools with one important difference:
// portal emails go to end-customers (homeowners). We DO create a profile so
// flows can reference it, but we DO NOT add them to any MillSuite marketing
// list and DO NOT subscribe them. The existing MillSuite/Built Things
// subscriber list stays clean.
//
// Env:
//   KLAVIYO_PRIVATE_KEY — required. When unset, every function no-ops with a
//                         console warning.

const KLAVIYO_API = 'https://a.klaviyo.com/api'
const REVISION = '2024-10-15'

function headers() {
  const key = process.env.KLAVIYO_PRIVATE_KEY
  if (!key) throw new Error('KLAVIYO_PRIVATE_KEY not set')
  return {
    Authorization: `Klaviyo-API-Key ${key}`,
    'Content-Type': 'application/json',
    revision: REVISION,
  }
}

export interface KlaviyoProfileInput {
  email: string
  firstName?: string
  lastName?: string
  properties?: Record<string, any>
}

// Upsert a profile only. No list add, no subscription — portal emails are
// transactional and homeowners are not marketing subscribers. Returns the
// Klaviyo profile id on success, or null on failure or misconfig.
export async function upsertProfile(profile: KlaviyoProfileInput): Promise<string | null> {
  if (!process.env.KLAVIYO_PRIVATE_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[klaviyo] KLAVIYO_PRIVATE_KEY not set — skipping upsert for', profile.email)
    return null
  }

  try {
    const res = await fetch(`${KLAVIYO_API}/profiles/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        data: {
          type: 'profile',
          attributes: {
            email: profile.email,
            ...(profile.firstName && { first_name: profile.firstName }),
            ...(profile.lastName && { last_name: profile.lastName }),
            ...(profile.properties && { properties: profile.properties }),
          },
        },
      }),
    })

    if (res.status === 201) {
      const data = await res.json()
      return data?.data?.id || null
    }

    if (res.status === 409) {
      // Duplicate — Klaviyo returns the existing id in the error payload.
      const errorData = await res.json().catch(() => ({}))
      const profileId = errorData?.errors?.[0]?.meta?.duplicate_profile_id as string | undefined
      if (profileId && profile.properties) {
        // Patch updated properties onto the existing profile.
        await fetch(`${KLAVIYO_API}/profiles/${profileId}`, {
          method: 'PATCH',
          headers: headers(),
          body: JSON.stringify({
            data: {
              type: 'profile',
              id: profileId,
              attributes: {
                ...(profile.firstName && { first_name: profile.firstName }),
                ...(profile.lastName && { last_name: profile.lastName }),
                properties: profile.properties,
              },
            },
          }),
        })
      }
      return profileId || null
    }

    const errText = await res.text().catch(() => '')
    // eslint-disable-next-line no-console
    console.error('[klaviyo] profile create failed:', res.status, errText)
    return null
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[klaviyo] upsertProfile error:', err)
    return null
  }
}

// Fire a Klaviyo event ("metric" in Klaviyo speak). The profile is matched or
// created implicitly from the email, so you can call this without first
// calling upsertProfile — but upserting first lets you set first_name and
// other profile-level fields that templates can use ("Hi {{ person.first_name }}").
//
// Every event automatically gets `source: 'millsuite'` so flows can filter by
// origin (same convention as millsuite-tools).
export async function trackEvent(
  email: string,
  eventName: string,
  properties?: Record<string, any>
): Promise<void> {
  if (!process.env.KLAVIYO_PRIVATE_KEY) {
    // eslint-disable-next-line no-console
    console.warn('[klaviyo] KLAVIYO_PRIVATE_KEY not set — skipping event', eventName)
    return
  }

  try {
    const res = await fetch(`${KLAVIYO_API}/events/`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        data: {
          type: 'event',
          attributes: {
            metric: { data: { type: 'metric', attributes: { name: eventName } } },
            profile: { data: { type: 'profile', attributes: { email } } },
            properties: {
              source: 'millsuite',
              ...properties,
            },
          },
        },
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      // eslint-disable-next-line no-console
      console.error('[klaviyo] event POST failed:', res.status, body)
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[klaviyo] trackEvent error:', err)
  }
}

// Helper: pull the first name out of a full name string. Klaviyo templates
// often use {{ person.first_name }} for greetings ("Hi Sarah,"). Defaults to
// 'there' if we can't extract anything useful.
export function extractFirstName(fullName: string | null | undefined): string {
  if (!fullName) return 'there'
  const first = fullName.trim().split(/\s+/)[0]
  return first || 'there'
}
