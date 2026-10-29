// ============================================================================
// lib/attention-data.ts — what RESETS an attention clock (lib/attention)
// ============================================================================
// Andrew's call (2026-10-29): real events reset a clock automatically — a
// stage move, an estimate (re-)sent, change-order activity, a payment — plus a
// one-click "Touched base" on the card ⋯ menu, which logs a timeline event and
// so builds the contact log for free.
//
// No migration: every source here already carries a timestamp.
//   · project_events (094) — the RESET_EVENTS types below, incl. touched_base
//   · project_payments.created_at (099) — a payment recorded
//   · change_orders.updated_at — any CO write (create / send / approve / void)
//
// Best-effort like every reader of these tables: a failed source just
// contributes nothing, so a card shows its base clock rather than breaking.
// ============================================================================

import { supabase } from './supabase'
import { recordProjectEvent } from './project-events'
import type { LastTouch } from './attention'

/** project_events types that count as "somebody did something". Stage-ish
 *  events also feed `stageAt` (when the card entered its column). */
export const RESET_EVENTS = [
  'touched_base',
  'sold',
  'stage_change',
  'production_started',
  'estimate_sent',
  'co_schedule_applied',
  'milestone_received',
] as const
const STAGE_EVENTS = new Set(['sold', 'stage_change', 'production_started'])

export interface ProjectTouches {
  /** Latest reset of any kind. */
  touch: LastTouch | null
  /** Latest stage move — the column-sort key for stages without a clock. */
  stageAt: string | null
}

function later(a: LastTouch | null, b: LastTouch): LastTouch {
  return !a || new Date(b.at).getTime() > new Date(a.at).getTime() ? b : a
}

/** Latest touch + stage move per project, for one org. */
export async function loadProjectTouches(orgId: string): Promise<Record<string, ProjectTouches>> {
  const out: Record<string, ProjectTouches> = {}
  const get = (id: string) => (out[id] ||= { touch: null, stageAt: null })

  const [ev, pay, cos] = await Promise.all([
    supabase
      .from('project_events')
      .select('project_id, event_type, label, created_at')
      .eq('org_id', orgId)
      .in('event_type', RESET_EVENTS as unknown as string[])
      .order('created_at', { ascending: false })
      .limit(5000),
    supabase.from('project_payments').select('project_id, created_at').eq('org_id', orgId),
    supabase
      .from('change_orders')
      .select('project_id, updated_at, projects!inner(org_id)')
      .eq('projects.org_id', orgId),
  ])

  for (const r of ((ev.data || []) as { project_id: string; event_type: string; label: string; created_at: string }[])) {
    const t = get(r.project_id)
    t.touch = later(t.touch, { at: r.created_at, label: r.label || r.event_type })
    if (STAGE_EVENTS.has(r.event_type) && (!t.stageAt || r.created_at > t.stageAt)) t.stageAt = r.created_at
  }
  for (const r of ((pay.data || []) as { project_id: string; created_at: string }[])) {
    const t = get(r.project_id)
    t.touch = later(t.touch, { at: r.created_at, label: 'Payment recorded' })
  }
  for (const r of ((cos.data || []) as unknown as { project_id: string; updated_at: string }[])) {
    if (!r.updated_at) continue
    const t = get(r.project_id)
    t.touch = later(t.touch, { at: r.updated_at, label: 'Change order activity' })
  }
  return out
}

/**
 * "Touched base" — the one-click reset. Logs a timeline event (who/when, an
 * optional one-line note) and hands back the touch for the caller's state.
 * recordProjectEvent is best-effort by contract, so this never throws.
 */
export async function recordTouchedBase(input: {
  orgId: string
  projectId: string
  note?: string
  actorUserId?: string | null
}): Promise<LastTouch> {
  const note = (input.note || '').trim()
  const label = note ? `Touched base — ${note}` : 'Touched base'
  await recordProjectEvent({
    orgId: input.orgId,
    projectId: input.projectId,
    eventType: 'touched_base',
    label,
    meta: note ? { note } : {},
    actorUserId: input.actorUserId ?? null,
  })
  return { at: new Date().toISOString(), label }
}
