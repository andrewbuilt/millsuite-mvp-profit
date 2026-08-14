'use client'

// ============================================================================
// PracticeCleanupPrompt — "you just made a practice job, want it gone?"
// ============================================================================
// Shown when a practice run of the first-job tour ends, whether it finished or
// was abandoned. Keeping it is a real option: the estimate was priced off the
// shop's actual rate book, so it's a perfectly good template — it just carries
// a Practice badge and stays out of every number until someone decides
// otherwise.
// ============================================================================

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { deleteProject } from '@/lib/sales'

export default function PracticeCleanupPrompt({
  projectIds,
  onClose,
}: {
  /** Everything this run stamped — usually one, but a user who starts over
   *  mid-tour can create more than one, and leaving the extras un-offered
   *  would strand them as practice with no prompt. */
  projectIds: string[]
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    const failed: string[] = []
    for (const id of projectIds) {
      // Keep going after a failure — one project refusing to delete shouldn't
      // silently leave the rest behind.
      try {
        await deleteProject(id)
      } catch {
        failed.push(id)
      }
    }
    if (failed.length === 0) return onClose()
    setError(
      `Couldn't delete ${failed.length} of ${projectIds.length}. Try again from Manage → Guides.`,
    )
    setBusy(false)
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9996] w-[min(92vw,440px)] bg-white border border-[#E5E7EB] rounded-2xl shadow-2xl p-4">
      <h3 className="text-[14px] font-semibold text-[#111] mb-1">
        {projectIds.length > 1 ? `That was practice (${projectIds.length} projects)` : 'That was a practice job'}
      </h3>
      <p className="text-[12.5px] text-[#6B7280] leading-relaxed">
        {projectIds.length > 1 ? 'They\u2019re' : 'It\u2019s'} badged Practice and stay{projectIds.length > 1 ? '' : 's'} out of
        reports, capacity and your dashboard. Delete now, or keep as a template. You can remove
        {projectIds.length > 1 ? ' them' : ' it'} any time from Manage &rarr; Guides.
      </p>
      {error && (
        <div className="mt-2.5 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] rounded-lg text-xs text-[#B91C1C]">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-3.5">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-3 py-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] rounded-lg transition-colors disabled:opacity-50"
        >
          Keep it
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#DC2626] rounded-lg hover:bg-[#B91C1C] transition-colors disabled:opacity-50"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {busy ? 'Deleting…' : 'Delete practice data'}
        </button>
      </div>
    </div>
  )
}
