'use client'

// ============================================================================
// NewScopeDraftModal — add new scope to a change order, priced by the composer
// ============================================================================
// Andrew on CO v1: "I'm just guessing at the costs." The old modal asked for a
// dollar figure and some hours with no link to the rate book. This is the
// replacement for the add-a-whole-new-scope case: name it, compose real lines,
// and the price falls out of the same math the estimate uses.
//
// ⛔ NOTHING HERE IS A SUBPROJECT. The lines live in memory until Save, and
// then as a jsonb payload on `co_doc_items` until the client accepts the doc.
// Migration 107's header has the full argument; the short version is that
// `from('subprojects')` appears 60 times and a draft row would have to be
// excluded in every one of them, forever.
//
// ⚠️ The price shown here is computed by `priceAddition` — today's rates and
// the org's margins — and it is the number stored on the item. It is NOT
// re-derived later, because after the rate book moves a re-derivation would
// silently restate a number the client already signed.
// ============================================================================

import { useMemo, useState } from 'react'
import { Plus, Trash2, X } from 'lucide-react'
import AddLineComposer from '@/components/composer/AddLineComposer'
import { composerLineRow } from '@/lib/composer-row'
import type { ComposerBreakdown, ComposerDraft, ComposerRateBook } from '@/lib/composer'
import type { AddSubDraft, CoDraftLine } from '@/lib/co-doc-math'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

export default function NewScopeDraftModal({
  projectId,
  orgId,
  orgConsumablePct,
  coLabel,
  /** Present = editing an existing draft rather than creating one. */
  initial,
  saving,
  /** Prices the draft exactly as the item will store it. */
  priceOf,
  onCancel,
  onSave,
}: {
  projectId: string
  orgId: string
  orgConsumablePct: number | null
  coLabel: string
  initial?: AddSubDraft | null
  saving: boolean
  priceOf: (draft: AddSubDraft) => number
  onCancel: () => void
  onSave: (draft: AddSubDraft) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [lines, setLines] = useState<CoDraftLine[]>(initial?.lines ?? [])
  const [defaults] = useState(
    initial?.defaults ?? {
      consumablesPct:
        typeof orgConsumablePct === 'number' && orgConsumablePct > 0 ? orgConsumablePct : 10,
      wastePct: 5,
    },
  )
  const [composing, setComposing] = useState(false)
  /** The line being re-opened in the composer, or null for a new one. */
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const draft: AddSubDraft = useMemo(
    () => ({ name: name.trim(), defaults, lines }),
    [name, defaults, lines],
  )
  const price = useMemo(() => (lines.length > 0 ? priceOf(draft) : 0), [draft, lines, priceOf])

  function handleComposed(
    composed: ComposerDraft,
    breakdown: ComposerBreakdown,
    rb: ComposerRateBook,
  ) {
    // ⛔ THE SAME BUILDER THE INSERT USES. `composerLineRow` produces the exact
    // estimate_lines payload that materialisation will write, which is why the
    // quoted price and the post-acceptance price are one computation over one
    // object rather than two derivations that can drift.
    const row = composerLineRow({ draft: composed, breakdown, rateBook: rb })
    setLines((prev) => {
      if (editingKey) {
        return prev.map((l) => (l.key === editingKey ? { ...l, composer: composed, row } : l))
      }
      // Keys are position-independent so deleting a line doesn't renumber the
      // others out from under React.
      const key = `l${Date.now().toString(36)}${prev.length}`
      return [...prev, { key, composer: composed, row }]
    })
    setComposing(false)
    setEditingKey(null)
  }

  const editingLine = editingKey ? lines.find((l) => l.key === editingKey) : null

  async function handleSave() {
    if (!name.trim()) {
      setErr('Give this scope a name — the client reads it on the change order.')
      return
    }
    if (lines.length === 0) {
      setErr('Add at least one line, or there is nothing to price.')
      return
    }
    setErr(null)
    try {
      await onSave(draft)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save this draft.')
    }
  }

  if (composing) {
    return (
      <div className="fixed inset-0 z-[210] bg-black/45 overflow-y-auto">
        <div className="min-h-full p-4 sm:p-10">
          <AddLineComposer
            // ⛔ NULL — there is no subproject, and that is the point.
            subprojectId={null}
            orgId={orgId}
            orgConsumablePct={orgConsumablePct}
            hasExistingLinesInSubproject={lines.length > 0}
            draftMode={{
              onComposed: handleComposed,
              editing: editingLine?.composer ?? null,
              defaults,
            }}
            onLineSaved={() => {
              setComposing(false)
              setEditingKey(null)
            }}
            onCancel={() => {
              setComposing(false)
              setEditingKey(null)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-[200] bg-black/45 flex items-start justify-center overflow-y-auto p-4 sm:p-14"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl w-full max-w-[600px] shadow-xl"
      >
        <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#111]">
              {initial ? 'Edit new scope' : 'Add new scope'}
            </div>
            <div className="text-[11.5px] text-[#6B7280]">
              Goes on {coLabel} · priced at today&rsquo;s rates
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          <label className="block mb-3">
            <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              What is it
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Solid wood waterfall top · Island finish panel"
              className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#7C3AED] focus:outline-none"
            />
          </label>

          <div className="space-y-1.5">
            {lines.map((l) => (
              <div
                key={l.key}
                className="flex items-center gap-2 border border-[#E9D5FF] bg-[#FAF5FF] rounded-lg px-2.5 py-2"
              >
                <button
                  onClick={() => {
                    setEditingKey(l.key)
                    setComposing(true)
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="text-[12.5px] text-[#111] truncate">{l.row.description}</div>
                  <div className="text-[10px] text-[#6B7280]">
                    {l.row.quantity} {l.row.unit}
                  </div>
                </button>
                <button
                  onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  title="Remove this line"
                  className="text-[#D1D5DB] hover:text-[#DC2626] flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => {
              setEditingKey(null)
              setComposing(true)
            }}
            className="mt-2 w-full border border-dashed border-[#D1D5DB] rounded-lg px-4 py-2.5 text-center text-[12.5px] text-[#6B7280] hover:text-[#7C3AED] hover:border-[#7C3AED] hover:bg-[#FAF5FF] transition-colors"
          >
            <Plus className="w-3.5 h-3.5 inline mr-1" />
            {lines.length === 0 ? 'Compose the first line' : 'Add another line'}
          </button>

          {lines.length > 0 && (
            <div className="mt-3 flex items-baseline justify-between border-t border-[#F3F4F6] pt-2">
              <span className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                Change order price
              </span>
              <span className="text-[15px] font-semibold text-[#111] font-mono tabular-nums">
                {money(price)}
              </span>
            </div>
          )}

          {err && (
            <div className="mt-3 text-[12px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-3 py-2">
              {err}
            </div>
          )}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white text-xs font-medium hover:bg-[#6D28D9] disabled:opacity-50"
            >
              {saving ? 'Saving…' : initial ? 'Save changes' : 'Add to change order'}
            </button>
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] text-[#374151] text-xs hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
            {/* The promise the whole model rests on, said out loud. */}
            <span className="text-[11px] text-[#9CA3AF] ml-auto text-right">
              Nothing is added to the job until the change order is accepted.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
