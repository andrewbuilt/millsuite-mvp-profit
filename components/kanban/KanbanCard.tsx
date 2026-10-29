'use client'

// ============================================================================
// KanbanCard — the one card shell both boards use, wearing the ATTENTION RING.
// ============================================================================
// The shell owns: drag, click-to-open, the ⋯ menu, and the ring. Each board
// passes its own body (price, chips, progress) as children — what a card SAYS
// differs per board; how it looks and behaves doesn't (Andrew 2026-10-29).
//
// The ring (lib/attention):
//   · age  → the border itself thickens + darkens (box-shadow, so the card
//            doesn't shift as it ages). Tiny "12d" chip by the ⋯; the words
//            are in the tooltip.
//   · fill → a conic border filling clockwise green with tracked ÷ estimated
//            hours, red slice past 100%, "+8h over" chip.
// `suppressRing` is for the walkthrough's highlighted card: the tour draws its
// own ring and two rings on one card would read as one confusing signal.
// ============================================================================

import { useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { RING_STYLE, fillGradient, type Attention } from '@/lib/attention'

export interface KanbanMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  /** Draw a divider above this item. */
  dividerBefore?: boolean
}

export function AttentionChip({ attention }: { attention: Attention | null | undefined }) {
  if (!attention) return null
  if (attention.kind === 'fill') {
    if (!attention.chip) return null
    return (
      <span
        title={attention.tooltip}
        className="inline-block text-[9px] font-mono tabular-nums px-1 py-px rounded font-semibold"
        style={{ background: RING_STYLE[3].chipBg, color: RING_STYLE[3].chipFg }}
      >
        {attention.chip}
      </span>
    )
  }
  if (attention.level === 0) return null
  const s = RING_STYLE[attention.level]
  return (
    <span
      title={attention.tooltip}
      className="inline-block text-[9px] font-mono tabular-nums px-1 py-px rounded font-semibold"
      style={{ background: s.chipBg, color: s.chipFg }}
    >
      {attention.chip}
    </span>
  )
}

export default function KanbanCard({
  title,
  titleBadges,
  subtitle,
  menu,
  onOpen,
  draggable = true,
  onDragStart,
  onDragEnd,
  isDragging,
  dataTour,
  attention,
  suppressRing,
  children,
}: {
  title: string
  titleBadges?: ReactNode
  subtitle?: string | null
  menu: KanbanMenuItem[]
  onOpen: () => void
  draggable?: boolean
  onDragStart?: () => void
  onDragEnd?: () => void
  isDragging?: boolean
  dataTour?: string
  attention?: Attention | null
  suppressRing?: boolean
  children?: ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const a = suppressRing ? null : attention ?? null
  const age = a && a.kind === 'age' && a.level > 0 ? RING_STYLE[a.level as 1 | 2 | 3] : null
  const fill = a && a.kind === 'fill' ? a : null

  const card = (
    <div
      draggable={draggable}
      data-tour={dataTour}
      data-attention={age ? `age-${(a as { level: number }).level}` : fill ? 'fill' : undefined}
      title={a && !menuOpen ? a.tooltip : undefined}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        // Don't open when clicking the kebab or its menu.
        if ((e.target as HTMLElement).closest('[data-kebab]')) return
        onOpen()
      }}
      style={age ? { borderColor: age.color, boxShadow: `0 0 0 ${age.width - 1}px ${age.color}` } : undefined}
      className={`relative bg-white border border-[#E5E7EB] rounded-lg px-3 py-2.5 transition-all ${
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
      } ${age ? '' : 'hover:border-[#9CA3AF]'} ${isDragging ? 'opacity-40 scale-95' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="text-sm font-semibold text-[#111] truncate">{title}</div>
            {titleBadges}
          </div>
          {subtitle && <div className="text-[11px] text-[#6B7280] truncate mt-0.5">{subtitle}</div>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <AttentionChip attention={a} />
          <button
            data-kebab
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
            className="p-0.5 text-[#9CA3AF] hover:text-[#111] rounded"
            aria-label="More actions"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {children}

      {menuOpen && (
        <>
          <div
            data-kebab
            className="fixed inset-0 z-10"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(false)
            }}
          />
          <div
            data-kebab
            className="absolute right-2 top-8 z-20 w-44 bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1"
            onClick={(e) => e.stopPropagation()}
          >
            {menu.map((m) => (
              <div key={m.label}>
                {m.dividerBefore && <div className="my-1 border-t border-[#F3F4F6]" />}
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    m.onClick()
                  }}
                  className={`w-full text-left px-3 py-1.5 text-xs inline-flex items-center gap-2 ${
                    m.danger ? 'text-[#DC2626] hover:bg-[#FEF2F2]' : 'text-[#111] hover:bg-[#F3F4F6]'
                  }`}
                >
                  {m.icon}
                  {m.label}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )

  if (!fill) return card
  // The fill ring is a 3px conic frame around the card.
  return (
    <div className="rounded-[11px] p-[3px]" style={{ background: fillGradient(fill.ratio) }}>
      {card}
    </div>
  )
}
