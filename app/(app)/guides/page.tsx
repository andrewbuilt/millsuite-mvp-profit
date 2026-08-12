'use client'

// ============================================================================
// /guides — Guides & walkthroughs (Manage → Guides)
// ============================================================================
// Lives under Manage, not Settings: /settings is owner-only, and a manager
// running the shop needs the walkthroughs at least as much as the owner does.
// Settings carries a pointer card to here so both routes lead somewhere.
//
// One card per tour — what it covers, how long, and where you left off. The
// v2/v3 tours from the spec catalog are listed greyed rather than hidden: a new
// owner should be able to see that the rest of the system is mapped, not
// missing.
// ============================================================================

import { useMemo } from 'react'
import { CheckCircle2, Compass, Lock, Play, RotateCcw } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useTours } from '@/components/walkthroughs/TourProvider'
import { COMING_SOON, TOURS, canSeeTours, type Tour, type TourId } from '@/lib/walkthroughs'
import type { TourProgress } from '@/lib/me-progress'

type Status =
  | { kind: 'not-started' }
  | { kind: 'in-progress'; step: number }
  | { kind: 'completed' }

function statusOf(p: TourProgress | undefined, total: number): Status {
  if (!p) return { kind: 'not-started' }
  if (p.completed_at) return { kind: 'completed' }
  // A dismissed tour is in progress, not abandoned — the whole point of
  // recording the step is that Resume picks it back up.
  if (typeof p.step === 'number' && p.step > 0 && p.step < total) {
    return { kind: 'in-progress', step: p.step }
  }
  if (p.started_at && !p.completed_at) return { kind: 'in-progress', step: p.step ?? 0 }
  return { kind: 'not-started' }
}

export default function GuidesPage() {
  const { user } = useAuth()
  const { state, loading, startTour, restartTour } = useTours()
  const allowed = canSeeTours(user?.role)

  const cards = useMemo(
    () => TOURS.map((tour) => ({ tour, status: statusOf(state[tour.id], tour.steps.length) })),
    [state],
  )

  if (!allowed) {
    return (
      <div className="p-6 max-w-[900px] mx-auto">
        <h1 className="text-[20px] font-semibold text-[#111] mb-2">Guides &amp; walkthroughs</h1>
        <p className="text-sm text-[#6B7280]">
          Your guide lives in the worker app, under My work.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="flex items-center gap-2.5 mb-1">
        <Compass className="w-5 h-5 text-[#2563EB]" />
        <h1 className="text-[20px] font-semibold text-[#111]">Guides &amp; walkthroughs</h1>
      </div>
      <p className="text-sm text-[#6B7280] mb-6">
        Short guided tours of the app. Start one any time — you can quit partway and pick it back
        up here.
      </p>

      <div className="space-y-3">
        {cards.map(({ tour, status }) => (
          <TourCard
            key={tour.id}
            tour={tour}
            status={status}
            loading={loading}
            onStart={(fromStep) => startTour(tour.id as TourId, fromStep)}
            onRestart={async () => {
              await restartTour(tour.id as TourId)
              startTour(tour.id as TourId, 0)
            }}
          />
        ))}
      </div>

      <div className="mt-8">
        <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2.5">
          Coming soon
        </div>
        <div className="space-y-2">
          {COMING_SOON.map((row) => (
            <div
              key={row.title}
              className="flex items-center gap-3 bg-white border border-[#E5E7EB] rounded-xl px-4 py-3 opacity-60"
            >
              <Lock className="w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#6B7280] truncate">{row.title}</div>
                <div className="text-xs text-[#9CA3AF] truncate">{row.summary}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TourCard({
  tour,
  status,
  loading,
  onStart,
  onRestart,
}: {
  tour: Tour
  status: Status
  loading: boolean
  onStart: (fromStep: number) => void
  onRestart: () => void
}) {
  const total = tour.steps.length

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <h2 className="text-[15px] font-semibold text-[#111]">{tour.title}</h2>
          {status.kind === 'completed' && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#059669]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Completed
            </span>
          )}
        </div>
        <p className="text-[13px] text-[#6B7280] leading-relaxed">{tour.summary}</p>
        <div className="text-[11px] text-[#9CA3AF] mt-1.5 font-medium">
          {total} steps · about {tour.minutes} min
          {status.kind === 'in-progress' && (
            <span className="text-[#2563EB]">
              {' '}
              · In progress, step {Math.min(status.step + 1, total)} of {total}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {status.kind !== 'not-started' && (
          <button
            onClick={onRestart}
            disabled={loading}
            title="Start over from step 1"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] rounded-lg transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restart
          </button>
        )}
        <button
          onClick={() => onStart(status.kind === 'in-progress' ? status.step : 0)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
        >
          <Play className="w-3.5 h-3.5" />
          {status.kind === 'in-progress' ? 'Resume' : status.kind === 'completed' ? 'Run again' : 'Start'}
        </button>
      </div>
    </div>
  )
}
