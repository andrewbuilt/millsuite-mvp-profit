'use client'

// ============================================================================
// ProjectPnlPanel — the side panel's P&L section on a SOLD job (2026-10-29)
// ============================================================================
// Replaces Project total + the cost breakdown + the HOURS table (and the
// imported job's Estimated hours / Material budget block) once a job is sold:
// that's when there's tracked time and spend to set against the quote. Bids
// keep the estimating panel (Andrew's call). Payments stay below, unchanged.
//
//   Contract                 live bid_total
//   Labor     budget → actual → remaining      (click → Time dashboard)
//   Material  allowance → spent → remaining    (click → Material modal)
//   Margin to date
//
// All numbers come from lib/project-pnl (pure, pinned by verify-project-pnl).
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

function Bar({ line }: { line: PnlLine }) {
  if (line.budget <= 0) return null
  const pct = Math.min(100, line.ratio * 100)
  return (
    <div className="h-1.5 rounded-full bg-[#F3F4F6] overflow-hidden mt-1.5">
      <div
        className={`h-full rounded-full ${line.over ? 'bg-[#DC2626]' : 'bg-[#16A34A]'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function Remaining({ line, fmt }: { line: PnlLine; fmt: (n: number) => string }) {
  if (line.budget <= 0) return <span className="text-[#9CA3AF]">no budget</span>
  return line.over ? (
    <span className="text-[#B91C1C] font-semibold">{fmt(-line.remaining)} over</span>
  ) : (
    <span className="text-[#6B7280]">{fmt(line.remaining)} left</span>
  )
}

export default function ProjectPnlPanel({
  pnl,
  spendCount,
  onOpenTime,
  onOpenMaterial,
}: {
  pnl: ProjectPnl
  /** How many vendor bills are recorded — 0 changes what the margin means. */
  spendCount: number
  onOpenTime: () => void
  onOpenMaterial: () => void
}) {
  const row =
    'w-full text-left rounded-lg -mx-2 px-2 py-2.5 hover:bg-[#F9FAFB] transition-colors group'
  const marginBad = pnl.marginToDate < 0
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

      <div className="py-2 border-b border-[#F3F4F6]">
        <button onClick={onOpenTime} className={row} title="Open the time dashboard">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#111] inline-flex items-center gap-1">
              Labor <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF] group-hover:text-[#111]" />
            </span>
            <span className="text-[11px] font-mono tabular-nums">
              <Remaining line={pnl.labor} fmt={money} />
            </span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-[11.5px] font-mono tabular-nums text-[#6B7280]">
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF] font-sans">Budget</div>
              {hrs(pnl.laborHours.budget)} · {money(pnl.labor.budget)}
            </div>
            <div className="text-right">
              <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF] font-sans">Actual</div>
              <span className={pnl.labor.over ? 'text-[#B91C1C]' : 'text-[#111]'}>
                {hrs(pnl.laborHours.actual)} · {money(pnl.labor.actual)}
              </span>
            </div>
          </div>
          <Bar line={pnl.labor} />
        </button>

        <button onClick={onOpenMaterial} className={row} title="Open the material ledger">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#111] inline-flex items-center gap-1">
              Material <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF] group-hover:text-[#111]" />
            </span>
            <span className="text-[11px] font-mono tabular-nums">
              <Remaining line={pnl.material} fmt={money} />
            </span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-[11.5px] font-mono tabular-nums text-[#6B7280]">
            <div>
              <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF] font-sans">Allowance</div>
              {money(pnl.material.budget)}
            </div>
            <div className="text-right">
              <div className="text-[9.5px] uppercase tracking-wider text-[#9CA3AF] font-sans">Spent</div>
              <span className={pnl.material.over ? 'text-[#B91C1C]' : 'text-[#111]'}>{money(pnl.material.actual)}</span>
            </div>
          </div>
          <Bar line={pnl.material} />
          {spendCount === 0 && (
            <div className="text-[10.5px] text-[#92400E] mt-1.5 font-sans">No bills recorded yet — add them here.</div>
          )}
        </button>
      </div>

      <div className="pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[#111] uppercase tracking-wider">Margin to date</span>
          <span
            className={`text-[18px] font-semibold font-mono tabular-nums ${marginBad ? 'text-[#B91C1C]' : 'text-[#059669]'}`}
          >
            {money(pnl.marginToDate)}
            {pnl.marginToDatePct != null && (
              <span className="text-[12px] ml-1.5">{pnl.marginToDatePct.toFixed(0)}%</span>
            )}
          </span>
        </div>
        <div className="text-[10.5px] text-[#9CA3AF] mt-1 leading-snug">
          Contract minus labor tracked and material spent so far, so it reads high early in a job.
          Quoted: {money(pnl.plannedMargin)}
          {pnl.plannedMarginPct != null ? ` (${pnl.plannedMarginPct.toFixed(0)}%)` : ''}. Hours valued at $
          {pnl.rate.toFixed(2)}/hr.
        </div>
      </div>
    </div>
  )
}
