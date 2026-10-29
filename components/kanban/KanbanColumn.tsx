'use client'

// ============================================================================
// KanbanColumn — the one column both boards use (/sales/kanban, /projects).
// ============================================================================
// Andrew 2026-10-29: one board language across the site. Same header (label,
// count · $ sum, hint), same drop styling. A column that isn't a drag target
// (`droppable={false}`) never lights up — the projects board's first two
// columns are DERIVED (brand-new sale → pre-production), not dragged into.
// ============================================================================

import type { ReactNode } from 'react'

/** "$427k" / "$1.2M" — the column-header sum. Compact on purpose: the header
 *  answers "how much is sitting here", not "to the dollar". */
export function fmtColumnSum(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `$${Math.round(n / 1000)}k`
  return `$${Math.round(n)}`
}

export default function KanbanColumn({
  title,
  count,
  sum,
  hint,
  isOver,
  droppable = true,
  onDragOver,
  onDragLeave,
  onDrop,
  emptyText = 'Drop here',
  children,
}: {
  title: string
  count: number
  /** Header $ sum; 0 / undefined hides it. */
  sum?: number
  hint?: ReactNode
  isOver: boolean
  droppable?: boolean
  onDragOver?: () => void
  onDragLeave?: () => void
  onDrop?: () => void
  emptyText?: string
  children: ReactNode
}) {
  return (
    <div
      onDragOver={(e) => {
        if (!droppable) return
        e.preventDefault()
        onDragOver?.()
      }}
      onDragLeave={() => droppable && onDragLeave?.()}
      onDrop={() => droppable && onDrop?.()}
      className={`rounded-xl border transition-colors min-h-[60vh] ${
        isOver && droppable ? 'border-[#2563EB] bg-[#EFF6FF]' : 'border-[#E5E7EB] bg-[#F9FAFB]'
      }`}
    >
      <div className="px-3 pt-3 pb-2 border-b border-[#E5E7EB]">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold text-[#6B7280] uppercase tracking-widest">{title}</div>
          <div className="text-[11px] font-mono tabular-nums text-[#9CA3AF]">
            {count}
            {!!sum && sum > 0 && <span className="text-[#6B7280]"> · {fmtColumnSum(sum)}</span>}
          </div>
        </div>
        {hint && <div className="text-[10px] text-[#9CA3AF] mt-0.5">{hint}</div>}
      </div>
      <div className="p-2 space-y-2">
        {count === 0 ? (
          <div className="text-[11px] text-[#D1D5DB] text-center py-6 italic">{emptyText}</div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}
