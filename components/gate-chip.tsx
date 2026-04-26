// ============================================================================
// gate-chip.tsx — scheduling gate indicator (Phase 3)
// ============================================================================
// Compact chip showing whether a subproject is ready_for_scheduling, plus a
// short reason when it's gated. Reused on the subproject header (project
// detail page), the schedule page swimlane rows, and the project rollup.
// ============================================================================

'use client'

import { CheckCircle2, Circle, AlertCircle } from 'lucide-react'
import {
  SubprojectStatus,
  gateSummary,
  gateSummaryShort,
  gateTone,
} from '@/lib/subproject-status'

interface Props {
  status: SubprojectStatus | null | undefined
  /** Compact variant for dense lists — uses gateSummaryShort so the chip
   *  fits next to a sub name + hours figure inside the schedule
   *  swimlane's label column. The full sentence still lands in the
   *  hover title. */
  small?: boolean
}

export default function GateChip({ status, small = false }: Props) {
  const tone = gateTone(status)
  const summary = status
    ? small
      ? gateSummaryShort(status)
      : gateSummary(status)
    : '—'

  const palette =
    tone === 'green'
      ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
      : tone === 'amber'
      ? 'bg-amber-100 text-amber-800 border-amber-200'
      : 'bg-neutral-100 text-neutral-500 border-neutral-200'

  const size = small
    ? 'text-[10px] px-1.5 py-0 gap-1'
    : 'text-[11px] px-2 py-0.5 gap-1'

  const Icon =
    tone === 'green' ? CheckCircle2 : tone === 'amber' ? AlertCircle : Circle

  return (
    <span
      className={`inline-flex items-center rounded border font-medium ${size} ${palette}`}
      title={
        status
          ? `${status.slots_approved}/${status.slots_total} slots approved · ${status.latest_drawings_approved}/${status.latest_drawing_revisions} drawings approved · ${status.open_change_orders} open CO${status.open_change_orders === 1 ? '' : 's'}`
          : 'No approval status loaded'
      }
    >
      <Icon className={small ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {summary}
    </span>
  )
}
