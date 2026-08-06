'use client'

// ============================================================================
// SaveStatus — the visible half of `useAutosave`.
// ============================================================================
// Autosaving quietly is fine right up until it isn't: the user has no way to
// tell "saved" from "silently dropped." This renders the hook's state inline,
// and gives a Save-now / Retry button whenever there's something outstanding.
// ============================================================================

import type { Autosave } from '@/hooks/use-autosave'

export default function SaveStatus({
  save,
  className = '',
}: {
  save: Autosave
  className?: string
}) {
  const { status, error, saveNow } = save
  if (status === 'idle') return null

  if (status === 'error') {
    return (
      <span className={`inline-flex items-center gap-2 text-[11px] ${className}`}>
        <span className="text-[#B91C1C]" title={error ?? undefined}>
          Not saved — {error ?? 'the save failed'}
        </span>
        <button
          onClick={saveNow}
          className="px-2 py-0.5 rounded-md border border-[#FCA5A5] text-[#B91C1C] hover:bg-[#FEF2F2] transition-colors"
        >
          Retry
        </button>
      </span>
    )
  }

  if (status === 'unsaved') {
    return (
      <span className={`inline-flex items-center gap-2 text-[11px] ${className}`}>
        <span className="text-[#B45309]">Unsaved changes</span>
        <button
          onClick={saveNow}
          className="px-2 py-0.5 rounded-md border border-[#E5E7EB] text-[#374151] hover:bg-[#F9FAFB] transition-colors"
        >
          Save now
        </button>
      </span>
    )
  }

  return (
    <span className={`text-[11px] text-[#9CA3AF] ${className}`}>
      {status === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  )
}
