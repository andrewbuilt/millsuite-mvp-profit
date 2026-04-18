// DEPRECATED: Portal emails are now fired via Klaviyo events when the portal
// is created or the password is reset. This route is gone — delete the
// directory in your next commit:
//
//   rm -rf app/api/projects/[id]/email-portal
//
// Returns 410 Gone so any stale client cached on this endpoint fails loudly.

import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    {
      error:
        'This endpoint was removed. Portal emails now fire automatically when you enable the portal or reset the password.',
    },
    { status: 410 }
  )
}
