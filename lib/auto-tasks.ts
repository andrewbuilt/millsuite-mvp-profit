// ============================================================================
// lib/auto-tasks.ts — the tiny auto-task mechanism (October batch, migration 117)
// ============================================================================
// One rules object on the org (`orgs.auto_task_rules`), one person per rule,
// picked in Settings. When the trigger happens, that person gets a Today task.
// No coordinator set → no task. That's the whole feature — deliberately NOT a
// rules engine and NOT hardcoded names.
//
//   preprod_coordinator — "Start pre-production · {project}" when a project
//                         first enters sold (lib/sales.updateProjectStage).
//   pto_coordinator     — "PTO request · {name} · {dates}" when a request is
//                         created (lib/pto.createPtoRequest).
//
// ⛔ BEST-EFFORT, ALWAYS. `fireAutoTask` never throws: a missing column, an
// unset rule or a refused insert must not break selling a job or requesting
// time off. The trigger already happened; the task is a courtesy on top.
//
// Coordinator ids are ROSTER ids (orgs.team_members[].id) — the same id space
// as tasks.assignee_ids — so the task lands in that person's "Mine".
// ============================================================================

import { supabase } from './supabase'
import { updateOrgChecked } from './org-write'
import { createTask } from './tasks'

export const AUTO_TASK_RULES = ['preprod_coordinator', 'pto_coordinator'] as const
export type AutoTaskRule = (typeof AUTO_TASK_RULES)[number]
export type AutoTaskRules = Partial<Record<AutoTaskRule, string | null>>

function normalizeRules(raw: unknown): AutoTaskRules {
  const out: AutoTaskRules = {}
  if (!raw || typeof raw !== 'object') return out
  for (const k of AUTO_TASK_RULES) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'string' && v) out[k] = v
  }
  return out
}

/** Isolated select — folding `auto_task_rules` into a shared org read would
 *  42703 that whole read on a pre-117 database. Pre-117 reads as "no rules". */
export async function loadAutoTaskRules(orgId: string): Promise<AutoTaskRules> {
  const { data, error } = await supabase
    .from('orgs')
    .select('auto_task_rules')
    .eq('id', orgId)
    .maybeSingle()
  if (error) {
    if (String((error as { code?: string }).code) !== '42703') console.error('loadAutoTaskRules', error)
    return {}
  }
  return normalizeRules((data as { auto_task_rules?: unknown } | null)?.auto_task_rules)
}

export async function saveAutoTaskRules(orgId: string, rules: AutoTaskRules): Promise<void> {
  await updateOrgChecked(orgId, { auto_task_rules: normalizeRules(rules) })
}

/** Create the rule's task for its coordinator. Never throws. */
export async function fireAutoTask(
  orgId: string,
  rule: AutoTaskRule,
  task: { title: string; projectId?: string | null },
): Promise<void> {
  try {
    const rules = await loadAutoTaskRules(orgId)
    const assignee = rules[rule]
    if (!assignee) return
    await createTask({
      orgId,
      title: task.title,
      bucket: 'today',
      projectId: task.projectId ?? null,
      assigneeIds: [assignee],
      // No creator: an automation has no one to "close the loop" back to,
      // and crediting whoever happened to drag the card would ping them.
      createdBy: null,
    })
  } catch (e) {
    console.error(`fireAutoTask(${rule})`, e)
  }
}

/** "Oct 20" or "Oct 20 – 24" or "Oct 30 – Nov 3" — for the PTO task title. */
export function formatDateRange(startISO: string, endISO?: string | null): string {
  const parse = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
    return new Date(y, (m || 1) - 1, d || 1)
  }
  const s = parse(startISO)
  const fmt = (d: Date, withMonth = true) =>
    d.toLocaleDateString('en-US', withMonth ? { month: 'short', day: 'numeric' } : { day: 'numeric' })
  if (!endISO || endISO.slice(0, 10) === startISO.slice(0, 10)) return fmt(s)
  const e = parse(endISO)
  const sameMonth = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()
  return `${fmt(s)} – ${fmt(e, !sameMonth)}`
}
