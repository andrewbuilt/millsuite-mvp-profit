'use client'

import { useEffect, useState } from 'react'

// UpdateBanner — gentle "a new version is available" nudge.
//
// How it works: the build id this session loaded with is baked in at build
// time (NEXT_PUBLIC_BUILD_ID, set from VERCEL_GIT_COMMIT_SHA per deploy).
// We poll /api/version — served by the live deployment — every few minutes.
// When the live build id differs from ours, a newer version is deployed, so
// we show a dismissible bottom-right toast with a Refresh button. We NEVER
// auto-reload: people may be mid-estimate.
//
// Dismiss hides it until the NEXT deploy (we remember which build id was
// dismissed, so a later deploy re-surfaces it).

const MY_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || 'dev'
const POLL_MS = 3 * 60 * 1000 // 3 minutes

export default function UpdateBanner() {
  const [latest, setLatest] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    // In local dev there's no real build id to compare against — stay dormant.
    if (MY_BUILD === 'dev') return

    let cancelled = false
    async function check() {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { buildId?: string }
        if (!cancelled && typeof data.buildId === 'string') {
          setLatest(data.buildId)
        }
      } catch {
        /* network blip — try again next interval */
      }
    }

    check()
    const interval = setInterval(check, POLL_MS)
    // Re-check the moment the user comes back to the tab.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const updateAvailable =
    !!latest && latest !== MY_BUILD && latest !== dismissed

  if (!updateAvailable) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-xs">
      <div className="flex items-start gap-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3 shadow-lg">
        <div className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[#2563EB]" />
        <div className="flex-1">
          <p className="text-sm font-medium text-[#111]">A new version is available</p>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            Refresh when you're at a good stopping point to get the latest.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1D4ED8]"
            >
              Refresh
            </button>
            <button
              onClick={() => setDismissed(latest)}
              className="text-xs text-[#9CA3AF] hover:text-[#6B7280]"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
