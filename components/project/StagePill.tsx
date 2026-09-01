'use client'

// ============================================================================
// StagePill — the project's lifecycle stage as a coloured pill.
// ============================================================================
// Extracted from the project cover page so the pre-production page can show
// the same pill in the same subbar position (wave-2 item 5). The cover-stage
// mapping lives here too, because a second copy of "which stages collapse
// into 'bidding'" is exactly the kind of thing that drifts.
//
// `sold` deliberately reads "Pre-Production" — the stored stage and the word
// the shop uses for it are different, and the label is the shop's word.
// ============================================================================

import type { ProjectStage } from '@/lib/types'

export type CoverStage = 'bidding' | 'sold' | 'production' | 'installed' | 'complete'

export const COVER_STAGE_ORDER: CoverStage[] = [
  'bidding',
  'sold',
  'production',
  'installed',
  'complete',
]

export const COVER_STAGE_LABEL: Record<CoverStage, string> = {
  bidding: 'Bidding',
  sold: 'Pre-Production',
  production: 'In Production',
  installed: 'Installed',
  complete: 'Complete',
}

/** All three pre-sale stages collapse into one "bidding" cover stage; `lost`
 *  is shown as a pill instead of occupying a strip node. */
export function coverStageOf(stage: ProjectStage): CoverStage | 'lost' {
  if (stage === 'lost') return 'lost'
  if (stage === 'new_lead' || stage === 'fifty_fifty' || stage === 'ninety_percent') return 'bidding'
  return stage
}

export default function StagePill({ stage }: { stage: ProjectStage }) {
  const cover = coverStageOf(stage)
  const palette: Record<CoverStage | 'lost', { bg: string; fg: string; border: string }> = {
    bidding:    { bg: '#FEF3C7', fg: '#92400E', border: '#FDE68A' },
    sold:       { bg: '#DBEAFE', fg: '#1E40AF', border: '#BFDBFE' },
    production: { bg: '#EDE9FE', fg: '#5B21B6', border: '#DDD6FE' },
    installed:  { bg: '#D1FAE5', fg: '#065F46', border: '#A7F3D0' },
    complete:   { bg: '#E5E7EB', fg: '#374151', border: '#D1D5DB' },
    lost:       { bg: '#FEE2E2', fg: '#991B1B', border: '#FECACA' },
  }
  const c = palette[cover]
  const label = cover === 'lost' ? 'Lost' : COVER_STAGE_LABEL[cover]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide border"
      style={{ backgroundColor: c.bg, color: c.fg, borderColor: c.border }}
    >
      {label}
    </span>
  )
}
