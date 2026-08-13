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
import { loadProjectIds, markProjectAsPractice } from '@/lib/practice'
import TourRunner, { type ExitReason } from './TourRunner'
import TourOfferModal from './TourOfferModal'
import PracticeCleanupPrompt from './PracticeCleanupPrompt'
import TourOutroModal from './TourOutroModal'

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
  /** The project a running tour is working in, so its kanban card can tag
   *  itself as the thing the final step points at. Null when no tour is
   *  running or it hasn't reached a project yet. */
  tourProjectId: string | null
}

const TourContext = createContext<TourApi>({
  state: {},
  loading: true,
  offerTour: () => {},
  startTour: () => {},
  restartTour: async () => {},
  canSee: false,
  tourProjectId: null,
})

export function useTours() {
  return useContext(TourContext)
}

export default function TourProvider({ children }: { children: React.ReactNode }) {
  const { user, org } = useAuth()
  const pathname = usePathname()
  const [state, setState] = useState<WalkthroughState>({})
  const [loading, setLoading] = useState(true)
  const [onboardedAt, setOnboardedAt] = useState<string | null>(null)
  const [offering, setOffering] = useState<TourId | null>(null)
  const [active, setActive] = useState<{ id: TourId; from: number } | null>(null)
  const autoOfferedRef = useRef(false)

  // Practice mode. Default on for the first-job tour: someone learning the app
  // shouldn't have to decide up front whether their first attempt is worth
  // keeping. Held in refs as well as state because the project-seen callback
  // fires from inside the runner, outside this render.
  const [practiceMode, setPracticeMode] = useState(true)
  const practiceRef = useRef(false)
  const stampedRef = useRef<Set<string>>(new Set())
  const [cleanupFor, setCleanupFor] = useState<string[]>([])
  const [outroFor, setOutroFor] = useState<{ tourId: TourId; practiceIds: string[] } | null>(null)
  const [tourProjectId, setTourProjectId] = useState<string | null>(null)

  // Every project that existed when this practice run started. Nothing in it
  // may EVER be stamped.
  //
  // This is the guard that makes the feature safe. The runner reports projects
  // by watching the URL, and a user can reach a real project from inside the
  // tour in several ordinary ways — the last step spotlights the whole kanban
  // board and tells them to drag a card, the project-home step spotlights the
  // whole page including its back link. Without this snapshot, one stray click
  // silently marks a live job as practice: it drops out of reports, capacity
  // and the dashboard, and nothing in the app un-stamps it.
  //
  // null means "we don't know what was here before" — after a reload, or when
  // resuming from Guides. In that state we stamp NOTHING. Failing to badge a
  // practice project is a cosmetic miss the user can fix from Guides; wrongly
  // badging a real job is data loss they'd have no way to spot.
  const knownProjectsRef = useRef<Set<string> | null>(null)

  // startTour and the runner's mount both want to record the opening step, and
  // the progress write is a read-modify-write on one jsonb blob with no
  // compare-and-set — firing both in the same tick lets the loser's fields
  // (started_at, the cleared completed_at) get dropped. startTour's write is
  // the richer one, so the runner's opening echo is skipped.
  const skipFirstStepWriteRef = useRef(false)

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
      // Practice only means anything for the tour that creates a project, and
      // only from the top — resuming mid-tour can't know what was already
      // there, so it runs without stamping (see knownProjectsRef).
      const wantsPractice = id === 'first-job' && fromStep === 0 && (practice ?? practiceMode)
      practiceRef.current = wantsPractice
      stampedRef.current = new Set()
      knownProjectsRef.current = null
      skipFirstStepWriteRef.current = true
      setTourProjectId(null)
      setOutroFor(null)
      if (wantsPractice && org?.id) {
        void loadProjectIds(org.id).then((ids) => {
          knownProjectsRef.current = ids // null on failure → stamps nothing
        })
      }
      setOffering(null)
      setActive({ id, from: fromStep })
      void saveTourProgress(id, {
        started_at: new Date().toISOString(),
        step: fromStep,
        // A re-run has to clear the old outcome, or the Guides card keeps
        // reading "Completed" and can never be resumed again.
        completed_at: null,
        dismissed_at: null,
      }).catch(() => {})
    },
    [practiceMode, org?.id],
  )

  // The tour walks the user into a project it didn't create and can't name in
  // advance — this is where it learns which one. Stamps ONLY projects that did
  // not exist when the run began.
  const handleProjectSeen = useCallback((projectId: string) => {
    setTourProjectId((cur) => (cur === projectId ? cur : projectId))
    if (!practiceRef.current) return
    const known = knownProjectsRef.current
    if (!known) return // snapshot missing or still loading — never guess
    if (known.has(projectId)) return // pre-existing, i.e. real work
    if (stampedRef.current.has(projectId)) return
    stampedRef.current.add(projectId)
    void markProjectAsPractice(projectId)
  }, [])

  const offerTour = useCallback((id: TourId) => {
    setActive(null)
    setOffering(id)
  }, [])

  const restartTour = useCallback(
    async (id: TourId) => {
      // Deliberately NOT a full reset: offered_at records that the automatic
      // one-shot offer has been spent. Wiping it would make the welcome tour
      // ambush the user again on their next page load, days after they chose
      // to replay it themselves.
      const offeredAt = state[id]?.offered_at ?? null
      await resetTourProgress(id)
      if (offeredAt) await saveTourProgress(id, { offered_at: offeredAt }).catch(() => {})
      setState((s) => ({ ...s, [id]: offeredAt ? { offered_at: offeredAt } : {} }))
    },
    [state],
  )

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
      if (skipFirstStepWriteRef.current) {
        skipFirstStepWriteRef.current = false
        return
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

      const practiceIds = practiceRef.current ? [...stampedRef.current] : []
      const tour = getTour(id)
      if (reason === 'completed' && tour?.outro) {
        // A finished tour gets an opaque full stop, and it absorbs the practice
        // cleanup — a wrap-up card AND a separate "delete your practice job?"
        // toast firing together is worse than one that says both.
        setOutroFor({ tourId: id, practiceIds })
      } else if (practiceIds.length > 0) {
        // Bailed out. Someone who quits halfway has MORE reason to want the
        // scratch project gone, not less.
        setCleanupFor(practiceIds)
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
    () => ({ state, loading, offerTour, startTour, restartTour, canSee, tourProjectId }),
    [state, loading, offerTour, startTour, restartTour, canSee, tourProjectId],
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
      {canSee && cleanupFor.length > 0 && (
        <PracticeCleanupPrompt projectIds={cleanupFor} onClose={() => setCleanupFor([])} />
      )}
      {canSee && outroFor && getTour(outroFor.tourId) && (
        <TourOutroModal
          tour={getTour(outroFor.tourId)!}
          practiceIds={outroFor.practiceIds}
          onClose={() => setOutroFor(null)}
        />
      )}
    </TourContext.Provider>
  )
}
