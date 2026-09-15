'use client'

// ============================================================================
// CoDraftPanel — the open change order, and its drafts, ON the project page
// ============================================================================
// ⛔ THIS COMPONENT IS THE CONDITION ANDREW ATTACHED TO THE STORAGE MODEL.
// He blessed drafts living as jsonb payloads rather than flagged subprojects,
// with one non-negotiable: "a pending CO must show ON THE PROJECT PAGE as
// highlighted subs… all of it inert to bid_total, schedule, capacity, and
// pre-production until the doc is accepted."
//
// Both halves are satisfied here, and they are the same fact seen twice:
//   · VISIBLE — this panel reads `co_doc_items` explicitly and renders each
//     draft as a highlighted card beside the real subproject cards.
//   · INERT — a draft is not a `subprojects` row, so the 60-odd places that
//     read that table cannot see it. Nothing had to remember to exclude it.
//
// ⚠️ Drafts are purple. Real subprojects are white/grey and install is dashed;
// purple is unused elsewhere on this page, so "not agreed yet" reads at a
// glance without a legend.
// ============================================================================

import { useState } from 'react'
import { AlertTriangle, Check, FilePlus2, FileText, Minus, Pencil, Trash2 } from 'lucide-react'
import {
  coLabel,
  itemHeadline,
  summarizeDoc,
  type AddSubDraft,
  type CoDoc,
  type CoDocItem,
} from '@/lib/co-doc-math'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

export default function CoDraftPanel({
  doc,
  items,
  subNameById,
  busy,
  onAddScope,
  onEditDraft,
  onRemoveItem,
  onAccept,
  onVoid,
  onPdf,
}: {
  doc: CoDoc
  items: CoDocItem[]
  subNameById: Map<string, string>
  busy: boolean
  onAddScope: () => void
  onEditDraft: (item: CoDocItem) => void
  onRemoveItem: (item: CoDocItem) => void
  onAccept: () => void
  onVoid: () => void
  onPdf: () => void
}) {
  const [confirmAccept, setConfirmAccept] = useState(false)
  const s = summarizeDoc(items)
  const label = coLabel(doc)

  return (
    <div className="mt-6 rounded-xl border-2 border-[#DDD6FE] bg-[#FAF5FF] overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between gap-3 border-b border-[#EDE9FE]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#7C3AED] text-white">
              {label} · open
            </span>
            {doc.title && (
              <span className="text-[12.5px] text-[#4C1D95] truncate">{doc.title}</span>
            )}
          </div>
          <div className="text-[11px] text-[#6B21A8] mt-1">
            {items.length === 0
              ? 'Nothing in it yet.'
              : `${s.adds} added · ${s.edits} revised · ${s.removes} removed`}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div
            className={`text-[16px] font-semibold font-mono tabular-nums ${
              s.delta < 0 ? 'text-[#B91C1C]' : 'text-[#4C1D95]'
            }`}
          >
            {s.delta >= 0 ? '+' : ''}
            {money(s.delta)}
          </div>
          <div className="text-[10px] text-[#9CA3AF]">not in the contract yet</div>
        </div>
      </div>

      {/* ⛔ THE DRAFTS THEMSELVES, AS CARDS. This is the "highlighted subs on
          the project page" requirement — a new scope reads like a subproject
          card because that is what it will become. */}
      <div className="p-3 space-y-2">
        {items.map((item) => {
          const removal = item.kind === 'remove_sub'
          const subName = item.subproject_id ? subNameById.get(item.subproject_id) : null
          const draft = item.draft as AddSubDraft
          const lineCount = Array.isArray(draft?.lines) ? draft.lines.length : 0
          return (
            <div
              key={item.id}
              className={`rounded-lg border-2 border-dashed px-4 py-3 bg-white ${
                removal ? 'border-[#FCA5A5]' : 'border-[#C4B5FD]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded ${
                        removal
                          ? 'bg-[#FEE2E2] text-[#991B1B]'
                          : item.kind === 'edit_sub'
                            ? 'bg-[#FEF3C7] text-[#92400E]'
                            : 'bg-[#EDE9FE] text-[#5B21B6]'
                      }`}
                    >
                      {removal ? (
                        <>
                          <Minus className="w-2.5 h-2.5 inline -mt-px" /> Removing
                        </>
                      ) : item.kind === 'edit_sub' ? (
                        'CO pending'
                      ) : (
                        'Draft — new scope'
                      )}
                    </span>
                  </div>
                  <div
                    className={`text-[14px] font-medium mt-1 truncate ${
                      removal ? 'text-[#991B1B] line-through' : 'text-[#111]'
                    }`}
                  >
                    {item.kind === 'add_sub' ? draft?.name || 'Untitled scope' : subName || 'Scope'}
                  </div>
                  <div className="text-[11px] text-[#6B7280] mt-0.5">
                    {removal
                      ? 'Credited at its original contract value'
                      : `${lineCount} line${lineCount === 1 ? '' : 's'} · priced at today’s rates`}
                  </div>
                  {item.description && !removal && (
                    <div className="text-[11px] text-[#9CA3AF] mt-0.5 truncate">
                      {itemHeadline(item, subName)}
                    </div>
                  )}
                </div>
                <div className="flex items-start gap-2 flex-shrink-0">
                  <div
                    className={`text-[14px] font-semibold font-mono tabular-nums ${
                      item.delta_amount < 0 ? 'text-[#B91C1C]' : 'text-[#111]'
                    }`}
                  >
                    {item.delta_amount >= 0 ? '+' : ''}
                    {money(item.delta_amount)}
                  </div>
                  {item.kind === 'add_sub' && (
                    <button
                      onClick={() => onEditDraft(item)}
                      disabled={busy}
                      title="Edit this draft"
                      className="p-1 text-[#C4B5FD] hover:text-[#7C3AED] disabled:opacity-40"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => onRemoveItem(item)}
                    disabled={busy}
                    title="Take this off the change order"
                    className="p-1 text-[#D1D5DB] hover:text-[#DC2626] disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}

        <button
          onClick={onAddScope}
          disabled={busy}
          className="w-full border border-dashed border-[#C4B5FD] rounded-lg px-4 py-2.5 text-center text-[12.5px] text-[#7C3AED] hover:bg-[#F5F3FF] transition-colors disabled:opacity-50"
        >
          <FilePlus2 className="w-3.5 h-3.5 inline mr-1" />
          Add new scope to {label}
        </button>
      </div>

      <div className="px-4 py-3 border-t border-[#EDE9FE] flex items-center gap-2 flex-wrap">
        {confirmAccept ? (
          <>
            {/* ⛔ ACCEPTANCE IS THE IRREVERSIBLE STEP. The drafts become real
                subprojects, the contract total moves, and the doc locks. Say
                exactly that before doing it — there is no undo. */}
            <span className="text-[11.5px] text-[#4C1D95]">
              Accept {label}? The drafts become real scope and the contract
              changes by {s.delta >= 0 ? '+' : ''}
              {money(s.delta)}.
            </span>
            <button
              onClick={onAccept}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-[#059669] text-white text-xs font-medium hover:bg-[#047857] disabled:opacity-50"
            >
              {busy ? 'Applying…' : 'Yes, accept'}
            </button>
            <button
              onClick={() => setConfirmAccept(false)}
              className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] bg-white text-[#374151] text-xs hover:bg-[#F9FAFB]"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setConfirmAccept(true)}
              disabled={busy || items.length === 0}
              title={items.length === 0 ? 'Add some scope first' : undefined}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white text-xs font-medium hover:bg-[#6D28D9] disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" /> Accept {label}
            </button>
            {/* ⚠️ The PDF is generated from the OPEN doc so it can be sent for
                signature BEFORE acceptance — that's the normal order of
                events. Once accepted it stops re-rendering and returns the
                stored snapshot; see the route header. */}
            <button
              onClick={onPdf}
              disabled={busy || items.length === 0}
              title={items.length === 0 ? 'Add some scope first' : 'Open the change order PDF'}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#DDD6FE] bg-white text-[#6D28D9] text-xs font-medium hover:bg-[#F5F3FF] disabled:opacity-40"
            >
              <FileText className="w-3.5 h-3.5" /> PDF
            </button>
            <button
              onClick={onVoid}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] text-xs hover:text-[#B91C1C] hover:border-[#FECACA] disabled:opacity-50"
            >
              Void
            </button>
            <span className="text-[11px] text-[#9CA3AF] ml-auto inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Drafts aren&rsquo;t in the total, the schedule or the shop list yet.
            </span>
          </>
        )}
      </div>
    </div>
  )
}
