'use client'

// ============================================================================
// /dashboard — RETIRED 2026-09-12. Redirects to /pm.
// ============================================================================
// Andrew: "delete the dash that is linked to the logo and make that the my day
// page." Everything that earned its keep moved to /pm:
//
//   · the "Getting set up" checklist + the welcome completion toast
//   · Projects at risk  → components/pm/ProjectsAtRiskCard
//   · Receivables       → components/pm/ReceivablesCard (math rebuilt — the
//                         old card was blind to QuickBooks payments; see the
//                         header of lib/receivables)
//   · the invoice parser — already on /pm
//   · the AI shop report → /reports (home-consolidation item 1)
//
// Dropped on Andrew's call: the key-metrics strip (shop rate / in production /
// bidding / margin) and the quick-actions tiles (all three already in the nav).
//
// ⛔ THE ROUTE STAYS, AS A REDIRECT, DELIBERATELY. Bookmarks, the PWA's old
// start_url on already-installed phones, and Stripe checkout sessions created
// before this deploy all still point here. Deleting the folder would 404 them.
// `replace`, not `push`, so Back doesn't bounce off the redirect.
//
// ⚠️ THE QUERY STRING IS DROPPED, and that's fine TODAY but worth knowing:
// old checkout links carry `?welcome=true&session_id=...`. Nothing anywhere
// reads either one — `welcome=true` only ever gated the empty state, which
// now lives on /pm and keys off the project count instead. If something ever
// starts reading a param here, this redirect has to carry it through.
// ============================================================================

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function RetiredDashboard() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/pm')
  }, [router])

  return (
    <div className="max-w-6xl mx-auto px-6 py-16 text-center text-[#9CA3AF] text-sm">
      Taking you to your day…
    </div>
  )
}
