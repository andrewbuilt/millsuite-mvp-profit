// lib/klaviyo.ts
// Thin wrapper around Klaviyo's Profiles + Events APIs. Used to push
// newly-activated MillSuite signups into Klaviyo so the welcome flow
// can fire.
//
// Only the bits we use today:
//   - upsertProfile()   — create or update a profile keyed by email
//   - trackActivation() — fire a custom event the welcome flow listens for
//
// Required env vars:
//   KLAVIYO_PRIVATE_KEY  — private API key from Klaviyo Account → API keys.
//                          Server-only, never exposed to the browser.
//   KLAVIYO_LIST_ID      — (optional) list to subscribe activated customers
//                          to so they show up in Klaviyo segmentation.
//                          The welcome flow triggers on the
//                          "MillSuite Activation" event, not the list,
//                          so this is for general list hygiene, not flow
//                          firing.

const API_BASE = 'https://a.klaviyo.com/api'
// Klaviyo requires a revision header to pin the API contract. Bumping
// this means re-checking the request/response shapes.
const KLAVIYO_REVISION = '2024-10-15'

function getKey(): string | null {
  return process.env.KLAVIYO_PRIVATE_KEY || null
}

function getListId(): string | null {
  return process.env.KLAVIYO_LIST_ID || null
}

interface UpsertProfileInput {
  email: string
  firstName?: string | null
  shopName?: string | null
  plan: 'starter' | 'pro' | 'pro-ai'
  planLabel: string
  seats: number
  orgId: string
  stripeCustomerId?: string | null
}

/**
 * Create or update a Klaviyo profile keyed by email. Idempotent —
 * Klaviyo dedupes by email so calling this on every webhook fire is
 * safe. Properties we set become available in the welcome flow as
 * `profile.plan`, `profile.plan_label`, etc.
 */
export async function upsertProfile(input: UpsertProfileInput): Promise<void> {
  const key = getKey()
  if (!key) {
    console.warn('KLAVIYO_API_KEY not set — skipping profile upsert')
    return
  }

  const body = {
    data: {
      type: 'profile',
      attributes: {
        email: input.email,
        first_name: input.firstName ?? undefined,
        organization: input.shopName ?? undefined,
        properties: {
          plan: input.plan,
          plan_label: input.planLabel,
          seats: input.seats,
          org_id: input.orgId,
          stripe_customer_id: input.stripeCustomerId ?? undefined,
          source: 'millsuite-signup',
        },
      },
    },
  }

  try {
    const res = await fetch(`${API_BASE}/profile-import/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
        revision: KLAVIYO_REVISION,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('Klaviyo upsertProfile failed:', res.status, text)
      return
    }

    // If a list ID is configured, also subscribe the profile to it.
    // Profile-import returns the profile id we need for the subscription
    // request.
    const listId = getListId()
    if (listId) {
      const json = (await res.json()) as { data?: { id?: string } }
      const profileId = json.data?.id
      if (profileId) {
        await fetch(`${API_BASE}/lists/${listId}/relationships/profiles/`, {
          method: 'POST',
          headers: {
            Authorization: `Klaviyo-API-Key ${key}`,
            'Content-Type': 'application/json',
            accept: 'application/json',
            revision: KLAVIYO_REVISION,
          },
          body: JSON.stringify({
            data: [{ type: 'profile', id: profileId }],
          }),
        }).catch((err) =>
          console.error('Klaviyo list subscribe error (non-fatal):', err),
        )
      }
    }
  } catch (err) {
    // Non-fatal — webhook should still 200 even if Klaviyo errors.
    // We don't want a Klaviyo outage to make Stripe think activation
    // failed and retry the whole event.
    console.error('Klaviyo upsertProfile error:', err)
  }
}

/**
 * Fire a custom event the welcome flow can trigger on. Use this instead
 * of (or alongside) profile-property triggers so the flow runs reliably
 * even when properties haven't fully propagated.
 *
 * Klaviyo flow setup: trigger on metric "MillSuite Activation" — that's
 * what this function emits.
 */
export async function trackActivation(input: UpsertProfileInput): Promise<void> {
  const key = getKey()
  if (!key) return

  const body = {
    data: {
      type: 'event',
      attributes: {
        properties: {
          plan: input.plan,
          plan_label: input.planLabel,
          seats: input.seats,
          monthly_total: input.seats * (
            input.plan === 'starter' ? 49 : input.plan === 'pro' ? 99 : 119
          ),
          org_id: input.orgId,
        },
        metric: {
          data: {
            type: 'metric',
            attributes: { name: 'MillSuite Activation' },
          },
        },
        profile: {
          data: {
            type: 'profile',
            attributes: {
              email: input.email,
              first_name: input.firstName ?? undefined,
              organization: input.shopName ?? undefined,
            },
          },
        },
      },
    },
  }

  try {
    const res = await fetch(`${API_BASE}/events/`, {
      method: 'POST',
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        'Content-Type': 'application/json',
        accept: 'application/json',
        revision: KLAVIYO_REVISION,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text()
      console.error('Klaviyo trackActivation failed:', res.status, text)
    }
  } catch (err) {
    console.error('Klaviyo trackActivation error:', err)
  }
}
