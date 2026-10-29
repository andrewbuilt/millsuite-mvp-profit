'use client'

// ============================================================================
// ProjectPnlPanel — the side panel's P&L section on a SOLD job (2026-10-29)
// ============================================================================
// Andrew's sketch (second pass): MONEY OUT vs MONEY IN, so far.
//
//   Contract                                   (headline)
//   Labor     Budget  hours · value   |  AMOUNT SPENT  (big)  · amount left
//             ████████████ bar
//   Material  Allowance $             |  AMOUNT SPENT  (big)  · amount left
//             ████████████ bar
//   Amount received
//   Cash flow to date = received − spent
//
// Replaces Project total + the cost breakdown + the HOURS table on sold jobs;
// bids keep the estimating panel (Andrew's call). Payments stay below.
// All numbers from lib/project-pnl (pure, pinned by verify-project-pnl).
// ============================================================================

import { ChevronRight } from 'lucide-react'
import type { PnlLine, ProjectPnl } from '@/lib/project-pnl'

function money(n: number): string {
  const r = Math.round(n)
  return r < 0 ? `−$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}
function hrs(n: number): string {
  return `${Math.round(n * 10) / 10}h`
}

function SpendRow({
  title,
  budgetLabel,
  budgetText,
  line,
  onOpen,
  hint,
}: {
  title: string
  budgetLabel: string
  budgetText: string
  line: PnlLine
  onOpen: () => void
  hint?: string | null
}) {
  const pct = line.budget > 0 ? Math.min(100, line.ratio * 100) : 0
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-lg -mx-2 px-2 py-3 hover:bg-[#F9FAFB] transition-colors group"
      title={`Open ${title.toLowerCase()}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-[#111] inline-flex items-center gap-1">
            {title} <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF] group-hover:text-[#111]" />
          </div>
          <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF] mt-1.5">{budgetLabel}</div>
          <div className="text-[12px] font-mono tabular-nums text-[#6B7280]">{budgetText}</div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF]">Spent</div>
          <div
            className={`text-[18px] font-semibold font-mono tabular-nums leading-tight ${
              line.over ? 'text-[#B91C1C]' : 'text-[#111]'
            }`}
          >
            {money(line.actual)}
          </div>
          <div className="text-[11px] font-mono tabular-nums mt-0.5">
            {line.budget <= 0 ? (
              <span className="text-[#9CA3AF]">no budget</span>
            ) : line.over ? (
              <span className="text-[#B91C1C] font-semibold">{money(-line.remaining)} over</span>
            ) : (
              <span className="text-[#6B7280]">{money(line.remaining)} left</span>
            )}
          </div>
        </div>
      </div>
      {line.budget > 0 && (
        <div className="h-2 rounded-full bg-[#F3F4F6] overflow-hidden mt-2">
          <div
            className={`h-full rounded-full ${line.over ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {hint && <div className="text-[10.5px] text-[#92400E] mt-1.5">{hint}</div>}
    </button>
  )
}

export default function ProjectPnlPanel({
  pnl,
  spendCount,
  onOpenTime,
  onOpenMaterial,
}: {
  pnl: ProjectPnl
  /** How many vendor bills are recorded — 0 gets a nudge on the Material row. */
  spendCount: number
  onOpenTime: () => void
  onOpenMaterial: () => void
}) {
  const negative = pnl.cashFlowToDate < 0
  return (
    <div data-pnl-panel>
      <div className="pb-3 border-b border-[#F3F4F6]">
        <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-1.5">P&amp;L</div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#374151]">Contract</span>
          <span className="text-[24px] font-semibold text-[#111] font-mono tabular-nums tracking-tight">
            {money(pnl.contract)}
          </span>
        </div>
      </div>

      <div className="py-1 border-b border-[#F3F4F6]">
        <SpendRow
          title="Labor"
          budgetLabel="Budget"
          budgetText={`${hrs(pnl.laborHours.budget)} · ${money(pnl.labor.budget)}`}
          line={pnl.labor}
          onOpen={onOpenTime}
        />
        <SpendRow
          title="Material"
          budgetLabel="Allowance"
          budgetText={money(pnl.material.budget)}
          line={pnl.material}
          onOpen={onOpenMaterial}
          hint={spendCount === 0 ? 'No bills recorded yet — add them here.' : null}
        />
      </div>

      <div className="pt-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-[#374151]">Amount received</span>
          <span className="text-[15px] font-semibold font-mono tabular-nums text-[#111]">{money(pnl.received)}</span>
        </div>
        <div className="flex items-baseline justify-between pt-2 border-t border-[#F3F4F6]">
          <span className="text-[11px] font-semibold text-[#111] uppercase tracking-wider">Cash flow to date</span>
          <span
            className={`text-[18px] font-semibold font-mono tabular-nums ${negative ? 'text-[#B91C1C]' : 'text-[#059669]'}`}
          >
            {money(pnl.cashFlowToDate)}
          </span>
        </div>
        <div className="text-[10.5px] text-[#9CA3AF] leading-snug">
          Received {money(pnl.received)} − spent {money(pnl.spent)} (labor + material). Hours valued at today’s
          shop rate, ${pnl.rate.toFixed(2)}/hr.
        </div>
      </div>
    </div>
  )
}
