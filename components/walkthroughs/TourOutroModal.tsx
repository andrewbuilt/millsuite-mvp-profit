'use client'

// ============================================================================
// TourOutroModal — the full stop at the end of a tour
// ============================================================================
// Opaque, like the offer modal that opened it, so finishing feels like an
// ending rather than the coach marks just stopping. It also absorbs the
// practice-project cleanup: two things popping up at once (a wrap-up card AND
// a "delete your practice job?" toast) is worse than one that says both.
// ============================================================================

import { useState } from 'react'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { deleteProject } from '@/lib/sales'
import type { Tour } from '@/lib/walkthroughs'

export default function TourOutroModal({
  tour,
  practiceIds,
  partial = false,
  onClose,
}: {
  tour: Tour
  /** Projects this run created as practice. Empty when the user opted out. */
  practiceIds: string[]
  /** The lesson's path gate is still false — the work didn't actually happen
   *  (a skipped save, a bailed form). Shows outroPartial: an honest "here's
   *  what's left" instead of a celebration the Guides page would contradict. */
  partial?: boolean
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const outro = partial && tour.outroPartial ? tour.outroPartial : tour.outro
  const isPartial = partial && !!tour.outroPartial
  const many = practiceIds.length > 1

  async function removePractice() {
    setBusy(true)
    setError(null)
    let failed = 0
    for (const id of practiceIds) {
      try {
        await deleteProject(id)
      } catch {
        failed++
      }
    }
    if (failed === 0) return onClose()
    setError(`Couldn't delete ${failed} of ${practiceIds.length}. Try again from Manage → Guides.`)
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-[9997] bg-[#111]/50 flex items-center justify-center p-4">
      <div
        className="w-full max-w-[440px] bg-white rounded-2xl shadow-2xl overflow-hidden"
        role="dialog"
        aria-label={outro?.title || 'Walkthrough complete'}
      >
        <div className="px-6 pt-6 pb-5">
          {/* Green check only when the work is really done; the partial state
              gets an amber mark so the visual can't out-claim the words. */}
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${
              isPartial ? 'bg-[#FFFBEB]' : 'bg-[#ECFDF5]'
            }`}
          >
            <CheckCircle2 className={`w-5 h-5 ${isPartial ? 'text-[#D97706]' : 'text-[#059669]'}`} />
          </div>
          <h2 className="text-[17px] font-semibold text-[#111] mb-1.5">
            {outro?.title || `${tour.title} complete`}
          </h2>
          <p className="text-[13px] text-[#6B7280] leading-relaxed">
            {outro?.body || 'You can rerun this any time from Manage → Guides.'}
          </p>

          {practiceIds.length > 0 && (
            <div className="mt-4 p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl">
              <p className="text-[12.5px] text-[#92400E] leading-relaxed">
                You built {many ? `${practiceIds.length} practice jobs` : 'a practice job'}.{' '}
                {many ? 'They stay' : 'It stays'} out of reports, capacity and your dashboard. Delete
                now, or keep {many ? 'them' : 'it'} as a template. Manage &rarr; Guides can remove{' '}
                {many ? 'them' : 'it'} later.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-3 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 bg-[#F9FAFB] border-t border-[#E5E7EB]">
          {practiceIds.length > 0 && (
            <button
              onClick={removePractice}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {busy ? 'Deleting…' : `Delete practice ${many ? 'jobs' : 'job'}`}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {practiceIds.length > 0 ? 'Keep it' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
