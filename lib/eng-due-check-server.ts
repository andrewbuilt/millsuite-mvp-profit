// ============================================================================
// lib/eng-due-check-server.ts — the end-of-day engineering check (SERVER)
// ============================================================================
// Service role, behind /api/engineering/due-check only. The rules are in
// lib/eng-due-check.ts (pure). Here: who the engineer is, what they're asked,
// and what an answer writes:
//   · done     → eng_assignments.done_at + an 'engineering_done' event
//   · not yet  → firm_date = the new date, the job to the TOP of their list,
//                a task for the PM ("Engineering behind — …")
//   · missed   → (sweep) a Critical task for the PM, once per job per due day
// Every answer is one eng_due_checks row (138).
// ⛔ The roster (orgs.team_members) also holds pay — it's read here, never returned.
// ============================================================================

import { supabaseAdmin } from './supabase-admin'
import { resolvePortalPm } from './preapproval-portal'
import {
  jobsToAsk, missedJobs, validNotYet, fmtDueDay, CHECK_AT_MINUTES,
  type DueAssignmentLite, type DueCheckLite, type JobToAsk,
} from './eng-due-check'

export class DueCheckError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Same value as lib/eng-board ENG_DEPT (not imported: that file pulls the browser client). */
const ENG_DEPT = 'eng'

const TZ = () => process.env.SHOP_TIMEZONE || 'America/New_York'

/** Shop-local today (YYYY-MM-DD) and minutes after midnight. */
export function shopNow(at = new Date()): { today: string; minutes: number } {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
  const hm = new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const [h, m] = hm.split(':').map(Number)
  return { today, minutes: (h % 24) * 60 + (m || 0) }
}

interface RosterRow { id: string; name: string; userId: string | null }
interface AssignmentRow extends DueAssignmentLite { id: string; priority: number }

async function loadRoster(orgId: string): Promise<RosterRow[]> {
  const { data } = await supabaseAdmin.from('orgs').select('team_members').eq('id', orgId).maybeSingle()
  const team = Array.isArray((data as { team_members?: unknown } | null)?.team_members) ? (data as { team_members: any[] }).team_members : []
  return team
    .filter((m: any) => m && m.id && m.active !== false)
    .map((m: any) => ({ id: String(m.id), name: String(m.name || 'An engineer'), userId: m.user_id ? String(m.user_id) : null }))
}

async function loadState(orgId: string): Promise<{ assignments: AssignmentRow[]; checks: DueCheckLite[] }> {
  const { data: rows, error } = await supabaseAdmin
    .from('eng_assignments')
    .select('id, project_id, member_id, firm_date, done_at, priority')
    .eq('org_id', orgId)
    .eq('dept', ENG_DEPT)
    .is('done_at', null)
  if (error) throw new DueCheckError(500, error.message)
  const assignments = ((rows || []) as any[]).map((r) => ({
    id: r.id, project_id: r.project_id, member_id: String(r.member_id), firm_date: r.firm_date ? String(r.firm_date).slice(0, 10) : null,
    done_at: r.done_at ?? null, priority: Number(r.priority) || 0,
  }))
  const dues = assignments.map((a) => a.firm_date).filter(Boolean).sort() as string[]
  if (!dues.length) return { assignments, checks: [] }
  const { data: cks, error: ckErr } = await supabaseAdmin
    .from('eng_due_checks')
    .select('project_id, check_date, answer')
    .eq('org_id', orgId)
    .gte('check_date', dues[0])
  if (ckErr) {
    if (/eng_due_checks/.test(ckErr.message || '') || (ckErr as { code?: string }).code === '42P01') {
      throw new DueCheckError(503, 'The end-of-day engineering check needs migration 138 on this database.')
    }
    throw new DueCheckError(500, ckErr.message)
  }
  return { assignments, checks: ((cks || []) as any[]).map((c) => ({ project_id: c.project_id, check_date: String(c.check_date).slice(0, 10), answer: c.answer })) }
}

async function projectNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  const { data } = await supabaseAdmin.from('projects').select('id, name').in('id', ids)
  return new Map(((data || []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]))
}

async function pmTask(orgId: string, input: { projectId: string; title: string; description: string; critical: boolean; today: string }): Promise<string | null> {
  try {
    const pm = await resolvePortalPm(orgId)
    const { data, error } = await supabaseAdmin
      .from('tasks')
      .insert({
        org_id: orgId,
        project_id: input.projectId,
        title: input.title,
        description: input.description,
        need_by: input.today,
        bucket: 'today',
        assignee_ids: pm.rosterId ? [pm.rosterId] : [],
        created_by: null,
        critical: input.critical,
        seen_by: [],
        sort_order: -Date.now(),
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(error?.message || 'no task row')
    return (data as { id: string }).id
  } catch (e) {
    console.error('eng due check: PM task not created', e)
    return null
  }
}

async function logEvent(orgId: string, projectId: string, eventType: string, label: string, meta: Record<string, unknown>, actorUserId: string | null) {
  try {
    await supabaseAdmin.from('project_events').insert({ org_id: orgId, project_id: projectId, event_type: eventType, label, meta, actor_user_id: actorUserId })
  } catch { /* pre-094: no events table */ }
}

/** What the signed-in person must answer right now (empty unless they're an
 *  engineer with a due / overdue job). */
export async function dueCheckFor(orgId: string, userId: string): Promise<{ jobs: Array<JobToAsk & { name: string }>; today: string; checkAt: number }> {
  const { today, minutes } = shopNow()
  const roster = await loadRoster(orgId)
  const me = roster.find((m) => m.userId === userId)
  if (!me) return { jobs: [], today, checkAt: CHECK_AT_MINUTES }
  const { assignments, checks } = await loadState(orgId)
  const jobs = jobsToAsk(assignments, checks, me.id, today, minutes)
  const names = await projectNames(jobs.map((j) => j.projectId))
  return { jobs: jobs.map((j) => ({ ...j, name: names.get(j.projectId) || 'A project' })), today, checkAt: CHECK_AT_MINUTES }
}

export async function answerDueCheck(input: {
  orgId: string
  userId: string | null
  role: string
  projectId: string
  answer: 'done' | 'not_yet'
  newDate?: string | null
  reason?: string | null
}): Promise<void> {
  const { today } = shopNow()
  const { data: row, error } = await supabaseAdmin
    .from('eng_assignments')
    .select('id, project_id, member_id, firm_date, done_at, priority')
    .eq('org_id', input.orgId)
    .eq('project_id', input.projectId)
    .eq('dept', ENG_DEPT)
    .maybeSingle()
  if (error) throw new DueCheckError(500, error.message)
  if (!row) throw new DueCheckError(404, 'That job isn’t on anyone’s engineering list.')
  const a = row as { id: string; member_id: string; firm_date: string | null; done_at: string | null }
  if (a.done_at) return
  const roster = await loadRoster(input.orgId)
  const me = roster.find((m) => m.userId === input.userId)
  const engineer = roster.find((m) => m.id === String(a.member_id))
  const isAdmin = input.role === 'owner' || input.role === 'admin'
  if (!isAdmin && me?.id !== String(a.member_id)) throw new DueCheckError(403, 'Only the engineer on this job can answer for it.')
  const due = a.firm_date ? String(a.firm_date).slice(0, 10) : null
  const names = await projectNames([input.projectId])
  const name = names.get(input.projectId) || 'A project'
  const who = engineer?.name || 'The engineer'

  const record = async (fields: Record<string, unknown>) => {
    const { error: e } = await supabaseAdmin.from('eng_due_checks').upsert(
      { org_id: input.orgId, project_id: input.projectId, member_id: String(a.member_id), check_date: today, due_date: due, answered_by: input.userId, ...fields },
      { onConflict: 'project_id,check_date' },
    )
    if (e) throw new DueCheckError(/eng_due_checks/.test(e.message || '') ? 503 : 500, /eng_due_checks/.test(e.message || '') ? 'The end-of-day engineering check needs migration 138 on this database.' : e.message)
  }

  if (input.answer === 'done') {
    await record({ answer: 'done', new_date: null, reason: null })
    const { data: upd, error: uErr } = await supabaseAdmin
      .from('eng_assignments').update({ done_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', a.id).select('id')
    if (uErr || !upd?.length) throw new DueCheckError(500, uErr?.message || 'Engineering done didn’t save.')
    await logEvent(input.orgId, input.projectId, 'engineering_done', 'Engineering done', { via: 'end_of_day_check' }, input.userId)
    return
  }

  const bad = validNotYet(input.newDate, input.reason, today)
  if (bad) throw new DueCheckError(400, bad)
  const newDate = input.newDate!
  const reason = input.reason!.trim()

  // To the top of their list, so tomorrow starts on it.
  const { data: mine } = await supabaseAdmin
    .from('eng_assignments').select('priority').eq('org_id', input.orgId).eq('dept', ENG_DEPT).eq('member_id', a.member_id).is('done_at', null)
  const top = Math.min(...((mine || []) as Array<{ priority: number }>).map((r) => Number(r.priority) || 0))
  const { data: upd, error: uErr } = await supabaseAdmin
    .from('eng_assignments')
    .update({ firm_date: newDate, priority: (Number.isFinite(top) ? top : 1) - 1, updated_at: new Date().toISOString() })
    .eq('id', a.id)
    .select('id')
  if (uErr || !upd?.length) throw new DueCheckError(500, uErr?.message || 'The new date didn’t save.')

  const first = who.split(' ')[0]
  const taskId = await pmTask(input.orgId, {
    projectId: input.projectId,
    title: `Engineering behind — ${name} (${first}: ready ${fmtDueDay(newDate)})`,
    description: `${who} says engineering on ${name} isn’t done.\nDue: ${due ? fmtDueDay(due) : 'today'} → new date: ${fmtDueDay(newDate)}\n\nWhy: ${reason}`,
    critical: false,
    today,
  })
  await record({ answer: 'not_yet', new_date: newDate, reason, task_id: taskId })
  await logEvent(input.orgId, input.projectId, 'engineering_slipped', `Engineering moved to ${fmtDueDay(newDate)}`, { from: due, to: newDate, reason }, input.userId)
}

/** Jobs nobody answered for → one Critical task each for the PM. Safe to call
 *  on every app load: the (project, due day) key makes it once per job. */
export async function sweepMissed(orgId: string): Promise<number> {
  const { today } = shopNow()
  const { assignments, checks } = await loadState(orgId)
  const missed = missedJobs(assignments, checks, today)
  if (!missed.length) return 0
  const roster = await loadRoster(orgId)
  const names = await projectNames(missed.map((m) => m.projectId))
  let made = 0
  for (const m of missed) {
    const a = assignments.find((x) => x.project_id === m.projectId)!
    const { data: ins, error } = await supabaseAdmin
      .from('eng_due_checks')
      .insert({ org_id: orgId, project_id: m.projectId, member_id: a.member_id, check_date: m.due, due_date: m.due, answer: 'missed' })
      .select('id')
    if (error || !ins?.length) continue // another load got here first (unique key)
    const who = roster.find((r) => r.id === a.member_id)?.name || 'The engineer'
    const name = names.get(m.projectId) || 'A project'
    const taskId = await pmTask(orgId, {
      projectId: m.projectId,
      title: `No answer — is engineering done on ${name}?`,
      description: `${who} didn’t answer the end-of-day check. Engineering on ${name} was due ${fmtDueDay(m.due)} and isn’t marked done.`,
      critical: true,
      today,
    })
    if (taskId) await supabaseAdmin.from('eng_due_checks').update({ task_id: taskId }).eq('id', (ins[0] as { id: string }).id)
    made++
  }
  return made
}
