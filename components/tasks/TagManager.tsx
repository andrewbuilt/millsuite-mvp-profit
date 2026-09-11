'use client'

// ============================================================================
// TagManager — rename / recolour / delete the org's task tags.
// ============================================================================
// A small popover rather than a settings page: a shop has a handful of tags
// and sending someone to /settings to rename one is a worse answer than a
// panel that opens where the tags already are.
//
// ⛔ THE RENAME WARNING IS NOT DECORATION. Tasks store tag NAMES (migration
// 098), so renaming here does NOT rewrite the tasks already carrying the old
// name — they keep it and fall back to the neutral swatch. That is a genuine,
// deliberate v1 limitation, and the one way it turns into a support problem is
// if nobody is told. So the UI says it, at the moment of renaming, in words.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { Check, Trash2, X } from 'lucide-react'
import { TASK_TAG_COLORS, type TaskTag } from '@/lib/tasks'

/** A registry row plus the name it had when the popover opened, so a rename
 *  can be detected without relying on array position. */
interface DraftTag extends TaskTag {
  origName: string
}

const toDraft = (t: TaskTag): DraftTag => ({ ...t, origName: t.name })

export function TagManager({
  tags,
  onSave,
  onClose,
  triggerRef,
}: {
  tags: TaskTag[]
  onSave: (next: TaskTag[]) => Promise<void>
  onClose: () => void
  /** The button that opened this. ⛔ Without it the gear can never CLOSE the
   *  popover: mousedown fires click-away → closed, then the button's own click
   *  toggles it straight back open. */
  triggerRef?: React.RefObject<HTMLElement | null>
}) {
  // Each row remembers the name it STARTED with. Comparing against the
  // incoming array by index looked equivalent and isn't: delete a tag and
  // every row below it shifts, so untouched tags read as renamed and the
  // warning fires for no reason.
  const [draft, setDraft] = useState<DraftTag[]>(() => tags.map(toDraft))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => setDraft(tags.map(toDraft)), [tags])

  // Click-away closes. A popover you can't dismiss by looking elsewhere is a
  // modal wearing a disguise.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (ref.current?.contains(t)) return
      // The trigger handles its own toggle — treating its mousedown as
      // click-away would close and immediately reopen.
      if (triggerRef?.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose, triggerRef])

  const renamed = draft.some((d) => d.name.trim() !== d.origName)

  async function commit() {
    // A rename that collides with another tag would silently merge two tags
    // into one on the next normalize pass — refuse instead.
    const names = draft.map((d) => d.name.trim().toLowerCase()).filter(Boolean)
    if (new Set(names).size !== names.length) {
      setError('Two tags have the same name.')
      return
    }
    if (draft.some((d) => !d.name.trim())) {
      setError('A tag needs a name.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Drop the bookkeeping field — only {name, color} is persisted.
      await onSave(draft.map((d) => ({ name: d.name.trim(), color: d.color })))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the tags.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 w-[300px] bg-white border border-[#E5E7EB] rounded-lg shadow-lg p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">
          Manage tags
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="p-0.5 text-[#9CA3AF] hover:text-[#111]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {draft.length === 0 ? (
        <div className="text-[11.5px] text-[#9CA3AF] italic py-2">
          No tags yet. Add one from a task.
        </div>
      ) : (
        <div className="space-y-2 max-h-[260px] overflow-y-auto">
          {/* Keyed by the ORIGINAL name, not the index — deleting a row shifts
              every index below it, which would hand one tag's focus and IME
              state to a different tag. */}
          {draft.map((t, i) => (
            <div key={t.origName || `new-${i}`} className="flex items-center gap-1.5">
              <input
                value={t.name}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  )
                }
                className="flex-1 min-w-0 px-2 py-1 text-[12px] border border-[#E5E7EB] rounded-md focus:outline-none focus:border-[#2563EB]"
              />
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {TASK_TAG_COLORS.map((c) => (
                  <button
                    key={c.key}
                    onClick={() =>
                      setDraft((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, color: c.key } : x)),
                      )
                    }
                    aria-label={`Colour ${c.key}`}
                    className={`w-3.5 h-3.5 rounded-full border transition-transform ${
                      t.color === c.key
                        ? 'border-[#111] scale-110'
                        : 'border-transparent hover:scale-110'
                    }`}
                    style={{ backgroundColor: c.dot }}
                  />
                ))}
              </div>
              <button
                onClick={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
                aria-label={`Delete tag ${t.name}`}
                className="p-1 text-[#9CA3AF] hover:text-[#DC2626] flex-shrink-0"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* The limitation, said out loud, exactly when it applies. */}
      {renamed && (
        <div className="mt-2 text-[10.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-2 py-1.5 leading-snug">
          Renaming only changes the tag from here on. Tasks already tagged keep
          the old name.
        </div>
      )}
      {error && (
        <div className="mt-2 text-[11px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1">
          {error}
        </div>
      )}

      <button
        disabled={busy}
        onClick={() => void commit()}
        className="mt-2.5 w-full inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-[#2563EB] text-white text-[12px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50"
      >
        <Check className="w-3.5 h-3.5" /> {busy ? 'Saving…' : 'Save tags'}
      </button>
    </div>
  )
}
