import { NextResponse } from 'next/server'

// GET /api/version — returns the build id of the CURRENTLY-LIVE deployment.
//
// The update banner (components/update-banner.tsx) polls this and compares
// it to the build id baked into the session at load time. Because every
// Vercel production deploy gets a fresh VERCEL_GIT_COMMIT_SHA (baked into
// NEXT_PUBLIC_BUILD_ID via next.config.js), a new deploy makes this return
// a different value than already-open sessions hold → the banner appears.
//
// Must never be cached, or open sessions wouldn't see the new value.

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return NextResponse.json(
    { buildId: process.env.NEXT_PUBLIC_BUILD_ID || 'dev' },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  )
}
