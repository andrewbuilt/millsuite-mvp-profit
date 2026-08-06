import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// `cache: 'no-store'` for the same reason as the admin client: a database read
// must never be answered from a cache. This one runs in the browser, so the
// risk is the HTTP cache rather than Next's — PostgREST sends no cache-control
// headers, which leaves it to browser heuristics. Pages like /settings read
// the org row straight through here, and a stale answer looks exactly like
// "my edit didn't save". See lib/supabase-admin for how that played out.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, cache: 'no-store' }),
  },
})
