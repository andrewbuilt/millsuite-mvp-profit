'use client'

// Reusable "Push to QuickBooks" confirmation modal (Chunk 4). Presentational:
// it shows what will be created in QB — customer, line items + specs, an
// optional payment schedule, the total, and terms — then calls onPush. The
// caller does the actual API call; this owns the "Pushing…" state and surfaces
// any error inline so the user can retry. Used for BOTH estimate and invoice
// pushes (kind switches the wording).
//
// The internal-mode estimate flow keeps its own clipboard QbPreviewModal; this
// is the QB-mode push path.

import { useState } from 'react'

export interface QbPushLine {
  desc: string
  spec?: string
  qty: number
  rate: number
  amount: number
}

export interface QbPushScheduleRow {
  label: string
  sublabel?: string
  amount: number
}

interface QbPushModalProps {
  kind: 'estimate' | 'invoice'
  projectName: string
  clientName: string | null
  lines: QbPushLine[]
  /** Payment milestones / deposit rows shown under the line items (estimates). */
  scheduleRows?: QbPushScheduleRow[]
  total: number
  termsText?: string
  /** Performs the push. Throw to surface an error and keep the modal open. */
  onPush: () => Promise<void>
  onClose: () => void
}

function money(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

export default function QbPushModal({
  kind,
  projectName,
  clientName,
  lines,
  scheduleRows = [],
  total,
  termsText,
  onPush,
  onClose,
}: QbPushModalProps) {
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const noun = kind === 'estimate' ? 'estimate' : 'invoice'

  async function handlePush() {
    setPushing(true)
    setError(null)
    try {
      await onPush()
      // On success the caller closes the modal + shows a toast.
    } catch (err: any) {
      setError(err?.message || `Couldn't push the ${noun} to QuickBooks.`)
      setPushing(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/50 flex items-center justify-center px-4"
      onClick={pushing ? undefined : onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[#111] flex items-center gap-2">
              Push {noun} to QuickBooks
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#DCFCE7] text-[#15803D] font-bold uppercase tracking-wider">
                QBO
              </span>
            </h3>
            <p className="text-xs text-[#6B7280] mt-0.5 truncate">
              {clientName || 'No client linked'} · {projectName}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={pushing}
            className="text-[#9CA3AF] hover:text-[#111] text-lg leading-none disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="text-[12.5px] text-[#6B7280] mb-3 leading-relaxed">
            This creates a new {noun} in your connected QuickBooks company. Cash
            flow stays milestone-based — connecting payments still happens through
            your milestones.
          </div>

          {/* Line item header */}
          <div className="grid grid-cols-[1fr_60px_90px_90px] gap-3.5 px-1 py-2 border-b border-[#E5E7EB] text-[10px] text-[#9CA3AF] uppercase tracking-wider font-semibold">
            <div>Item / Description</div>
            <div className="text-right">Qty</div>
            <div className="text-right">Rate</div>
            <div className="text-right">Amount</div>
          </div>

          {lines.length === 0 ? (
            <div className="py-6 text-center text-sm text-[#9CA3AF] italic">
              Nothing to push — no line items.
            </div>
          ) : (
            lines.map((l, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_60px_90px_90px] gap-3.5 px-1 py-3 border-b border-[#F3F4F6] items-start"
              >
                <div className="px-1.5">
                  <div className="text-sm font-medium text-[#111]">{l.desc}</div>
                  {l.spec ? (
                    <div className="text-[11.5px] text-[#6B7280] mt-1 whitespace-pre-line leading-relaxed">
                      {l.spec}
                    </div>
                  ) : null}
                </div>
                <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                  {l.qty}
                </div>
                <div className="text-right text-sm font-mono tabular-nums text-[#374151] pt-1.5">
                  {money(l.rate)}
                </div>
                <div className="text-right text-sm font-mono tabular-nums text-[#111] font-semibold pt-1.5">
                  {money(l.amount)}
                </div>
              </div>
            ))
          )}

          {/* Optional payment schedule rows */}
          {scheduleRows.map((row, i) => (
            <div
              key={`sched-${i}`}
              className="grid grid-cols-[1fr_auto] gap-3.5 px-1 py-2 border-b border-[#F3F4F6] items-start"
            >
              <div className="px-1.5">
                <div className="text-sm font-medium text-[#111]">{row.label}</div>
                {row.sublabel ? (
                  <div className="text-[11.5px] text-[#9CA3AF] mt-0.5">{row.sublabel}</div>
                ) : null}
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#059669] font-semibold pt-0.5">
                {money(row.amount)}
              </div>
            </div>
          ))}

          {/* Total */}
          <div className="grid grid-cols-[1fr_auto] px-1 py-3 mt-2 border-t border-[#111] text-base font-semibold text-[#111]">
            <span>{kind === 'estimate' ? 'Estimate' : 'Invoice'} total</span>
            <span className="font-mono tabular-nums">{money(total)}</span>
          </div>

          {/* Terms */}
          {termsText ? (
            <div className="mt-4">
              <div className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">
                Terms
              </div>
              <div className="text-[11.5px] leading-relaxed text-[#6B7280] whitespace-pre-line bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-3 py-2">
                {termsText}
              </div>
            </div>
          ) : null}
        </div>

        {/* Action bar */}
        <div className="px-5 py-4 border-t border-[#E5E7EB]">
          {error ? (
            <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-[#FEE2E2] text-[#B91C1C]">
              {error}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              disabled={pushing}
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-[#6B7280] hover:bg-[#F3F4F6] border border-[#E5E7EB] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handlePush}
              disabled={pushing || lines.length === 0}
              className="px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {pushing ? 'Pushing…' : 'Push to QuickBooks'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
