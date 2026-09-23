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
import {
  AlertTriangle,
  Check,
  DollarSign,
  FilePlus2,
  FileText,
  Minus,
  Pencil,
  PenLine,
  Send,
  Trash2,
} from 'lucide-react'
import {
  coLabel,
  itemAutoDescription,
  summarizeDoc,
  type AddSubDraft,
  type CoDoc,
  type CoDocItem,
  type EditSubDraft,
} from '@/lib/co-doc-math'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

/** "2 lines removed · 1 added" — what a revision actually does, on the card.
 *  A revision showing only its net dollars looks like an unexplained discount. */
function editSummary(item: CoDocItem): string {
  const d = item.draft as unknown as EditSubDraft
  const removed = (d?.removeLineIds?.length ?? 0) + (d?.reviseLines?.length ?? 0)
  const added = (d?.addLines?.length ?? 0) + (d?.reviseLines?.length ?? 0)
  const parts: string[] = []
  if (removed > 0) parts.push(`${removed} line${removed === 1 ? '' : 's'} removed`)
  if (added > 0) parts.push(`${added} added`)
  return parts.length > 0 ? parts.join(' · ') : 'No changes yet'
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
  onSend,
  onAddAdjustment,
  onSaveDescription,
  showLineDetail,
  onToggleLineDetail,
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
  onSend: () => void
  /** Negative = credit. The sign comes from the UI, not from typing a minus. */
  onAddAdjustment: (amount: number, description: string) => void
  /** Save the client-facing description on one item — what the PDF prints
   *  under the scope line (sales+CO batch, 2026-09-23). */
  onSaveDescription: (item: CoDocItem, text: string) => void
  /** Migration 113: whether the PDF prints per-line material/qty detail rows.
   *  Hidden by default — the raw composer text is shop internals. */
  showLineDetail: boolean
  onToggleLineDetail: (next: boolean) => void
}) {
  const [confirmAccept, setConfirmAccept] = useState(false)
  const [adding, setAdding] = useState(false)
  /** Which item's client description is being edited, and the draft text. */
  const [descFor, setDescFor] = useState<string | null>(null)
  const [descDraft, setDescDraft] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [adjAmount, setAdjAmount] = useState('')
  /** Defaults to CREDIT: taking money off is the common case on an imported
   *  job, and it's the direction that hurts if it goes in backwards. */
  const [adjSign, setAdjSign] = useState<-1 | 1>(-1)
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
              : [
                  s.adds ? `${s.adds} added` : '',
                  s.edits ? `${s.edits} revised` : '',
                  s.removes ? `${s.removes} removed` : '',
                  s.adjustments ? `${s.adjustments} amount${s.adjustments === 1 ? '' : 's'}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
          </div>
          {/* ⛔ THE SIGNATURE IS CONSENT, NOT ACCEPTANCE. The portal records
              that the client agreed; the money still moves when the shop
              clicks Accept — one code path touches the contract total, and it
              is the one that always has. Say so plainly, or a signed doc looks
              done and nobody presses the button. */}
          {doc.signed_name ? (
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-[#047857] bg-[#ECFDF5] border border-[#A7F3D0] rounded px-2 py-1">
              <PenLine className="w-3 h-3" />
              Signed by {doc.signed_name}
              {doc.signed_at ? ` on ${new Date(doc.signed_at).toLocaleDateString()}` : ''} — still
              needs your Accept to apply it
            </div>
          ) : doc.sent_at ? (
            <div className="mt-1.5 text-[11px] text-[#1D4ED8]">
              Sent to the client {new Date(doc.sent_at).toLocaleDateString()} · waiting on their
              signature
            </div>
          ) : null}
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
                removal || (item.kind === 'adjustment' && item.delta_amount < 0)
                  ? 'border-[#FCA5A5]'
                  : 'border-[#C4B5FD]'
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
                      ) : item.kind === 'adjustment' ? (
                        item.delta_amount < 0 ? 'Credit' : 'Charge'
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
                    {item.kind === 'add_sub'
                      ? draft?.name || 'Untitled scope'
                      : item.kind === 'adjustment'
                        ? item.description || 'Adjustment'
                        : subName || 'Scope'}
                  </div>
                  <div className="text-[11px] text-[#6B7280] mt-0.5">
                    {removal
                      ? 'Credited at its original contract value'
                      : item.kind === 'edit_sub'
                        ? editSummary(item)
                        : item.kind === 'adjustment'
                          ? 'A flat amount — no line items behind it'
                          : `${lineCount} line${lineCount === 1 ? '' : 's'} · priced at today’s rates`}
                  </div>
                  {/* ── The client-facing description — what the PDF prints
                      under the scope line. Editable on EVERY item (Andrew,
                      2026-09-23: the auto slot text is shop internals on a
                      client document). Prefilled from the auto text so the
                      operator edits jargon away instead of reconstructing
                      scope from a blank box. */}
                  {descFor === item.id ? (
                    <div className="mt-2">
                      <textarea
                        autoFocus
                        value={descDraft}
                        onChange={(e) => setDescDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setDescFor(null)
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            onSaveDescription(item, descDraft)
                            setDescFor(null)
                          }
                        }}
                        rows={3}
                        placeholder="What the client reads on the PDF…"
                        className="w-full text-[12px] border border-[#C4B5FD] rounded-md px-2 py-1.5 outline-none focus:border-[#7C3AED] resize-y"
                      />
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          onClick={() => {
                            onSaveDescription(item, descDraft)
                            setDescFor(null)
                          }}
                          disabled={busy}
                          className="px-2.5 py-1 rounded-md bg-[#7C3AED] text-white text-[11px] font-medium hover:bg-[#6D28D9] disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setDescFor(null)}
                          className="px-2 py-1 text-[11px] text-[#6B7280] hover:text-[#111]"
                        >
                          Cancel
                        </button>
                        <span className="text-[10px] text-[#9CA3AF]">⌘↩ saves · prints on the PDF</span>
                      </div>
                    </div>
                  ) : item.kind === 'adjustment' ? (
                    // An adjustment's description IS its title above — offer
                    // the edit without printing the same text twice.
                    <button
                      onClick={() => {
                        setDescFor(item.id)
                        setDescDraft(item.description || '')
                      }}
                      disabled={busy}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[#7C3AED]"
                    >
                      <Pencil className="w-3 h-3" /> Edit wording
                    </button>
                  ) : item.description ? (
                    <button
                      onClick={() => {
                        setDescFor(item.id)
                        setDescDraft(item.description || '')
                      }}
                      disabled={busy}
                      title="Edit the client-facing description"
                      className="mt-1.5 w-full text-left text-[11.5px] text-[#374151] whitespace-pre-line rounded-md border border-transparent hover:border-[#DDD6FE] hover:bg-[#FAF5FF] px-1.5 py-1 -mx-1.5 transition-colors"
                    >
                      {item.description}
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setDescFor(item.id)
                        setDescDraft(itemAutoDescription(item, subName))
                      }}
                      disabled={busy}
                      className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-[#7C3AED] hover:text-[#5B21B6]"
                    >
                      <Pencil className="w-3 h-3" /> Write the client description
                    </button>
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            onClick={onAddScope}
            disabled={busy}
            className="border border-dashed border-[#C4B5FD] rounded-lg px-4 py-2.5 text-center text-[12.5px] text-[#7C3AED] hover:bg-[#F5F3FF] transition-colors disabled:opacity-50"
          >
            <FilePlus2 className="w-3.5 h-3.5 inline mr-1" />
            Add new scope
          </button>
          {/* ⛔ THE ONLY MOVE THAT WORKS ON AN IMPORTED JOB. Every migrated
              subproject is a single lump line — 91 of 91 — so "revise" there
              can only remove the whole room. Andrew: "how can I just deduct an
              amount? for the imported jobs there isn't anything to modify on
              the subproject level." */}
          <button
            onClick={() => setAdding(true)}
            disabled={busy}
            className="border border-dashed border-[#C4B5FD] rounded-lg px-4 py-2.5 text-center text-[12.5px] text-[#7C3AED] hover:bg-[#F5F3FF] transition-colors disabled:opacity-50"
          >
            <DollarSign className="w-3.5 h-3.5 inline mr-1" />
            Add or deduct an amount
          </button>
        </div>

        {adding && (
          <div className="rounded-lg border border-[#C4B5FD] bg-white px-3 py-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                autoFocus
                value={adjNote}
                onChange={(e) => setAdjNote(e.target.value)}
                placeholder="What it's for — the client reads this"
                className="flex-1 min-w-[180px] px-2 py-1.5 text-[12.5px] border border-[#E5E7EB] rounded outline-none focus:border-[#7C3AED]"
              />
              <div className="flex items-center gap-1">
                {/* ⛔ THE SIGN IS AN EXPLICIT CHOICE, not a minus sign someone
                    has to remember to type. A credit entered as a positive
                    number would bill the client for scope you just took away. */}
                <button
                  onClick={() => setAdjSign(-1)}
                  className={`px-2 py-1.5 text-[11px] font-semibold rounded border ${
                    adjSign < 0
                      ? 'border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]'
                      : 'border-[#E5E7EB] text-[#9CA3AF]'
                  }`}
                >
                  Credit
                </button>
                <button
                  onClick={() => setAdjSign(1)}
                  className={`px-2 py-1.5 text-[11px] font-semibold rounded border ${
                    adjSign > 0
                      ? 'border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]'
                      : 'border-[#E5E7EB] text-[#9CA3AF]'
                  }`}
                >
                  Charge
                </button>
              </div>
              <div className="flex items-center">
                <span className="text-[12.5px] text-[#9CA3AF] mr-0.5">$</span>
                <input
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  className="w-24 px-2 py-1.5 text-[12.5px] text-right font-mono border border-[#E5E7EB] rounded outline-none focus:border-[#7C3AED]"
                />
              </div>
              <button
                onClick={() => {
                  const n = Number(adjAmount)
                  if (!Number.isFinite(n) || n <= 0 || !adjNote.trim()) return
                  onAddAdjustment(adjSign * n, adjNote.trim())
                  setAdding(false)
                  setAdjNote('')
                  setAdjAmount('')
                  setAdjSign(-1)
                }}
                disabled={busy || !adjNote.trim() || !(Number(adjAmount) > 0)}
                className="px-3 py-1.5 rounded-lg bg-[#7C3AED] text-white text-xs font-medium hover:bg-[#6D28D9] disabled:opacity-40"
              >
                Add
              </button>
              <button
                onClick={() => setAdding(false)}
                className="px-2 py-1.5 text-xs text-[#6B7280] hover:text-[#111]"
              >
                Cancel
              </button>
            </div>
            <div className="mt-1.5 text-[10.5px] text-[#9CA3AF]">
              {adjSign < 0 ? 'Comes off' : 'Goes on'} the contract when {label} is accepted
              {Number(adjAmount) > 0
                ? ` — ${adjSign < 0 ? '-' : '+'}$${Math.round(Number(adjAmount)).toLocaleString()}`
                : ''}
              .
            </div>
          </div>
        )}
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
            {/* Line detail is OPT-IN (113): the per-line material/qty rows are
                shop internals by default; a GC asking for backup flips this. */}
            <label
              title="Print the per-line material/qty rows under each item on the PDF"
              className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280] cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={showLineDetail}
                disabled={busy}
                onChange={(e) => onToggleLineDetail(e.target.checked)}
                className="accent-[#7C3AED] w-3.5 h-3.5"
              />
              Line detail on PDF
            </label>
            {/* ⛔ SENDING IS WHAT MAKES IT VISIBLE IN THE PORTAL. Until then the
                client sees nothing — an open doc is the shop composing, and
                showing a half-written document invites a signature on scope
                that is still moving. */}
            {!doc.sent_at && (
              <button
                onClick={onSend}
                disabled={busy || items.length === 0}
                title={
                  items.length === 0
                    ? 'Add some scope first'
                    : 'Make this visible in the client portal for signing'
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#BFDBFE] bg-white text-[#1D4ED8] text-xs font-medium hover:bg-[#EFF6FF] disabled:opacity-40"
              >
                <Send className="w-3.5 h-3.5" /> Send to client
              </button>
            )}
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
