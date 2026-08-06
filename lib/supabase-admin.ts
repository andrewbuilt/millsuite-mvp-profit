import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ============================================================================
// Service-role client for API routes. NEVER import this into client code.
// ============================================================================
// `cache: 'no-store'` below is load-bearing, not a precaution.
//
// Next.js 14 patches global fetch and caches GET requests made from server
// code. supabase-js issues its reads through that same global fetch, so every
// SELECT an API route made was being answered out of Next's Data Cache for as
// long as the entry lived. Writes go out as POST/PATCH and are never cached —
// which is exactly what made this so hard to see. The database updated
// instantly and correctly while the API kept serving a snapshot from hours
// earlier.
//
// Caught on /api/team/setup returning `Kaylin Price → null` and
// `Matt → "sdff"` while the row genuinely held "WATCH1" and "Test". For days
// it presented as "roster edits don't save". They always saved.
//
// `export const dynamic = 'force-dynamic'` on the route is NOT enough: it
// makes the ROUTE dynamic, but each fetch keeps its own caching behaviour.
// The opt-out has to be on the fetch, which means here — once, for every
// route that uses this client.
// ============================================================================
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    // A service-role client has no user session to persist or refresh.
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, cache: 'no-store' }),
  },
})
