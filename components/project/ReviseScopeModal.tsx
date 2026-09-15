'use client'

// ============================================================================
// ReviseScopeModal — change an existing subproject on a change order
// ============================================================================
// ⛔ THE SPEC ASKED FOR "REOPEN THE SUB IN THE COMPOSER". THAT IS IMPOSSIBLE ON
// THE JOBS THIS IS FOR, AND THE DATA SAYS SO.
//
// `AddLineComposer` refuses any line without `product_key` — it has no math
// model for one — and the Built importer writes frozen lines with dept hours
// and a material lump and no product_key at all. Measured with
// scripts/inspect-line-editability: **Pajot is 0 of 7 lines editable. Every
// imported job is 0%.** 14 of 64 across all sold jobs.
//
// So this is a LINE-LEVEL DIFF instead: remove a contract line (credited at
// its original value), add a new one (charged at today's rates), and — where
// the line actually is a composer line — revise it in place, which is the same
// two things at once. That is the spec's own money rule for a modification
// ("credit old + add new"), and it is exactly what Andrew's Pajot change is:
// remove the rounded end panel, add a finish panel, add a waterfall top.
//
// ⛔ NOTHING IS WRITTEN TO THE SUBPROJECT HERE. The contract lines stay the
// working truth until the client accepts the doc; this only edits a payload.
// ============================================================================

import { useMemo, useState } from 'react'
import { Lock, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import AddLineComposer from '@/components/composer/AddLineComposer'
import { composerLineRow } from '@/lib/composer-row'
import type { ComposerBreakdown, ComposerDraft, ComposerRateBook } from '@/lib/composer'
import type { CoDraftLine, EditSubDraft } from '@/lib/co-doc-math'

export interface ContractLine {
  id: string
  description: string
  quantity: number
  unit: string | null
  /** Non-null = a composer line, so it can be reopened and revised in place. */
  product_key: string | null
  product_slots: Record<string, unknown> | null
}

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

export default function ReviseScopeModal({
  subprojectId,
  subprojectName,
  contractLines,
  orgId,
  orgConsumablePct,
  coLabel,
  /** False when the sub is frozen — new lines can't go inside it. */
  canAddLines,
  addLinesBlockedReason,
  initial,
  saving,
  priceOf,
  onCancel,
  onSave,
}: {
  subprojectId: string
  subprojectName: string
  contractLines: ContractLine[]
  orgId: string
  orgConsumablePct: number | null
  coLabel: string
  canAddLines: boolean
  addLinesBlockedReason?: string | null
  initial?: EditSubDraft | null
  saving: boolean
  /** Returns { delta, credit, charge } for a draft. */
  priceOf: (d: EditSubDraft) => { delta: number; credit: number; charge: number }
  onCancel: () => void
  onSave: (draft: EditSubDraft) => Promise<void>
}) {
  const [removeIds, setRemoveIds] = useState<string[]>(initial?.removeLineIds ?? [])
  const [addLines, setAddLines] = useState<CoDraftLine[]>(initial?.addLines ?? [])
  const [reviseLines, setReviseLines] = useState<EditSubDraft['reviseLines']>(
    initial?.reviseLines ?? [],
  )
  const [defaults] = useState(
    initial?.defaults ?? {
      consumablesPct:
        typeof orgConsumablePct === 'number' && orgConsumablePct > 0 ? orgConsumablePct : 10,
      wastePct: 5,
    },
  )
  const [composing, setComposing] = useState<
    { mode: 'add' } | { mode: 'revise'; lineId: string; seed: ComposerDraft | null } | null
  >(null)
  const [err, setErr] = useState<string | null>(null)

  const draft: EditSubDraft = useMemo(
    () => ({ subprojectId, defaults, removeLineIds: removeIds, addLines, reviseLines }),
    [subprojectId, defaults, removeIds, addLines, reviseLines],
  )
  const priced = useMemo(() => priceOf(draft), [draft, priceOf])
  const touched = removeIds.length + addLines.length + reviseLines.length

  function handleComposed(
    composed: ComposerDraft,
    breakdown: ComposerBreakdown,
    rb: ComposerRateBook,
  ) {
    const row = composerLineRow({ draft: composed, breakdown, rateBook: rb })
    if (composing?.mode === 'revise') {
      const lineId = composing.lineId
      setReviseLines((prev) => {
        const next = prev.filter((r) => r.lineId !== lineId)
        return [...next, { lineId, line: { key: lineId, composer: composed, row } }]
      })
    } else {
      setAddLines((prev) => [
        ...prev,
        { key: `n${Date.now().toString(36)}${prev.length}`, composer: composed, row },
      ])
    }
    setComposing(null)
  }

  async function handleSave() {
    if (touched === 0) {
      setErr('Nothing has changed yet.')
      return
    }
    setErr(null)
    try {
      await onSave(draft)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save this revision.')
    }
  }

  if (composing) {
    return (
      <div className="fixed inset-0 z-[210] bg-black/45 overflow-y-auto">
        <div className="min-h-full p-4 sm:p-10">
          <AddLineComposer
            subprojectId={null}
            orgId={orgId}
            orgConsumablePct={orgConsumablePct}
            hasExistingLinesInSubproject={contractLines.length > 0}
            draftMode={{
              onComposed: handleComposed,
              editing: composing.mode === 'revise' ? composing.seed : null,
              defaults,
            }}
            onLineSaved={() => setComposing(null)}
            onCancel={() => setComposing(null)}
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
        className="bg-white rounded-xl w-full max-w-[640px] shadow-xl"
      >
        <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#111] truncate">
              Revise {subprojectName}
            </div>
            <div className="text-[11.5px] text-[#6B7280]">
              Goes on {coLabel} · removals credit the contract value, additions price at today&rsquo;s
              rates
            </div>
          </div>
          <button onClick={onCancel} aria-label="Close" className="text-[#9CA3AF] hover:text-[#111]">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">
            Contract lines
          </div>
          <div className="space-y-1">
            {contractLines.map((l) => {
              const removed = removeIds.includes(l.id)
              const revised = reviseLines.find((r) => r.lineId === l.id)
              const editable = !!l.product_key
              return (
                <div
                  key={l.id}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                    removed
                      ? 'border-[#FCA5A5] bg-[#FEF2F2]'
                      : revised
                        ? 'border-[#FCD34D] bg-[#FFFBEB]'
                        : 'border-[#E5E7EB] bg-white'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div
                      className={`text-[12.5px] truncate ${
                        removed ? 'text-[#991B1B] line-through' : 'text-[#111]'
                      }`}
                    >
                      {revised ? revised.line.row.description : l.description}
                    </div>
                    <div className="text-[10px] text-[#9CA3AF]">
                      {revised ? revised.line.row.quantity : l.quantity} {l.unit}
                      {revised ? ' · revised' : ''}
                      {!editable && !removed && !revised ? (
                        <span className="ml-1 inline-flex items-center gap-0.5 text-[#B45309]">
                          <Lock className="w-2.5 h-2.5" /> not composer-editable
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {revised && (
                    <button
                      onClick={() => setReviseLines((p) => p.filter((r) => r.lineId !== l.id))}
                      title="Undo this revision"
                      className="flex-shrink-0 text-[#9CA3AF] hover:text-[#111]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {/* ⛔ ONLY COMPOSER LINES CAN BE REVISED IN PLACE. A migrated
                      line has no product_key and no math model behind it — the
                      honest options are remove it, or remove it and add a
                      replacement, which is the same money either way. */}
                  {editable && !removed && !revised && (
                    <button
                      onClick={() =>
                        setComposing({
                          mode: 'revise',
                          lineId: l.id,
                          seed: {
                            productId: l.product_key as ComposerDraft['productId'],
                            qty: l.quantity,
                            // The composer fills the missing slots from
                            // `emptySlots()` on hydrate, so a partial payload
                            // is safe here.
                            slots: (l.product_slots || {}) as unknown as ComposerDraft['slots'],
                          },
                        })
                      }
                      className="flex-shrink-0 text-[10.5px] text-[#2563EB] hover:underline"
                    >
                      Revise
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setRemoveIds((p) => (removed ? p.filter((x) => x !== l.id) : [...p, l.id]))
                    }
                    title={removed ? 'Keep this line' : 'Remove this line in the change order'}
                    className={`flex-shrink-0 ${
                      removed ? 'text-[#B91C1C]' : 'text-[#D1D5DB] hover:text-[#DC2626]'
                    }`}
                  >
                    {removed ? <RotateCcw className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )
            })}
            {contractLines.length === 0 && (
              <div className="text-[11.5px] text-[#9CA3AF] italic px-1 py-2">
                This scope has no lines.
              </div>
            )}
          </div>

          {addLines.length > 0 && (
            <>
              <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mt-4 mb-1.5">
                Added by {coLabel}
              </div>
              <div className="space-y-1">
                {addLines.map((l) => (
                  <div
                    key={l.key}
                    className="flex items-center gap-2 rounded-lg border border-[#C4B5FD] bg-[#FAF5FF] px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] text-[#111] truncate">{l.row.description}</div>
                      <div className="text-[10px] text-[#6B7280]">
                        {l.row.quantity} {l.row.unit}
                      </div>
                    </div>
                    <button
                      onClick={() => setAddLines((p) => p.filter((x) => x.key !== l.key))}
                      className="flex-shrink-0 text-[#D1D5DB] hover:text-[#DC2626]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {canAddLines ? (
            <button
              onClick={() => setComposing({ mode: 'add' })}
              className="mt-2 w-full border border-dashed border-[#D1D5DB] rounded-lg px-4 py-2.5 text-center text-[12.5px] text-[#6B7280] hover:text-[#7C3AED] hover:border-[#7C3AED] hover:bg-[#FAF5FF] transition-colors"
            >
              <Plus className="w-3.5 h-3.5 inline mr-1" /> Add a line to this scope
            </button>
          ) : (
            // ⛔ SAY WHY, AND SAY WHERE TO GO INSTEAD. A frozen sub prices its
            // stored costs AS its price, so a composer line appended here would
            // come out with no labor and no margin — migration 108's bug, one
            // level down. Step 1's "Add new scope" prices correctly.
            <div className="mt-2 text-[11.5px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2 leading-snug">
              {addLinesBlockedReason ||
                'New lines can’t be added inside this scope. Add the work as new scope on the change order instead.'}
            </div>
          )}

          {touched > 0 && (
            <div className="mt-3 border-t border-[#F3F4F6] pt-2 space-y-1">
              {priced.credit > 0 && (
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-[#6B7280]">Credit for removed scope</span>
                  <span className="text-[12px] font-mono tabular-nums text-[#B91C1C]">
                    {money(-priced.credit)}
                  </span>
                </div>
              )}
              {priced.charge > 0 && (
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-[#6B7280]">New work at today&rsquo;s rates</span>
                  <span className="text-[12px] font-mono tabular-nums text-[#111]">
                    {money(priced.charge)}
                  </span>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1 border-t border-[#F3F4F6]">
                <span className="text-[11px] uppercase tracking-wider text-[#9CA3AF] font-semibold">
                  Net change
                </span>
                <span
                  className={`text-[15px] font-semibold font-mono tabular-nums ${
                    priced.delta < 0 ? 'text-[#B91C1C]' : 'text-[#111]'
                  }`}
                >
                  {priced.delta >= 0 ? '+' : ''}
                  {money(priced.delta)}
                </span>
              </div>
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
              disabled={saving || touched === 0}
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
            <span className="text-[11px] text-[#9CA3AF] ml-auto text-right">
              The contract lines don&rsquo;t change until the client accepts.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
