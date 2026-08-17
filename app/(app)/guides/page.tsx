'use client'

// ============================================================================
// /guides — Guides & walkthroughs (Manage → Guides)
// ============================================================================
// PATH + SHELF, not a flat menu (Andrew, 2026-08-12 restructure). The first
// build listed every tour as a peer, which read as a random menu — but the
// teaching is linear: you cannot price a job before the rate book has a
// material and a door style.
//
//   THE PATH  — ordered, state-gated, one obvious next action. A locked step
//               stays visible and says what opens it; hiding it would hide the
//               shape of the journey, which is the point of having one.
//   THE SHELF — screens, not sequence. No order, no gates, always there.
//
// The gates are FACTS, not attendance (/api/guides/path). Someone who set up
// their rate book without ever opening a guide has finished that step, and the
// page has to agree with them.
//
// Lives under Manage, not Settings: /settings is owner-only and a manager
// running the shop needs this at least as much as the owner does.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Compass, Lock, Play, RotateCcw, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { useTours } from '@/components/walkthroughs/TourProvider'
import {
  SHELF,
  canSeeTours,
  getTour,
  resolvePath,
  type PathStatus,
  type PathStepState,
  type TourId,
} from '@/lib/walkthroughs'
import { deleteAllPracticeData, listPracticeProjects, type PracticeProject } from '@/lib/practice'

export default function GuidesPage() {
  const { user, org } = useAuth()
  const { state, startTour, offerTour, restartTour, showWelcomeLoop } = useTours()
  const { confirm } = useConfirm()
  const allowed = canSeeTours(user?.role)

  const [status, setStatus] = useState<PathStatus | null>(null)
  const [loadingPath, setLoadingPath] = useState(true)
  const [practice, setPractice] = useState<PracticeProject[]>([])
  const [wiping, setWiping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPath = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/guides/path', {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      })
      if (res.ok) setStatus((await res.json()) as PathStatus)
    } catch {
      /* leave status null — the path renders with only step 1 open */
    } finally {
      setLoadingPath(false)
    }
  }, [])

  const refreshPractice = useCallback(async () => {
    if (!org?.id) return
    setPractice(await listPracticeProjects(org.id))
  }, [org?.id])

  useEffect(() => {
    void loadPath()
    void refreshPractice()
  }, [loadPath, refreshPractice])

  const path = useMemo(() => resolvePath(status), [status])
  const doneCount = path.filter((p) => p.complete).length
  // One obvious next action: the first step that's open and not finished.
  const nextUp = path.find((p) => !p.complete && !p.locked) ?? null

  function launch(tourId: TourId, fromStep: number) {
    // A fresh first-job run still goes through its offer modal — the offer is
    // the consent step and sets expectations for what the guide builds.
    if (tourId === 'first-job' && fromStep === 0) offerTour(tourId)
    else startTour(tourId, fromStep)
  }

  if (!allowed) {
    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <h1 className="text-[20px] font-semibold text-[#111] mb-2">Guides &amp; walkthroughs</h1>
        <p className="text-sm text-[#6B7280]">Your guide lives in the worker app, under My work.</p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <Compass className="w-5 h-5 text-[#2563EB]" />
        <h1 className="text-[20px] font-semibold text-[#111]">Guides &amp; walkthroughs</h1>
      </div>
      <p className="text-sm text-[#6B7280] mb-4">
        The path takes you from a blank shop to a paid job, in order. The shelf is there whenever
        you want it.
      </p>

      {/* The animated learning-loop moment, rerunnable. It plays once on first
          arrival; this is the only other way back to it. */}
      <button
        onClick={showWelcomeLoop}
        className="w-full flex items-center gap-3 mb-6 bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl px-4 py-3 text-left hover:border-[#2563EB] transition-colors"
      >
        <RotateCcw className="w-4 h-4 text-[#2563EB] flex-shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold text-[#111]">How MillSuite works</span>
          <span className="block text-[12px] text-[#6B7280]">
            The loop in 15 seconds: rates → estimate → track → review → smarter rates.
          </span>
        </span>
        <span className="text-[12px] font-semibold text-[#2563EB] flex-shrink-0">Watch</span>
      </button>

      {error && (
        <div className="mb-4 px-3.5 py-2.5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#B91C1C]">
          {error}
        </div>
      )}

      {/* ── THE PATH ────────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-[13px] font-semibold text-[#111] uppercase tracking-wider">The path</h2>
        <span className="text-[12px] text-[#6B7280] font-medium">
          {loadingPath ? 'Checking your shop…' : `${doneCount} of ${path.length} complete`}
        </span>
      </div>
      <div className="h-1.5 bg-[#E5E7EB] rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-[#059669] rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / path.length) * 100}%` }}
        />
      </div>

      <div className="space-y-2.5">
        {path.map((p) => (
          <PathCard
            key={p.step.key}
            state={p}
            isNext={nextUp?.step.key === p.step.key}
            tourProgressStep={p.step.tourId ? state[p.step.tourId]?.step ?? 0 : 0}
            tourStarted={!!(p.step.tourId && state[p.step.tourId]?.started_at)}
            onLaunch={launch}
            onRestart={async (tourId) => {
              setError(null)
              try {
                await restartTour(tourId)
              } catch {
                setError('Could not reset that guide. If this just deployed, the migration may still be pending.')
                return
              }
              launch(tourId, 0)
            }}
          />
        ))}
      </div>

      {/* ── PRACTICE DATA ───────────────────────────────────────────────── */}
      {practice.length > 0 && (
        <div className="mt-6 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[#92400E] mb-0.5">
              Practice data ({practice.length})
            </h2>
            <p className="text-[12.5px] text-[#92400E]/80 leading-relaxed">
              Left out of reports, capacity and your dashboard. Delete whenever you&rsquo;re done.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {practice.map((p) => (
                <span
                  key={p.id}
                  className="text-[11px] px-2 py-0.5 bg-white border border-[#FDE68A] rounded text-[#92400E]"
                >
                  {p.name}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete practice data?',
                message: `Permanently delete ${practice.length} practice project${
                  practice.length === 1 ? '' : 's'
                }. Their subprojects, estimate lines and notes go with them. This can't be undone.`,
                confirmLabel: 'Delete',
                variant: 'danger',
              })
              if (!ok || !org?.id) return
              setWiping(true)
              setError(null)
              try {
                const { failed } = await deleteAllPracticeData(org.id)
                if (failed > 0) setError(`Couldn't delete ${failed} of them. Try again.`)
                await refreshPractice()
                await loadPath()
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not delete practice data.')
              } finally {
                setWiping(false)
              }
            }}
            disabled={wiping}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#DC2626] rounded-lg hover:bg-[#B91C1C] transition-colors flex-shrink-0 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {wiping ? 'Deleting…' : 'Delete practice data'}
          </button>
        </div>
      )}

      {/* ── THE SHELF ───────────────────────────────────────────────────── */}
      <h2 className="text-[13px] font-semibold text-[#111] uppercase tracking-wider mt-8 mb-1">
        The shelf
      </h2>
      <p className="text-[12.5px] text-[#6B7280] mb-3">
        Single screens, in any order, whenever you need them.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SHELF.map((row) => (
          <div
            key={row.title}
            className="flex items-start gap-2.5 bg-white border border-[#E5E7EB] rounded-xl px-3.5 py-3 opacity-60"
          >
            <Lock className="w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-[#6B7280]">{row.title}</div>
              <div className="text-[11.5px] text-[#9CA3AF] leading-snug">{row.summary}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PathCard({
  state,
  isNext,
  tourProgressStep,
  tourStarted,
  onLaunch,
  onRestart,
}: {
  state: PathStepState
  isNext: boolean
  tourProgressStep: number
  tourStarted: boolean
  onLaunch: (tourId: TourId, fromStep: number) => void
  onRestart: (tourId: TourId) => void
}) {
  const { step, index, complete, locked, blockedBy } = state
  const tour = step.tourId ? getTour(step.tourId) : null
  const total = tour?.steps.length ?? 0
  const inProgress = tourStarted && !complete && tourProgressStep > 0 && tourProgressStep < total

  return (
    <div
      className={`rounded-xl border p-4 transition-colors ${
        complete
          ? 'bg-white border-[#E5E7EB]'
          : locked
            ? 'bg-[#F9FAFB] border-[#E5E7EB]'
            : isNext
              ? 'bg-white border-[#2563EB] shadow-sm'
              : 'bg-white border-[#E5E7EB]'
      }`}
    >
      <div className="flex items-start gap-3.5">
        {/* Step number / state */}
        <div
          className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-semibold ${
            complete
              ? 'bg-[#ECFDF5] text-[#059669]'
              : locked
                ? 'bg-[#F3F4F6] text-[#9CA3AF]'
                : 'bg-[#EFF6FF] text-[#2563EB]'
          }`}
        >
          {complete ? <CheckCircle2 className="w-4 h-4" /> : locked ? <Lock className="w-3.5 h-3.5" /> : index + 1}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className={`text-[15px] font-semibold ${locked ? 'text-[#9CA3AF]' : 'text-[#111]'}`}
            >
              {step.title}
            </h3>
            {isNext && !complete && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#2563EB] bg-[#EFF6FF] px-1.5 py-0.5 rounded">
                Next up
              </span>
            )}
            {complete && (
              <span className="text-[11px] font-semibold text-[#059669]">Complete</span>
            )}
          </div>

          <p className={`text-[13px] leading-relaxed mt-0.5 ${locked ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`}>
            {step.blurb}
          </p>

          {/* Why it's locked, and what opens it — never a dead end. */}
          {locked && blockedBy && (
            <p className="text-[12px] text-[#9CA3AF] mt-1.5">
              Opens once you finish <span className="font-medium text-[#6B7280]">{blockedBy.title}</span>.
            </p>
          )}

          {/* What "done" means, so completion is never mysterious. */}
          <p className="text-[11.5px] text-[#9CA3AF] mt-1.5">
            {complete ? '✓ ' : ''}
            {step.doneWhen}
            {tour && ` · ${total}-step guide`}
            {inProgress && (
              <span className="text-[#2563EB]"> · guide in progress, step {tourProgressStep + 1} of {total}</span>
            )}
          </p>
        </div>

        {/* Action */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!locked && tour && (
            <>
              {(complete || inProgress) && (
                <button
                  onClick={() => onRestart(tour.id)}
                  title="Start the guide over"
                  className="inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] rounded-lg transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => onLaunch(tour.id, inProgress ? tourProgressStep : 0)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
                  complete
                    ? 'text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6]'
                    : 'text-white bg-[#2563EB] hover:bg-[#1D4ED8]'
                }`}
              >
                <Play className="w-3.5 h-3.5" />
                {inProgress ? 'Resume' : complete ? 'Replay' : 'Start'}
              </button>
            </>
          )}
          {!locked && !tour && (
            <span className="text-[11px] text-[#9CA3AF] whitespace-nowrap px-2">
              Guide coming soon
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
