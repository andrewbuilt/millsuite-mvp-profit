// ============================================================================
// subproject-status.ts — read helpers for the scheduling gate (Phase 3)
// ============================================================================
// Reads the subproject_approval_status view from migration 002. That view
// computes `ready_for_scheduling` per subproject: all approval_items are
// approved AND there's at least one latest drawing AND all latest drawings
// are approved. Mirror of BUILD-PLAN.md D5 + D8 gate logic.
// ============================================================================

import { supabase } from './supabase'

export interface SubprojectStatus {
  subproject_id: string
  ready_for_scheduling: boolean
  slots_total: number
  slots_approved: number
  latest_drawing_revisions: number
  latest_drawings_approved: number
  open_change_orders: number
  approved_co_net_change: number
}

/**
 * Load gate status for a single subproject. Returns null if the subproject
 * doesn't exist (shouldn't happen in normal flow).
 */
export async function loadSubprojectStatus(
  subprojectId: string
): Promise<SubprojectStatus | null> {
  const { data, error } = await supabase
    .from('subproject_approval_status')
    .select('*')
    .eq('subproject_id', subprojectId)
    .maybeSingle()

  if (error) {
    console.error('loadSubprojectStatus', error)
    return null
  }
  return (data as SubprojectStatus) || null
}

/**
 * Bulk load for the schedule page and project rollup. Returns a map keyed on
 * subproject_id for O(1) lookups while rendering.
 */
export async function loadSubprojectStatusMap(
  subprojectIds: string[]
): Promise<Record<string, SubprojectStatus>> {
  if (subprojectIds.length === 0) return {}

  const map: Record<string, SubprojectStatus> = {}
  // Supabase .in() has a practical size limit; batch to be safe.
  const BATCH_SIZE = 100
  for (let i = 0; i < subprojectIds.length; i += BATCH_SIZE) {
    const batch = subprojectIds.slice(i, i + BATCH_SIZE)
    const { data, error } = await supabase
      .from('subproject_approval_status')
      .select('*')
      .in('subproject_id', batch)
    if (error) {
      console.error('loadSubprojectStatusMap', error)
      continue
    }
    for (const row of data || []) {
      map[(row as SubprojectStatus).subproject_id] = row as SubprojectStatus
    }
  }
  return map
}

// ── Derived helpers ──

/**
 * Short human-readable summary for the gate chip.
 * "Ready" · "2 of 5 slots" · "drawings pending" · "2 of 5 slots + drawings"
 */
export function gateSummary(status: SubprojectStatus): string {
  if (status.ready_for_scheduling) return 'Ready'

  const parts: string[] = []
  if (status.slots_total > 0 && status.slots_approved < status.slots_total) {
    parts.push(`${status.slots_approved} of ${status.slots_total} slots`)
  } else if (status.slots_total === 0) {
    parts.push('no slots yet')
  }

  if (status.latest_drawing_revisions === 0) {
    parts.push('no drawings')
  } else if (status.latest_drawings_approved < status.latest_drawing_revisions) {
    parts.push('drawings pending')
  }

  return parts.length > 0 ? parts.join(' · ') : 'gated'
}

/**
 * Compact variant for dense lists (the schedule swimlane label column).
 * Drops the "of"/"yet"/"pending" prose so the cell fits next to a sub name +
 * a "best case" pill + an hours figure inside SWIM_LABEL_WIDTH. The verbose
 * form still goes into the chip's title attribute via gateSummary.
 *
 *   ready                            → "Ready"
 *   slots open + drawings missing    → "0/5 · drw"
 *   slots open only                  → "0/5"
 *   no slots yet                     → "no specs"
 *   drawings missing only            → "drw"
 *   drawings pending only            → "drw 0/2"
 */
export function gateSummaryShort(status: SubprojectStatus): string {
  if (status.ready_for_scheduling) return 'Ready'

  const parts: string[] = []
  if (status.slots_total > 0 && status.slots_approved < status.slots_total) {
    parts.push(`${status.slots_approved}/${status.slots_total}`)
  } else if (status.slots_total === 0) {
    parts.push('no specs')
  }

  if (status.latest_drawing_revisions === 0) {
    parts.push('drw')
  } else if (status.latest_drawings_approved < status.latest_drawing_revisions) {
    parts.push(
      `drw ${status.latest_drawings_approved}/${status.latest_drawing_revisions}`,
    )
  }

  return parts.length > 0 ? parts.join(' · ') : 'gated'
}

/**
 * Tone for the chip: green when ready, amber otherwise. Aligns with
 * approval-slots.tsx chip palette.
 */
export function gateTone(
  status: SubprojectStatus | null | undefined
): 'green' | 'amber' | 'neutral' {
  if (!status) return 'neutral'
  return status.ready_for_scheduling ? 'green' : 'amber'
}
