// ============================================================================
// lib/project-events.ts — the per-project timeline (wave-3 item 6, migration 094)
// ============================================================================
// An append-only log of what happened to a job. Two rules govern everything
// here:
//
//   1. ⛔ RECORDING AN EVENT MUST NEVER FAIL THE THING IT DESCRIBES.
//      `recordProjectEvent` swallows every error, including the case where
//      migration 094 hasn't run yet. A missing line in a timeline is a
//      cosmetic gap; a stage change that throws because logging broke is a
//      real outage. Call it without awaiting a result you depend on, and
//      never inside a try/catch whose failure path matters.
//
//   2. The table only holds what leaves no other trace. Things the schema
//      ALREADY dates — created_at, imported_at, estimate_sent_at, sold_at —
//      are turned into derived pseudo-events at read time by
//      `derivedProjectEvents`. That's what stops old projects, which predate
//      the table entirely, from opening an empty drawer. Derived rows are
//      never written, so they can't drift from their source columns and
//      can't double up with a real event recorded later.
// ============================================================================

import { supabase } from './supabase'

export interface ProjectEvent {
  id: string
  project_id: string
  event_type: string
  label: string
  meta: Record<string, unknown>
  actor_user_id: string | null
  created_at: string
  /** True for rows synthesised from existing columns rather than read from
   *  the table. The drawer renders these muted — they're a reconstruction,
   *  not a record, and they carry no actor. */
  derived?: boolean
}

/**
 * Append one event. Best-effort by contract — see rule 1 in the header.
 *
 * Deliberately returns void rather than success: a caller that could act on
 * the failure would be a caller that lets logging affect the operation.
 */
export async function recordProjectEvent(input: {
  orgId: string
  projectId: string
  eventType: string
  label: string
  meta?: Record<string, unknown>
  actorUserId?: string | null
}): Promise<void> {
  try {
    await supabase.from('project_events').insert({
      org_id: input.orgId,
      project_id: input.projectId,
      event_type: input.eventType,
      label: input.label,
      meta: input.meta ?? {},
      actor_user_id: input.actorUserId ?? null,
    })
  } catch {
    // Swallowed on purpose. Pre-094 this table doesn't exist and every call
    // would otherwise throw into whatever operation triggered it.
  }
}

/** One project's recorded events, newest first. Returns [] pre-094 rather
 *  than throwing, so the drawer degrades to derived rows only. */
export async function listProjectEvents(projectId: string): Promise<ProjectEvent[]> {
  const { data, error } = await supabase
    .from('project_events')
    .select('id, project_id, event_type, label, meta, actor_user_id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) {
    // 42P01 / PGRST205 = table absent (migration not run). Anything else is
    // worth seeing in the console, but never worth breaking the page over.
    console.warn('listProjectEvents', error.message)
    return []
  }
  return (data || []).map((r: any) => ({
    ...r,
    meta: (r.meta as Record<string, unknown>) ?? {},
  })) as ProjectEvent[]
}

/**
 * Pseudo-events reconstructed from columns the project already carries.
 *
 * This is what makes the drawer useful on day one: every project that existed
 * before 094 has no recorded events at all, and an empty timeline on a job
 * with eight months of history reads as broken rather than as new.
 */
export function derivedProjectEvents(project: {
  id: string
  created_at?: string | null
  imported_at?: string | null
  estimate_sent_at?: string | null
  sold_at?: string | null
}): ProjectEvent[] {
  const out: ProjectEvent[] = []
  const add = (type: string, label: string, at: string | null | undefined) => {
    if (!at) return
    out.push({
      id: `derived:${type}:${project.id}`,
      project_id: project.id,
      event_type: type,
      label,
      meta: {},
      actor_user_id: null,
      created_at: at,
      derived: true,
    })
  }
  add('created', 'Project created', project.created_at)
  add('imported', 'Imported from Built OS', project.imported_at)
  add('estimate_sent', 'Estimate marked sent', project.estimate_sent_at)
  add('sold', 'Marked sold', project.sold_at)
  return out
}

/**
 * Recorded + derived, newest first.
 *
 * ⚠️ A derived row is dropped when a real event of the same type exists. The
 * overlap is guaranteed, not hypothetical: `sold_at` is stamped by the same
 * code path that records the 'sold' event, so from now on every sale produces
 * both. Without this the drawer would show "Marked sold" twice on every
 * project sold after 094 — and the derived copy is the one to drop, since the
 * real row carries the actor.
 */
export function mergeProjectEvents(
  recorded: ProjectEvent[],
  derived: ProjectEvent[],
): ProjectEvent[] {
  const recordedTypes = new Set(recorded.map((e) => e.event_type))
  const keep = derived.filter((d) => !recordedTypes.has(d.event_type))
  return [...recorded, ...keep].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
}

/** "Sold 12d ago" for the project cards. Null when never sold or pre-094. */
export function soldAgoLabel(soldAt: string | null | undefined, now = Date.now()): string | null {
  if (!soldAt) return null
  const then = new Date(soldAt).getTime()
  if (!Number.isFinite(then)) return null
  const days = Math.floor((now - then) / 86400000)
  if (days < 0) return null // clock skew — say nothing rather than "-1d ago"
  if (days === 0) return 'Sold today'
  if (days === 1) return 'Sold 1d ago'
  return `Sold ${days}d ago`
}
