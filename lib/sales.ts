// ============================================================================
// sales.ts — data access for the sales pipeline (Phase 5 replacement for
// lib/leads.ts)
// ============================================================================
// Per parser-first-dashboard-mockup.html + BUILD-PLAN.md: leads are projects
// with a stage field, not a separate entity. This module hands the sales UI
// everything it needs by filtering / aggregating the `projects` table.
// ============================================================================

import { supabase } from './supabase'
import type { ProjectStage } from './types'
import type { ParsedScopeItem } from './pdf-parser'

// ── Types ──

// Sales pipeline view of the project stage. Only stages that are in-flight
// from a sales perspective show in the dashboard + kanban (sold + lost cap
// the pipeline MTD; the post-sold stages production/installed/complete are
// the shop's problem and live on the project cover, not here).
export type SalesStage =
  | 'new_lead'
  | 'fifty_fifty'
  | 'ninety_percent'
  | 'sold'
  | 'lost'

export const SALES_STAGES: SalesStage[] = [
  'new_lead',
  'fifty_fifty',
  'ninety_percent',
  'sold',
  'lost',
]

export const STAGE_LABEL: Record<SalesStage, string> = {
  new_lead: 'New lead',
  fifty_fifty: '50/50',
  ninety_percent: '90%',
  sold: 'Sold',
  lost: 'Lost',
}

/** Short label used on Kanban chips + pipeline tiles. */
export const STAGE_SHORT: Record<SalesStage, string> = {
  new_lead: 'New',
  fifty_fifty: '50/50',
  ninety_percent: '90%',
  sold: 'Sold',
  lost: 'Lost',
}

// Any project whose full stage is one of these shows as "Sold" in the sales
// view — the shop-side stages get collapsed so the kanban doesn't grow.
const SALES_SOLD_STAGES: ProjectStage[] = ['sold', 'production', 'installed', 'complete']

function projectToSalesStage(stage: ProjectStage): SalesStage {
  if (SALES_SOLD_STAGES.includes(stage)) return 'sold'
  if (stage === 'lost') return 'lost'
  return stage as SalesStage
}

export interface SalesProject {
  id: string
  name: string
  client_name: string | null
  client_id: string | null
  delivery_address: string | null
  stage: SalesStage
  bid_total: number
  estimated_price: number | null
  created_at: string
  updated_at: string
}

export interface SubprojectSummary {
  project_id: string
  sub_count: number
  linear_feet: number
}

// ── Queries ──

/**
 * Load every project that belongs to the sales pipeline view, plus a
 * subproject-count + LF-sum summary per project in a single round-trip.
 */
export async function loadSalesProjects(
  orgId: string
): Promise<{ projects: SalesProject[]; summaries: Record<string, SubprojectSummary> }> {
  const { data, error } = await supabase
    .from('projects')
    .select(
      `id, name, client_name, client_id, delivery_address, stage,
       bid_total, estimated_price, created_at, updated_at,
       subprojects(id, linear_feet)`
    )
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('loadSalesProjects', error)
    return { projects: [], summaries: {} }
  }

  const projects: SalesProject[] = []
  const summaries: Record<string, SubprojectSummary> = {}
  for (const row of data || []) {
    const subs = (row as any).subprojects || []
    const lf = subs.reduce(
      (sum: number, s: any) => sum + (Number(s.linear_feet) || 0),
      0
    )
    summaries[row.id] = {
      project_id: row.id,
      sub_count: subs.length,
      linear_feet: lf,
    }
    projects.push({
      id: row.id,
      name: row.name,
      client_name: row.client_name,
      client_id: (row as any).client_id ?? null,
      delivery_address: (row as any).delivery_address ?? null,
      stage: projectToSalesStage((row.stage as ProjectStage) || 'new_lead'),
      bid_total: Number(row.bid_total) || 0,
      estimated_price: row.estimated_price != null ? Number(row.estimated_price) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })
  }
  return { projects, summaries }
}

// ── Pipeline aggregation ──

export interface StageSummary {
  stage: SalesStage
  count: number
  value: number
  top: { name: string; amount: number } | null
}

/**
 * Compute the 5 pipeline tiles on the dashboard. `value` is the sum of
 * bid_total (or estimated_price fallback) for open stages; for Sold and Lost
 * it's a month-to-date filter since those are "MTD" per the mockup.
 */
export function summarizePipeline(
  projects: SalesProject[]
): Record<SalesStage, StageSummary> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const out = {} as Record<SalesStage, StageSummary>
  for (const stage of SALES_STAGES) {
    out[stage] = { stage, count: 0, value: 0, top: null }
  }

  for (const p of projects) {
    const amount = p.bid_total || p.estimated_price || 0
    const isTerminal = p.stage === 'sold' || p.stage === 'lost'
    if (isTerminal && new Date(p.updated_at) < monthStart) continue

    const bucket = out[p.stage]
    bucket.count += 1
    bucket.value += amount
    if (!bucket.top || amount > bucket.top.amount) {
      bucket.top = { name: p.name, amount }
    }
  }

  return out
}

// ── Mutations ──

/**
 * Create a blank project at the 'new_lead' stage. Used by the "Start a blank
 * project" fallback on the sales dashboard and by the parse-miss path in the
 * Phase 3 parser flow.
 */
export async function createBlankLeadProject(input: {
  org_id: string
  name: string
  client_name?: string | null
  delivery_address?: string | null
}): Promise<SalesProject | null> {
  const { data, error } = await supabase
    .from('projects')
    .insert({
      org_id: input.org_id,
      name: input.name,
      client_name: input.client_name ?? null,
      delivery_address: input.delivery_address ?? null,
      stage: 'new_lead' as ProjectStage,
      bid_total: 0,
    })
    .select()
    .single()
  if (error) {
    console.error('createBlankLeadProject', error)
    throw new Error(error.message || 'Failed to create project')
  }
  return {
    id: data.id,
    name: data.name,
    client_name: data.client_name,
    client_id: data.client_id ?? null,
    delivery_address: data.delivery_address ?? null,
    stage: projectToSalesStage((data.stage as ProjectStage) || 'new_lead'),
    bid_total: Number(data.bid_total) || 0,
    estimated_price:
      data.estimated_price != null ? Number(data.estimated_price) : null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  }
}

/**
 * Create a project from a parsed PDF intake. Role assignments are already
 * resolved client-side (user confirmed via the parser chips); we write them
 * to first-class columns + stash the full parse context as jsonb for audit.
 */
export async function createParsedLeadProject(input: {
  org_id: string
  name: string
  file_name: string
  page_count: number
  client_name?: string | null
  client_email?: string | null
  client_phone?: string | null
  client_company?: string | null
  designer_name?: string | null
  gc_name?: string | null
  delivery_address?: string | null
  estimated_price?: number | null
  intake_context: Record<string, any>
}): Promise<SalesProject | null> {
  // If client_company was provided but no client_name, prefer the company
  // for the display field so the sales card isn't empty.
  const displayClient = input.client_name || input.client_company || null

  const { data, error } = await supabase
    .from('projects')
    .insert({
      org_id: input.org_id,
      name: input.name,
      client_name: displayClient,
      client_email: input.client_email ?? null,
      client_phone: input.client_phone ?? null,
      designer_name: input.designer_name ?? null,
      gc_name: input.gc_name ?? null,
      delivery_address: input.delivery_address ?? null,
      estimated_price: input.estimated_price ?? null,
      source_pdf_name: input.file_name,
      intake_context: input.intake_context,
      stage: 'new_lead' as ProjectStage,
      bid_total: 0,
    })
    .select()
    .single()
  if (error) {
    console.error('createParsedLeadProject', error)
    throw new Error(error.message || 'Failed to create project')
  }
  return {
    id: data.id,
    name: data.name,
    client_name: data.client_name,
    client_id: data.client_id ?? null,
    delivery_address: data.delivery_address ?? null,
    stage: projectToSalesStage((data.stage as ProjectStage) || 'new_lead'),
    bid_total: Number(data.bid_total) || 0,
    estimated_price:
      data.estimated_price != null ? Number(data.estimated_price) : null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  }
}

/**
 * Bulk-insert subprojects for a freshly parsed project. Used by the sales
 * intake flow: when the user tags room chips as "Room / subproject" we seed
 * the project with one subproject per room so the editor isn't empty.
 *
 * Returns the number of subprojects actually created (errors are logged but
 * don't block the caller — the project itself already exists).
 */
export async function createRoomSubprojects(input: {
  org_id: string
  project_id: string
  rooms: string[]
  consumable_markup_pct?: number | null
  // profit_margin_pct removed — margin is project-level only (single
  // source of truth: projects.target_margin_pct ?? orgs.profit_margin_pct).
}): Promise<Array<{ id: string; name: string }>> {
  const rooms = input.rooms
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
  if (rooms.length === 0) return []

  // Composer defaults seed: consumablesPct pulls from the org's existing
  // setting (or 10 if unset), wastePct is hardcoded 5 (no org column to
  // coalesce with). The composer reads subprojects.defaults only; we never
  // touch orgs.consumable_markup_pct from here.
  const defaults = {
    consumablesPct:
      typeof input.consumable_markup_pct === 'number' && input.consumable_markup_pct > 0
        ? input.consumable_markup_pct
        : 10,
    wastePct: 5,
  }

  const rows = rooms.map((name, idx) => ({
    project_id: input.project_id,
    org_id: input.org_id,
    name,
    sort_order: idx,
    consumable_markup_pct: input.consumable_markup_pct ?? null,
    defaults,
  }))

  const { data, error } = await supabase
    .from('subprojects')
    .insert(rows)
    .select('id, name')
  if (error) {
    console.error('createRoomSubprojects', error)
    return []
  }
  return (data || []) as Array<{ id: string; name: string }>
}

/**
 * Turn parser output into estimate_lines on the room subprojects. Called
 * right after createRoomSubprojects so a fresh project lands with real
 * scope on its subs instead of empty placeholders.
 *
 * - Match items to subs by room name (case-insensitive, trimmed).
 * - If an item's room doesn't match any sub, skip it (the user can move it
 *   by opening the project and re-homing).
 * - Each line is freeform: description = item.name (plus "— room" hint if
 *   helpful), qty = linear_feet if present else quantity, unit = LF / each.
 * - Pack material_specs + finish_specs + features.notes into finish_specs +
 *   material_description + notes so the shop sees what the client spec'd
 *   when they open the line.
 */
export async function seedEstimateLinesFromParsed(input: {
  subsByRoom: Array<{ id: string; name: string }>
  items: ParsedScopeItem[]
}): Promise<number> {
  const { subsByRoom, items } = input
  if (items.length === 0 || subsByRoom.length === 0) return 0

  const subIdByRoom = new Map<string, string>()
  for (const s of subsByRoom) subIdByRoom.set(s.name.trim().toLowerCase(), s.id)

  // Group by subproject so we can hand out sequential sort_orders inside each.
  const rowsBySub = new Map<string, any[]>()
  for (const it of items) {
    const key = (it.room || '').trim().toLowerCase()
    const subId = subIdByRoom.get(key)
    if (!subId) continue

    const fs: any[] = []
    const ms = it.material_specs
    if (ms) {
      const ext = [ms.exterior_species, ms.exterior_thickness].filter(Boolean).join(' ').trim()
      const intr = [ms.interior_material, ms.interior_thickness].filter(Boolean).join(' ').trim()
      if (ext || it.finish_specs?.finish_type || it.finish_specs?.stain_color) {
        fs.push({
          material: ext || undefined,
          finish: it.finish_specs?.finish_type
            ? [it.finish_specs.finish_type, it.finish_specs.stain_color, it.finish_specs.sheen]
                .filter(Boolean).join(' · ')
            : undefined,
          notes: it.finish_specs?.notes || undefined,
        })
      }
      if (intr) {
        fs.push({ material: `${intr} interior`, finish: 'prefinished' })
      }
    }

    const quantity =
      typeof it.linear_feet === 'number' && it.linear_feet > 0 ? it.linear_feet : (it.quantity || 1)
    const unit = typeof it.linear_feet === 'number' && it.linear_feet > 0 ? 'lf' : 'each'

    const noteParts: string[] = []
    if (it.features?.notes) noteParts.push(it.features.notes)
    if (it.notes) noteParts.push(it.notes)
    if (it.features?.drawer_count) noteParts.push(`${it.features.drawer_count} drawers`)
    if (it.features?.door_style) noteParts.push(`${it.features.door_style} doors`)
    if (it.features?.trash_pullout) noteParts.push('trash pullout')
    if (it.features?.lazy_susan) noteParts.push('lazy susan')
    if (it.features?.has_led) noteParts.push('integrated LED')
    if (it.source_sheet) noteParts.push(`[${it.source_sheet}]`)
    if (it.needs_review) noteParts.push('(needs review)')

    const list = rowsBySub.get(subId) || []
    list.push({
      subproject_id: subId,
      sort_order: list.length,
      description: it.name,
      quantity,
      unit,
      material_description:
        it.material_specs?.exterior_species
          ? [
              it.material_specs.exterior_species,
              it.material_specs.exterior_thickness,
            ].filter(Boolean).join(' ')
          : null,
      finish_specs: fs.length ? fs : null,
      notes: noteParts.filter(Boolean).join(' · ') || null,
    })
    rowsBySub.set(subId, list)
  }

  const allRows = Array.from(rowsBySub.values()).flat()
  if (allRows.length === 0) return 0

  const { data, error } = await supabase
    .from('estimate_lines')
    .insert(allRows)
    .select('id')
  if (error) {
    console.error('seedEstimateLinesFromParsed', error)
    return 0
  }
  return (data || []).length
}

// ── Quick notes ──
// Phase 3 inline action: append a short note to a project straight from the
// sales dashboard / kanban, without opening the full project page.

export interface ProjectNote {
  id: string
  project_id: string
  body: string
  created_at: string
}

export async function addProjectNote(input: {
  org_id: string
  project_id: string
  body: string
  created_by?: string | null
}): Promise<ProjectNote | null> {
  const { data, error } = await supabase
    .from('project_notes')
    .insert({
      org_id: input.org_id,
      project_id: input.project_id,
      body: input.body,
      created_by: input.created_by ?? null,
    })
    .select('id, project_id, body, created_at')
    .single()
  if (error) {
    console.error('addProjectNote', error)
    return null
  }
  return data as ProjectNote
}

export async function loadProjectNotes(projectId: string): Promise<ProjectNote[]> {
  const { data, error } = await supabase
    .from('project_notes')
    .select('id, project_id, body, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    console.error('loadProjectNotes', error)
    return []
  }
  return (data as ProjectNote[]) || []
}

/**
 * Update stage on a project. Writes the single `stage` field; side-effect
 * bookkeeping (locking the estimate, firing the deposit, etc.) lives on the
 * handoff page, not here — this just moves the pointer.
 *
 * The kanban only offers sales stages. Post-sold transitions (sold →
 * production, production → installed, etc.) are buttons on the project cover.
 */
export async function updateProjectStage(
  projectId: string,
  stage: ProjectStage
): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ stage, updated_at: new Date().toISOString() })
    .eq('id', projectId)
  if (error) {
    console.error('updateProjectStage', error)
    throw error
  }
}

/**
 * Delete a project and its dependent rows. Most child tables are CASCADE on
 * project_id / subproject_id, but a handful (time_entries, invoices,
 * project_notes, cash_flow_receivables) aren't, so we clean those up first.
 * Idempotent — if a table doesn't exist in this environment the delete is
 * still considered successful (errors logged, not thrown).
 */
export async function deleteProject(projectId: string): Promise<void> {
  const childTables = [
    'time_entries',
    'invoices',
    'project_notes',
    'cash_flow_receivables',
    'project_milestones',
    'change_orders',
    'project_month_allocations',
  ]
  for (const table of childTables) {
    const { error } = await supabase.from(table).delete().eq('project_id', projectId)
    if (error && error.code !== '42P01') {
      // 42P01 = table doesn't exist; ignore so this helper works across envs.
      console.warn(`deleteProject ${table}`, error.message)
    }
  }
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) {
    console.error('deleteProject', error)
    throw error
  }
}
