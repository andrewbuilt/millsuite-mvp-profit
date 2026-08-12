'use client'

// ============================================================================
// TourOfferModal — the opt-in. A tour never just starts.
// ============================================================================
// Says what it covers, how long it runs, how many steps, and offers a way out
// that means it. "Not now" is not a snooze: the tour stops offering itself and
// waits in Manage → Guides until it's asked for.
// ============================================================================

import { Compass, X } from 'lucide-react'
import type { Tour } from '@/lib/walkthroughs'

export default function TourOfferModal({
  tour,
  onStart,
  onDecline,
  practice,
}: {
  tour: Tour
  onStart: () => void
  onDecline: () => void
  /** Offered by the first-job tour: run on a throwaway project instead of real
   *  work. Opt-out rather than opt-in — someone learning the app shouldn't have
   *  to decide up front whether their first attempt is worth keeping. */
  practice?: { checked: boolean; onChange: (v: boolean) => void }
}) {
  return (
    <div
      className="fixed inset-0 z-[9997] bg-[#111]/50 flex items-center justify-center p-4"
      onClick={onDecline}
    >
      <div
        className="w-full max-w-[420px] bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={tour.offer.title}
      >
        <div className="px-6 pt-6 pb-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-[#EFF6FF] flex items-center justify-center flex-shrink-0">
              <Compass className="w-4.5 h-4.5 text-[#2563EB]" />
            </div>
            <button
              onClick={onDecline}
              className="p-1 -mt-1 -mr-1 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <h2 className="text-[17px] font-semibold text-[#111] mb-1.5">{tour.offer.title}</h2>
          <p className="text-[13px] text-[#6B7280] leading-relaxed">{tour.offer.body}</p>
          <div className="mt-3 text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wider">
            {tour.steps.length} steps · about {tour.minutes} min
          </div>

          {practice && (
            <label className="mt-4 flex items-start gap-2.5 p-3 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl cursor-pointer">
              <input
                type="checkbox"
                checked={practice.checked}
                onChange={(e) => practice.onChange(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#2563EB] flex-shrink-0"
              />
              <span className="text-[12px] text-[#374151] leading-relaxed">
                <span className="font-medium text-[#111]">Make this a practice job.</span> It gets
                a Practice badge and stays out of reports, capacity and the dashboard. Delete it in
                one click when you&rsquo;re done. Uncheck to run the tour on a job you&rsquo;re
                really bidding.
              </span>
            </label>
          )}
        </div>
        <div className="flex justify-end gap-2 px-6 py-4 bg-[#F9FAFB] border-t border-[#E5E7EB]">
          <button
            onClick={onDecline}
            className="px-3.5 py-2 text-sm font-medium text-[#6B7280] hover:text-[#111] rounded-lg transition-colors"
          >
            Not now
          </button>
          <button
            onClick={onStart}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] transition-colors"
          >
            Start
          </button>
        </div>
      </div>
    </div>
  )
}
