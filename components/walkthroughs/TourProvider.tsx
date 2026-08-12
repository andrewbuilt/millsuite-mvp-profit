'use client'

// ============================================================================
// TourProvider — owns tour state, offers, and persistence
// ============================================================================
// Mounted once in app/(app)/layout.tsx, so a running tour survives every
// client-side navigation the tour itself performs. TourRunner does the
// spotlighting; this decides which tour is running, where it resumed from, and
// what gets written to users.walkthrough_state.
//
// The offer rule, from the spec: `welcome` offers itself ONCE per owner/admin
// user, on the first app load after the setup wizard is finished. It's stamped
// offered_at the moment it's SHOWN, not when it's answered — so closing the tab
// on the offer counts as having been offered. After that it lives in
// Manage → Guides and is never pushed again.
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { canSeeTours, getTour, type TourId } from '@/lib/walkthroughs'
import {
  loadMyProgress,
  saveTourProgress,
  resetTourProgress,
  type WalkthroughState,
} from '@/lib/me-progress'
import { markProjectAsPractice } from '@/lib/practice'
import TourRunner, { type ExitReason } from './TourRunner'
import TourOfferModal from './TourOfferModal'
import PracticeCleanupPrompt from './PracticeCleanupPrompt'

/** Survives a hard reload mid-tour. Session-scoped on purpose: a tour is a
 *  thing you're doing right now, not a thing you come back to next week —
 *  that's what Resume on the Guides page is for. */
const RESUME_KEY = 'millsuite.activeTour'

interface TourApi {
  state: WalkthroughState
  loading: boolean
  /** Show the opt-in modal for a tour. */
  offerTour: (id: TourId) => void
  /** Skip the offer and go. `fromStep` resumes; omit it to start at the top.
   *  `practice` only applies to the tour that creates a project. */
  startTour: (id: TourId, fromStep?: number, practice?: boolean) => void
  /** Wipe a tour's progress so it reads as Not started again. */
  restartTour: (id: TourId) => Promise<void>
  canSee: boolean
}

const TourContext = createContext<TourApi>({
  state: {},
  loading: true,
  offerTour: () => {},
  startTour: () => {},
  restartTour: async () => {},
  canSee: false,
})

export function useTours() {
  return useContext(TourContext)
}

export default function TourProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const pathname = usePathname()
  const [state, setState] = useState<WalkthroughState>({})
  const [loading, setLoading] = useState(true)
  const [onboardedAt, setOnboardedAt] = useState<string | null>(null)
  const [offering, setOffering] = useState<TourId | null>(null)
  const [active, setActive] = useState<{ id: TourId; from: number } | null>(null)
  const autoOfferedRef = useRef(false)

  // Practice mode. Default on for the first-job tour: someone learning the app
  // shouldn't have to decide up front whether their first attempt is worth
  // keeping. Held in a ref as well as state because the project-seen callback
  // fires from inside the runner, outside this render.
  const [practiceMode, setPracticeMode] = useState(true)
  const practiceRef = useRef(true)
  const stampedRef = useRef<Set<string>>(new Set())
  const [cleanupFor, setCleanupFor] = useState<string | null>(null)

  const canSee = canSeeTours(user?.role)

  const refresh = useCallback(async () => {
    if (!user?.id) return
    const p = await loadMyProgress(user.id)
    setState(p.walkthrough_state)
    setOnboardedAt(p.onboarded_at)
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    void refresh()
  }, [user?.id, refresh])

  // The setup wizard finishes with a client-side redirect, so the copy of
  // onboarded_at loaded at mount is stale exactly when it matters. Re-read on
  // navigation, but only while we're still waiting for it — once it's stamped
  // this stops costing a query per page.
  useEffect(() => {
    if (!user?.id || loading || onboardedAt) return
    void refresh()
  }, [pathname, user?.id, loading, onboardedAt, refresh])

  // ── Resume a tour that a hard reload interrupted ─────────────────────────
  useEffect(() => {
    if (loading || !canSee || active) return
    try {
      const raw = sessionStorage.getItem(RESUME_KEY)
      if (!raw) return
      const saved = JSON.parse(raw) as { tourId: TourId; index: number }
      if (getTour(saved.tourId)) setActive({ id: saved.tourId, from: saved.index ?? 0 })
    } catch {
      sessionStorage.removeItem(RESUME_KEY)
    }
    // Only ever on the first settled render — re-running would fight the user
    // dismissing the tour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, canSee])

  // ── The one automatic offer ──────────────────────────────────────────────
  useEffect(() => {
    if (loading || !canSee || active || offering || autoOfferedRef.current) return
    if (!onboardedAt) return // setup wizard still has the floor
    if (state.welcome?.offered_at) return // already had its one shot
    autoOfferedRef.current = true
    setOffering('welcome')
    void saveTourProgress('welcome', { offered_at: new Date().toISOString() })
      .then(() => setState((s) => ({ ...s, welcome: { ...s.welcome, offered_at: new Date().toISOString() } })))
      .catch(() => {})
  }, [loading, canSee, active, offering, onboardedAt, state.welcome?.offered_at])

  const startTour = useCallback(
    (id: TourId, fromStep = 0, practice?: boolean) => {
      // Practice only means anything for the tour that creates a project.
      practiceRef.current = id === 'first-job' && (practice ?? practiceMode)
      stampedRef.current = new Set()
      setOffering(null)
      setActive({ id, from: fromStep })
      void saveTourProgress(id, {
        started_at: new Date().toISOString(),
        step: fromStep,
        dismissed_at: null,
      }).catch(() => {})
    },
    [practiceMode],
  )

  // The tour walks the user into a project it didn't create and can't name in
  // advance — this is where it learns which one and marks it throwaway.
  const handleProjectSeen = useCallback((projectId: string) => {
    if (!practiceRef.current) return
    if (stampedRef.current.has(projectId)) return
    stampedRef.current.add(projectId)
    void markProjectAsPractice(projectId)
  }, [])

  const offerTour = useCallback((id: TourId) => {
    setActive(null)
    setOffering(id)
  }, [])

  const restartTour = useCallback(async (id: TourId) => {
    await resetTourProgress(id)
    setState((s) => {
      const next = { ...s }
      delete next[id]
      return next
    })
  }, [])

  // Progress writes are fire-and-forget: a failed save costs the user their
  // resume point, not their tour. Blocking the spotlight on a round trip would
  // be the worse trade.
  const handleStep = useCallback(
    (index: number) => {
      if (!active) return
      try {
        sessionStorage.setItem(RESUME_KEY, JSON.stringify({ tourId: active.id, index }))
      } catch {
        /* private mode — the tour still runs, it just won't survive a reload */
      }
      void saveTourProgress(active.id, { step: index }).catch(() => {})
      setState((s) => ({ ...s, [active.id]: { ...s[active.id], step: index } }))
    },
    [active],
  )

  const handleExit = useCallback(
    (reason: ExitReason, index: number) => {
      const id = active?.id
      setActive(null)
      try {
        sessionStorage.removeItem(RESUME_KEY)
      } catch {
        /* ignore */
      }
      if (!id) return
      const now = new Date().toISOString()
      const patch =
        reason === 'completed'
          ? { completed_at: now, step: index, dismissed_at: null }
          : { dismissed_at: now, step: index }
      void saveTourProgress(id, patch).catch(() => {})
      setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }))

      // Offer the cleanup the moment the practice run ends — on a dismissal
      // too, not just a completion. Someone who bails halfway has MORE reason
      // to want the scratch project gone, not less.
      if (practiceRef.current && stampedRef.current.size > 0) {
        setCleanupFor([...stampedRef.current][0])
      }
      practiceRef.current = false
    },
    [active],
  )

  const handleChain = useCallback(() => {
    const tour = active ? getTour(active.id) : null
    const next = tour?.chainTo?.tourId
    // Finish the tour we're in before the next one starts, so the Guides page
    // shows Welcome as completed rather than abandoned at step 7.
    handleExit('completed', (tour?.steps.length ?? 1) - 1)
    // OFFER the next tour rather than launching it. A tour never just starts —
    // and the first-job offer is also where the practice-project choice lives,
    // which someone arriving down the chain would otherwise never be given.
    if (next) setTimeout(() => setOffering(next), 0)
  }, [active, handleExit])

  const api = useMemo<TourApi>(
    () => ({ state, loading, offerTour, startTour, restartTour, canSee }),
    [state, loading, offerTour, startTour, restartTour, canSee],
  )

  const activeTour = active ? getTour(active.id) : null
  const offeredTour = offering ? getTour(offering) : null

  return (
    <TourContext.Provider value={api}>
      {children}
      {canSee && offeredTour && (
        <TourOfferModal
          tour={offeredTour}
          onStart={() => startTour(offeredTour.id as TourId, 0, practiceMode)}
          onDecline={() => setOffering(null)}
          practice={
            offeredTour.id === 'first-job'
              ? { checked: practiceMode, onChange: setPracticeMode }
              : undefined
          }
        />
      )}
      {canSee && activeTour && (
        <TourRunner
          key={`${activeTour.id}-${active!.from}`}
          tour={activeTour}
          startIndex={active!.from}
          onStep={handleStep}
          onExit={handleExit}
          onChain={handleChain}
          onProjectSeen={handleProjectSeen}
        />
      )}
      {canSee && cleanupFor && (
        <PracticeCleanupPrompt projectId={cleanupFor} onClose={() => setCleanupFor(null)} />
      )}
    </TourContext.Provider>
  )
}
