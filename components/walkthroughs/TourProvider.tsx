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
import { supabase } from '@/lib/supabase'
import { canSeeTours, getTour, type PathStatus, type TourId } from '@/lib/walkthroughs'
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
import WelcomeLoop from './WelcomeLoop'

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
  /** Replay the animated learning-loop moment (Guides: "How MillSuite works"). */
  showWelcomeLoop: () => void
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
  showWelcomeLoop: () => {},
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
  // The animated learning-loop moment. `replay` softens the buttons when it's
  // rerun from Guides rather than shown on first arrival.
  const [loop, setLoop] = useState<{ replay: boolean } | null>(null)
  const autoOfferedRef = useRef(false)

  // Practice mode — RETIRED from the offer (Andrew, 2026-08-14): the guide's
  // copy now says projects are easy to edit and delete, so the up-front
  // "practice project?" decision is gone. The stamping/cleanup machinery
  // below stays dormant (previously stamped projects keep their badge and
  // their Guides-page delete), so this is a constant, not state.
  const practiceMode = false
  const practiceRef = useRef(false)
  const stampedRef = useRef<Set<string>>(new Set())
  const [cleanupFor, setCleanupFor] = useState<string[]>([])
  const [outroFor, setOutroFor] = useState<{
    tourId: TourId
    practiceIds: string[]
    /** The lesson's path gate came back false — the work isn't actually done,
     *  so the modal shows outroPartial instead of the celebration. */
    partial: boolean
  } | null>(null)
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
  // v2: the animated learning-loop moment IS the offer — its final frame
  // carries "Show me around" / "I'll explore". Same one-shot rule as the old
  // modal: offered_at stamps when it's SHOWN, so closing the tab counts.
  useEffect(() => {
    if (loading || !canSee || active || offering || loop || autoOfferedRef.current) return
    if (!onboardedAt) return // setup wizard still has the floor
    if (state.welcome?.offered_at) return // already had its one shot
    autoOfferedRef.current = true
    setLoop({ replay: false })
    void saveTourProgress('welcome', { offered_at: new Date().toISOString() })
      .then(() => setState((s) => ({ ...s, welcome: { ...s.welcome, offered_at: new Date().toISOString() } })))
      .catch(() => {})
  }, [loading, canSee, active, offering, loop, onboardedAt, state.welcome?.offered_at])

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

  const showWelcomeLoop = useCallback(() => {
    setActive(null)
    setOffering(null)
    setLoop({ replay: true })
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
        //
        // LESSONS verify before celebrating: completion is a fact, never
        // attendance (the same rule the Path lives by). If the gate says the
        // work isn't there — a skipped save, a bailed form — the modal tells
        // the truth instead. A failed fetch defaults to the celebration:
        // following the lesson honestly guarantees the facts, so a network
        // blip shouldn't scold someone who did the work.
        const gate = tour.gate
        if (gate && tour.outroPartial) {
          void (async () => {
            let partial = false
            try {
              const { data: { session } } = await supabase.auth.getSession()
              const res = await fetch('/api/guides/path', {
                headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
              })
              if (res.ok) {
                const status = (await res.json()) as PathStatus
                partial = !status[gate]
              }
            } catch {
              /* default to the full outro */
            }
            setOutroFor({ tourId: id, practiceIds, partial })
          })()
        } else {
          setOutroFor({ tourId: id, practiceIds, partial: false })
        }
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
    // OFFER the next tour rather than launching it — a tour never just starts.
    if (next) setTimeout(() => setOffering(next), 0)
  }, [active, handleExit])

  const api = useMemo<TourApi>(
    () => ({ state, loading, offerTour, startTour, restartTour, showWelcomeLoop, canSee, tourProjectId }),
    [state, loading, offerTour, startTour, restartTour, showWelcomeLoop, canSee, tourProjectId],
  )

  const activeTour = active ? getTour(active.id) : null
  const offeredTour = offering ? getTour(offering) : null

  return (
    <TourContext.Provider value={api}>
      {children}
      {canSee && loop && (
        <WelcomeLoop
          replay={loop.replay}
          onStart={() => {
            setLoop(null)
            startTour('welcome')
          }}
          onDismiss={() => setLoop(null)}
        />
      )}
      {canSee && offeredTour && (
        <TourOfferModal
          tour={offeredTour}
          onStart={() => startTour(offeredTour.id as TourId, 0, practiceMode)}
          onDecline={() => setOffering(null)}
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
          partial={outroFor.partial}
          onClose={() => setOutroFor(null)}
        />
      )}
    </TourContext.Provider>
  )
}
