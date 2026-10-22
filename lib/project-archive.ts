'use client'

// ============================================================================
// lib/project-archive.ts — manual archive for completed + lost projects (119)
// ============================================================================
// Archiving is DECLUTTERING, never data removal. An archived project leaves
// the kanban, /projects, the project pickers and the /pm cards, and lives on
// Manage → Archive (/archive). Reports, sales intelligence, margins and
// history keep counting it — nothing that computes over projects filters on
// this.
//
// The ids are fetched SEPARATELY and subtracted, never filtered in the main
// queries as `.is('archived_at', null)`: a filter on a column that doesn't
// exist yet fails the WHOLE query (lib/practice's lesson). Pre-119 → empty
// set → every page behaves as it did.
// ============================================================================

import { supabase } from './supabase'
import { projectReceivedTotal } from './payments'

/** Only these stages can be archived — finished work, either way. */
export const ARCHIVABLE_STAGES = ['complete', 'lost'] as const

export function canArchive(stage: string | null | undefined): boolean {
  return !!stage && (ARCHIVABLE_STAGES as readonly string[]).includes(stage)
}

/** Ids of this org's archived projects. Empty set on any failure (incl. pre-119). */
export async function loadArchivedProjectIds(orgId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('projects')
    .select('id')
    .eq('org_id', orgId)
    .not('archived_at', 'is', null)
  if (error || !data) return new Set()
  return new Set(data.map((r) => r.id as string))
}

export interface ArchivedProject {
  id: string
  name: string
  client_name: string | null
  stage: string
  value: number
  archived_at: string
  completed_at: string | null
  lost_at: string | null
}

export async function listArchivedProjects(orgId: string): Promise<ArchivedProject[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client_name, stage, bid_total, estimated_price, archived_at, completed_at, lost_at')
    .eq('org_id', orgId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false })
  if (error || !data) return []
  return (data as any[]).map((r) => ({
    id: r.id,
    name: r.name || 'Untitled',
    client_name: r.client_name ?? null,
    stage: r.stage,
    value: Number(r.bid_total) || Number(r.estimated_price) || 0,
    archived_at: r.archived_at,
    completed_at: r.completed_at ?? null,
    lost_at: r.lost_at ?? null,
  }))
}

/** What's still owed on a COMPLETED job: contract − cash received. Lost work
 *  owes nothing. 0 = nothing to warn about. */
export async function outstandingBalance(project: {
  id: string
  stage: string
  bid_total?: number | null
}): Promise<number> {
  if (project.stage !== 'complete') return 0
  const contract = Number(project.bid_total) || 0
  if (contract <= 0) return 0
  const received = await projectReceivedTotal(project.id)
  const owed = Math.round((contract - received) * 100) / 100
  return owed > 1 ? owed : 0
}

async function setArchived(projectId: string, value: string | null): Promise<void> {
  // ⛔ `.select()` so an RLS refusal (zero rows) can't look like success.
  const { data, error } = await supabase
    .from('projects')
    .update({ archived_at: value })
    .eq('id', projectId)
    .select('id')
  if (error) {
    throw new Error(/archived_at/.test(error.message) ? 'Run migration 119 to enable the archive.' : error.message)
  }
  if (!data || data.length === 0) throw new Error('The project could not be updated.')
}

export async function archiveProject(projectId: string): Promise<void> {
  await setArchived(projectId, new Date().toISOString())
}

export async function unarchiveProject(projectId: string): Promise<void> {
  await setArchived(projectId, null)
}

/**
 * The one confirm flow every Archive button uses: warn with the number when
 * money is outstanding (allowed — Andrew's call per project, never silent).
 * Returns true when the project was archived.
 */
export async function confirmAndArchive(project: {
  id: string
  name: string
  stage: string
  bid_total?: number | null
}): Promise<boolean> {
  const owed = await outstandingBalance(project)
  const msg =
    owed > 0
      ? `${project.name} still shows $${Math.round(owed).toLocaleString()} not received against its contract.\n\nArchive it anyway? It stays in reports and on Manage → Archive, and you can unarchive any time.`
      : `Archive ${project.name}? It leaves the board and the projects list, stays in reports, and lives on Manage → Archive. You can unarchive any time.`
  if (!window.confirm(msg)) return false
  await archiveProject(project.id)
  return true
}
