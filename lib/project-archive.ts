'use client'

// ============================================================================
// lib/project-archive.ts — manual archive for completed + lost projects (119)
// ============================================================================
// Archiving is DECLUTTERING, never data removal. An archived project leaves
// the kanban, /projects, the project pickers and the /pm cards, and lives on
// THE archive page (/archive) — reached from Manage → Archive AND the
// kanban's Lost column. That one page also lists every LOST project (lost
// cards leave the board on their own after 30 days); it replaced
// /sales/lost, which now redirects there. Reports, sales intelligence, margins and
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

/** Stages whose /projects card carries an Archive button — finished work.
 *  (The kanban's ⋯ menu offers Archive on EVERY card, Andrew 2026-10-22.) */
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
  /** Null = a LOST project nobody archived by hand: on the archive page
   *  because lost work lives there (and off the board after 30 days). */
  archived_at: string | null
  completed_at: string | null
  lost_at: string | null
  created_at: string | null
  lead_source: string | null
  lost_reason: string | null
}

const ARCHIVE_COLS =
  'id, name, client_name, stage, bid_total, estimated_price, completed_at, lost_at, created_at, lead_source, lost_reason'

function toRow(r: any, archivedAt: string | null): ArchivedProject {
  return {
    id: r.id,
    name: r.name || 'Untitled',
    client_name: r.client_name ?? null,
    stage: r.stage,
    value: Number(r.bid_total) || Number(r.estimated_price) || 0,
    archived_at: archivedAt,
    completed_at: r.completed_at ?? null,
    lost_at: r.lost_at ?? null,
    created_at: r.created_at ?? null,
    lead_source: r.lead_source ?? null,
    lost_reason: r.lost_reason ?? null,
  }
}

/** Everything the archive page lists: every LOST project plus every project
 *  archived by hand (any stage). Two reads, merged by id — the lost read is
 *  the old /sales/lost query and keeps working on a pre-119 database. */
export async function listArchivePage(orgId: string): Promise<ArchivedProject[]> {
  const [lostRes, archRes] = await Promise.all([
    supabase.from('projects').select(ARCHIVE_COLS).eq('org_id', orgId).eq('stage', 'lost'),
    supabase
      .from('projects')
      .select(`${ARCHIVE_COLS}, archived_at`)
      .eq('org_id', orgId)
      .not('archived_at', 'is', null),
  ])
  const byId = new Map<string, ArchivedProject>()
  for (const r of (lostRes.data || []) as any[]) byId.set(r.id, toRow(r, null))
  for (const r of (archRes.data || []) as any[]) byId.set(r.id, toRow(r, r.archived_at))
  return [...byId.values()]
}

/** Stages where a contract exists and money can be owed. */
const OWES_MONEY = ['sold', 'production', 'installed', 'complete']

/** What's still owed on sold work: contract − cash received. Pipeline and
 *  lost work owe nothing. 0 = nothing to warn about. */
export async function outstandingBalance(project: {
  id: string
  stage: string
  bid_total?: number | null
}): Promise<number> {
  if (!OWES_MONEY.includes(project.stage)) return 0
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
