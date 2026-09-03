'use client'

// ============================================================================
// StageStrip — the 5-node lifecycle strip at the top of a project.
// ============================================================================
// Lives here rather than in the project page for the same reason StagePill
// does: Next.js forbids extra named exports from a page file, so anything that
// needs rendering against fixtures has to be a real module. This one earns it
// — the production node draws a tracked-vs-estimated bar, and a bar is exactly
// the kind of thing that must be looked at, not compile-checked.
// ============================================================================

import type { ProjectStage } from '@/lib/types'
import { fmtActualHours } from '@/lib/actual-hours'
import { COVER_STAGE_ORDER, COVER_STAGE_LABEL, coverStageOf } from './StagePill'

/** Estimated hours stay decimal — see the note on fmtActualHours. */
function hoursFmt(n: number): string {
  return `${(Math.round(n * 10) / 10).toFixed(1)}h`
}

export default function StageStrip({
  stage,
  soldGateMet,
  production,
}: {
  stage: ProjectStage
  /** When true AND the current cover stage is 'sold', the Sold pip
   *  renders with a green check + emerald tone (same treatment as
   *  completed stages) instead of the active blue. The actual stage
   *  doesn't change — it stays 'sold' until the operator advances —
   *  this is a purely visual "you're cleared to move to Production"
   *  signal. Connector to the next pip is unchanged. */
  soldGateMet?: boolean
  /** Tracked vs estimated for the WHOLE project. Only read while the cover
   *  stage is 'production' — that's the only time "how far through the shop
   *  hours are we" is the question the strip should answer. Wave-3 item 4. */
  production?: { actualMinutes: number; estimatedHours: number }
}) {
  const cover = coverStageOf(stage)
  if (cover === 'lost') {
    return (
      <div className="px-8 py-4 bg-[#FEF2F2] border-b border-[#FECACA] text-center text-sm text-[#991B1B]">
        This project was marked lost. It stays on the pipeline for history but no further actions apply.
      </div>
    )
  }
  const currentIdx = COVER_STAGE_ORDER.indexOf(cover)

  // Progress is only meaningful with an estimate to measure against — an
  // unestimated project would otherwise render a permanently full (or
  // divide-by-zero) bar, which reads as "done" rather than "unknown". No
  // estimate ⇒ the node renders exactly as it always did.
  const estHours = production?.estimatedHours ?? 0
  const showProgress = cover === 'production' && estHours > 0
  const actualHours = (production?.actualMinutes ?? 0) / 60
  const pct = showProgress ? (actualHours / estHours) * 100 : 0
  const over = pct > 100

  return (
    /* data-tour: the sell-it guide's intro and closer both point at this
       strip — the "where is my job in its life" view. */
    <div data-tour="project-status" className="px-8 py-4 bg-white border-b border-[#E5E7EB]">
      <div className="max-w-[1240px] mx-auto flex items-center gap-3">
        {COVER_STAGE_ORDER.map((s, i) => {
          const isDone = i < currentIdx
          const isCurrent = i === currentIdx
          // Sold pip green-checks when the gate clears, even though the
          // stage hasn't advanced. Treat it as "done-styled, current"
          // for the dot; keep the connector logic alone so Production
          // doesn't look active.
          const isGateGreen = !!soldGateMet && s === 'sold' && isCurrent
          const isProgressNode = showProgress && s === 'production'
          return (
            <div
              key={s}
              className={
                'flex items-center gap-3 last:flex-none ' +
                // The active production node takes more of the strip so the
                // bar has room to be readable. Everything else keeps flex-1,
                // so the strip stays balanced and centred.
                (isProgressNode ? 'flex-[2.5]' : 'flex-1')
              }
            >
              <div className={'flex items-center gap-2.5 ' + (isProgressNode ? 'flex-1 min-w-0' : '')}>
                <div
                  className={
                    'w-6 h-6 rounded-full border-[1.5px] flex items-center justify-center text-[10px] font-bold ' +
                    (isGateGreen
                      ? 'border-[#059669] bg-[#D1FAE5] text-[#065F46]'
                      : isCurrent
                      ? 'border-[#2563EB] bg-[#DBEAFE] text-[#1E40AF]'
                      : isDone
                      ? 'border-[#059669] bg-[#D1FAE5] text-[#065F46]'
                      : 'border-[#D1D5DB] bg-white text-[#9CA3AF]')
                  }
                >
                  {isDone || isGateGreen ? '✓' : i + 1}
                </div>
                <div
                  className={
                    'text-xs ' +
                    (isProgressNode ? 'flex-1 min-w-0 ' : '') +
                    (isGateGreen
                      ? 'text-[#059669] font-semibold'
                      : isCurrent
                      ? 'text-[#111] font-semibold'
                      : isDone
                      ? 'text-[#059669]'
                      : 'text-[#9CA3AF]')
                  }
                >
                  {COVER_STAGE_LABEL[s]}
                  {isGateGreen && (
                    <span className="ml-1.5 text-[10px] font-normal text-[#059669]">
                      · ready
                    </span>
                  )}
                  {isProgressNode && (
                    <span
                      className={
                        'ml-1.5 text-[10px] font-normal ' +
                        (over ? 'text-[#B91C1C]' : 'text-[#6B7280]')
                      }
                    >
                      · {Math.round(pct)}%{over ? ' — over estimate' : ''}
                    </span>
                  )}
                  {isProgressNode && (
                    <div
                      className="mt-1 h-[5px] rounded-full bg-[#E5E7EB] overflow-hidden"
                      title={`${fmtActualHours(production!.actualMinutes)} tracked against ${hoursFmt(estHours)} estimated`}
                    >
                      {/* Width caps at 100 so an overrun can't paint outside
                          the track; the red tone is what says "over", not a
                          longer bar. */}
                      <div
                        className={'h-full rounded-full ' + (over ? 'bg-[#DC2626]' : 'bg-[#2563EB]')}
                        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
              {i < COVER_STAGE_ORDER.length - 1 && (
                <div
                  className={
                    'flex-1 h-[2px] ' +
                    (i < currentIdx ? 'bg-[#059669]' : 'bg-[#E5E7EB]')
                  }
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
