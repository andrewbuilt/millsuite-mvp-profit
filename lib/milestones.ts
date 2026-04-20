// ============================================================================
// lib/milestones.ts — per-project payment milestones (Phase 4)
// ============================================================================
// Milestones are the user-defined schedule of how the project's cash comes in.
// Examples: 50/25/25 (deposit / rough-in / install), 30/10/10/10/10/10/10/10
// (long-build shop), 40/60, etc. No fixed default — the user composes them
// per project.
//
// Storage piggybacks on `cash_flow_receivables`: each milestone row has
//   type='receivable', status='projected', milestone_label, milestone_pct,
//   milestone_trigger, amount (rounded from project total × pct).
// On Phase 5 confirmation they stay 'projected'. On Phase 9 QB watcher they
// advance to 'received' when matched.
// ============================================================================

import { supabase } from './supabase'

export type MilestoneTrigger =
  | 'signing'        // deposit at contract signing
  | 'approvals'      // finish specs + drawings all approved
  | 'production'    // entered in-production
  | 'install_start' // install scheduled / trucks rolling
  | 'punchout'      // final walkthrough
  | 'delivery'      // delivered but not installed (install-only jobs)
  | 'manual'        // user-triggered ("we invoice this manually")

export const TRIGGER_LABEL: Record<MilestoneTrigger, string> = {
  signing: 'At signing',
  approvals: 'Approvals complete',
  production: 'Enters production',
  install_start: 'Install starts',
  punchout: 'Final punchout',
  delivery: 'Delivered',
  manual: 'Manual',
}

export const TRIGGER_ORDER: MilestoneTrigger[] = [
  'signing',
  'approvals',
  'production',
  'install_start',
  'delivery',
  'punchout',
  'manual',
]

export interface ProjectMilestone {
  id: string
  project_id: string
  label: string
  pct: number
  trigger: MilestoneTrigger
  amount: number
  status: 'projected' | 'invoiced' | 'received' | 'cancelled'
  expected_date: string | null
  sort_order: number
}

interface Raw {
  id: string
  project_id: string
  milestone_label: string | null
  milestone_pct: number | null
  milestone_trigger: string | null
  amount: number | null
  status: string
  expected_date: string | null
  created_at: string
  notes: string | null
}

function rowToMilestone(r: Raw, idx: number): ProjectMilestone {
  return {
    id: r.id,
    project_id: r.project_id,
    label: r.milestone_label || 'Milestone',
    pct: Number(r.milestone_pct) || 0,
    trigger: ((r.milestone_trigger as MilestoneTrigger) || 'manual'),
    amount: Number(r.amount) || 0,
    status: (r.status as ProjectMilestone['status']) || 'projected',
    expected_date: r.expected_date,
    // sort_order is encoded in notes until we add a column; fallback to idx.
    sort_order: Number(r.notes?.match(/order:(\d+)/)?.[1] ?? idx),
  }
}

export async function loadMilestones(projectId: string): Promise<ProjectMilestone[]> {
  const { data, error } = await supabase
    .from('cash_flow_receivables')
    .select('id, project_id, milestone_label, milestone_pct, milestone_trigger, amount, status, expected_date, created_at, notes')
    .eq('project_id', projectId)
    .eq('type', 'receivable')
    .order('created_at', { ascending: true })
  if (error) {
    console.error('loadMilestones', error)
    return []
  }
  return (data as Raw[])
    .map(rowToMilestone)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Replace the entire milestone list for a project in one transactional-ish
 * swap. We delete all projected receivables and re-insert the new set with
 * computed amounts. Milestones already invoiced/received are preserved — we
 * only nuke rows with status='projected' so the editor can't accidentally
 * clobber real QB-tracked payments.
 */
export async function saveMilestones(input: {
  org_id: string
  project_id: string
  project_total: number
  milestones: Array<Pick<ProjectMilestone, 'label' | 'pct' | 'trigger' | 'expected_date'>>
}): Promise<boolean> {
  const { error: delErr } = await supabase
    .from('cash_flow_receivables')
    .delete()
    .eq('project_id', input.project_id)
    .eq('type', 'receivable')
    .eq('status', 'projected')
  if (delErr) {
    console.error('saveMilestones delete', delErr)
    return false
  }
  if (input.milestones.length === 0) return true

  const rows = input.milestones.map((m, i) => ({
    org_id: input.org_id,
    project_id: input.project_id,
    type: 'receivable' as const,
    description: m.label,
    milestone_label: m.label,
    milestone_pct: m.pct,
    milestone_trigger: m.trigger,
    amount: Math.round((input.project_total * m.pct) / 100),
    status: 'projected' as const,
    expected_date: m.expected_date,
    notes: `order:${i}`,
  }))
  const { error: insErr } = await supabase.from('cash_flow_receivables').insert(rows)
  if (insErr) {
    console.error('saveMilestones insert', insErr)
    return false
  }
  return true
}

export function sumMilestonePct(milestones: Array<{ pct: number }>): number {
  return milestones.reduce((s, m) => s + (Number(m.pct) || 0), 0)
}
