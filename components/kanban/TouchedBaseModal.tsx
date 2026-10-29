'use client'

// ============================================================================
// TouchedBaseModal — the one-click attention-clock reset (lib/attention-data).
// ============================================================================
// Logs a "Touched base" timeline event (who/when + an optional one-line note)
// and resets the card's ring. Enter saves; the note is optional, so a bare
// Enter is the one-click path.
// ============================================================================

import { useState } from 'react'
import { recordTouchedBase } from '@/lib/attention-data'
import type { LastTouch } from '@/lib/attention'

export default function TouchedBaseModal({
  orgId,
  userId,
  project,
  onClose,
  onDone,
}: {
  orgId: string
  userId?: string | null
  project: { id: string; name: string }
  onClose: () => void
  onDone: (touch: LastTouch) => void
}) {
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (saving) return
    setSaving(true)
    const touch = await recordTouchedBase({ orgId, projectId: project.id, note, actorUserId: userId })
    setSaving(false)
    onDone(touch)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white border border-[#E5E7EB] rounded-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Touched base</div>
        <div className="text-base font-semibold text-[#111] truncate">{project.name}</div>
        <div className="mt-1 text-[12px] text-[#6B7280]">
          Resets the card’s clock and adds a line to the project timeline. Note is optional.
        </div>
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') onClose()
          }}
          placeholder="Called — waiting on their designer."
          className="mt-3 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111]">
            Cancel
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="px-4 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Touched base (↩)'}
          </button>
        </div>
      </div>
    </div>
  )
}
