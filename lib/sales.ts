// ============================================================================
// sales.ts — data access for the sales pipeline (Phase 5 replacement for
// lib/leads.ts)
// ============================================================================
// Per parser-first-dashboard-mockup.html + BUILD-PLAN.md: leads are projects
// with a stage field, not a separate entity. This module hands the sales UI
// everything it needs by filtering / aggregating the `projects` table.
// ============================================================================

import { supabase } from './supabase'

// ── Types ──

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

export interface SalesProject {
  id: string
  name: string
  client_name: string | null
  client_id: string | null
  delivery_address: string | null
  stage: SalesStage
  status: string // 'bidding' | 'active' | 'completed' — in-shop lifecycle
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
      `id, name, client_name, client_id, delivery_address, stage, status,
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
      stage: (row.stage as SalesStage) || 'new_lead',
      status: row.status,
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
 * project" fallback on the sales dashboard and (for now) by the drop-zone
 * parser stub until the real parser ships.
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
      stage: 'new_lead' as SalesStage,
      status: 'bidding',
      bid_total: 0,
    })
    .select()
    .single()
  if (error) {
    console.error('createBlankLeadProject', error)
    return null
  }
  return {
    id: data.id,
    name: data.name,
    client_name: data.client_name,
    client_id: data.client_id ?? null,
    delivery_address: data.delivery_address ?? null,
    stage: (data.stage as SalesStage) || 'new_lead',
    status: data.status,
    bid_total: Number(data.bid_total) || 0,
    estimated_price:
      data.estimated_price != null ? Number(data.estimated_price) : null,
    created_at: data.created_at,
    updated_at: data.updated_at,
  }
}

/**
 * Update stage on a project. When advancing to 'sold', also flip status to
 * 'active' and set production_phase to 'pre_production' so the project
 * enters the in-shop lifecycle. When moving to 'lost', flip status to
 * 'cancelled'.
 */
export async function updateProjectStage(
  projectId: string,
  stage: SalesStage
): Promise<void> {
  const patch: any = {
    stage,
    updated_at: new Date().toISOString(),
  }
  if (stage === 'sold') {
    patch.status = 'active'
    patch.production_phase = 'pre_production'
  } else if (stage === 'lost') {
    patch.status = 'cancelled'
  } else {
    // Any pre-sold stage keeps the project in 'bidding' if it isn't already
    // past it. We don't downgrade an active/completed project back to bidding
    // if someone drags it back — that's a data-integrity concern the UI
    // handles with a warning.
    patch.status = 'bidding'
  }
  const { error } = await supabase.from('projects').update(patch).eq('id', projectId)
  if (error) {
    console.error('updateProjectStage', error)
    throw error
  }
}
