// ============================================================================
// scripts/migrate-built/entities.ts — chunk 3 entity migrations
// ============================================================================
// Structural rows + stage mapping, in dependency order:
//   client → project (Built leads + projects) → subproject → milestone
// Estimate-line translation is chunk 4 (active) / chunk 5 (snapshots).
//
// Every write goes through the id map (migration_id_map, migration 063) so a
// re-run updates instead of duplicating. --dry-run reads + prints the plan
// and writes nothing. --project scopes to one Built job (lead or project) +
// its children; --limit caps rows per entity.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CliOptions } from './cli'
import { lookupMillsuiteId, recordId, loadEntityMap } from './id-map'

export interface Scope {
  // When --project is set: the one Built job being migrated.
  kind: 'lead' | 'project' | null
  id: string | null
  clientId: string | null
}

export interface Ctx {
  built: SupabaseClient
  ms: SupabaseClient
  orgId: string
  opts: CliOptions
  scope: Scope
}

// ── Mappings ──

// Built lead status → MillSuite stage (1:1; 'lost' is skipped upstream).
const LEAD_STATUS_TO_STAGE: Record<string, string> = {
  new_lead: 'new_lead',
  fifty_fifty: 'fifty_fifty',
  ninety_percent: 'ninety_percent',
  sold: 'sold',
}

// Built project status → MillSuite lifecycle stage.
function projectStatusToStage(status: string | null): string {
  switch (status) {
    case 'sold':
    case 'pre_production':
      return 'sold'
    case 'scheduling':
    case 'in_production':
      return 'production'
    case 'installed':
    case 'complete':
      return 'installed'
    default:
      return 'sold'
  }
}

// Built payment_terms trigger → MillSuite milestone trigger.
const TRIGGER_MAP: Record<string, string> = {
  on_sale: 'signing',
  days_after_deposit: 'manual',
  midpoint: 'production',
  at_install: 'install_start',
  on_complete: 'punchout',
}
function mapTrigger(t: unknown): string {
  return TRIGGER_MAP[String(t)] || 'manual'
}

interface Milestone {
  pct: number
  label: string
  trigger: string
}
function milestonesOf(paymentTerms: unknown): Milestone[] {
  const ms = (paymentTerms as { milestones?: unknown })?.milestones
  if (!Array.isArray(ms)) return []
  return ms.map((m) => ({
    pct: Number((m as any).pct) || 0,
    label: String((m as any).label ?? 'Milestone'),
    trigger: String((m as any).trigger ?? 'manual'),
  }))
}

function num(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// Apply --limit to a query builder unless a single --project is scoped.
function withLimit<T>(q: T, ctx: Ctx): T {
  if (ctx.opts.limit != null && !ctx.scope.id) {
    return (q as any).limit(ctx.opts.limit) as T
  }
  return q
}

// ── Scope resolution (for --project) ──
export async function resolveScope(
  built: SupabaseClient,
  projectId: string | null,
): Promise<Scope> {
  if (!projectId) return { kind: null, id: null, clientId: null }
  const { data: proj } = await built
    .from('projects')
    .select('id, client_id')
    .eq('id', projectId)
    .maybeSingle()
  if (proj) return { kind: 'project', id: proj.id, clientId: proj.client_id ?? null }
  const { data: lead } = await built
    .from('leads')
    .select('id, client_id')
    .eq('id', projectId)
    .maybeSingle()
  if (lead) return { kind: 'lead', id: lead.id, clientId: lead.client_id ?? null }
  throw new Error(`--project ${projectId} not found in Built leads or projects`)
}

// ── Clients ──
export async function migrateClients(ctx: Ctx): Promise<void> {
  const { built, ms, orgId, opts, scope } = ctx
  let q = built.from('clients').select('*')
  if (scope.clientId) q = q.eq('id', scope.clientId)
  q = withLimit(q, ctx)
  const { data: rows, error } = await q
  if (error) throw new Error(`read Built clients: ${error.message}`)
  const clients = rows || []
  console.log(`  clients: ${clients.length} to migrate`)
  if (opts.dryRun) return

  let inserted = 0
  let updated = 0
  for (const c of clients) {
    const payload = {
      org_id: orgId,
      name: c.name ?? '',
      type: c.type ?? null,
      phone: c.phone ?? null,
      email: c.email ?? null,
      address: c.address ?? null,
      notes: c.notes ?? null,
    }
    const existing = await lookupMillsuiteId(ms, orgId, 'client', c.id)
    if (existing) {
      const { error: e } = await ms.from('clients').update(payload).eq('id', existing)
      if (e) throw new Error(`update client ${c.id}: ${e.message}`)
      updated++
    } else {
      const { data, error: e } = await ms.from('clients').insert(payload).select('id').single()
      if (e || !data) throw new Error(`insert client ${c.id}: ${e?.message}`)
      await recordId(ms, orgId, 'client', c.id, data.id)
      inserted++
    }
  }
  console.log(`    ↳ ${inserted} inserted, ${updated} updated`)
}

// Shared: which Built leads become MillSuite projects (open, not lost, not
// yet converted — converted ones come across via their project row).
async function selectLeadsToMigrate(ctx: Ctx): Promise<any[]> {
  const { built, scope } = ctx
  if (scope.id && scope.kind !== 'lead') return []
  let q = built.from('leads').select('*').is('converted_to_project_id', null).neq('status', 'lost')
  if (scope.kind === 'lead' && scope.id) q = q.eq('id', scope.id)
  q = withLimit(q, ctx)
  const { data, error } = await q
  if (error) throw new Error(`read Built leads: ${error.message}`)
  return data || []
}

async function selectProjectsToMigrate(ctx: Ctx): Promise<any[]> {
  const { built, scope } = ctx
  if (scope.id && scope.kind !== 'project') return []
  let q = built.from('projects').select('*')
  if (scope.kind === 'project' && scope.id) q = q.eq('id', scope.id)
  q = withLimit(q, ctx)
  const { data, error } = await q
  if (error) throw new Error(`read Built projects: ${error.message}`)
  return data || []
}

// Built client id → { name, email, phone } for denormalizing onto projects.
async function loadBuiltClients(built: SupabaseClient): Promise<Map<string, any>> {
  const { data } = await built.from('clients').select('id, name, email, phone')
  return new Map((data || []).map((c: any) => [c.id, c]))
}

// ── Projects (Built leads + projects → MillSuite projects) ──
export async function migrateProjects(ctx: Ctx): Promise<void> {
  const { built, ms, orgId, opts } = ctx
  const leads = await selectLeadsToMigrate(ctx)
  const projects = await selectProjectsToMigrate(ctx)

  // Count lost leads we're intentionally skipping (only when not scoped).
  if (!ctx.scope.id) {
    const { count: lost } = await built
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'lost')
    console.log(`  projects: ${leads.length} from open leads + ${projects.length} from projects` +
      (lost ? ` (skipping ${lost} lost leads)` : ''))
  } else {
    console.log(`  projects: ${leads.length} lead(s) + ${projects.length} project(s) in scope`)
  }
  if (opts.dryRun) return

  const builtClients = await loadBuiltClients(built)
  let inserted = 0
  let updated = 0

  async function upsertProject(builtId: string, payload: Record<string, unknown>) {
    const existing = await lookupMillsuiteId(ms, orgId, 'project', builtId)
    if (existing) {
      const { error } = await ms.from('projects').update(payload).eq('id', existing)
      if (error) throw new Error(`update project ${builtId}: ${error.message}`)
      updated++
    } else {
      const { data, error } = await ms.from('projects').insert(payload).select('id').single()
      if (error || !data) throw new Error(`insert project ${builtId}: ${error?.message}`)
      await recordId(ms, orgId, 'project', builtId, data.id)
      inserted++
    }
  }

  async function clientFields(clientId: string | null) {
    if (!clientId) return { client_id: null, client_name: null, client_email: null, client_phone: null }
    const millsuiteClientId = await lookupMillsuiteId(ms, orgId, 'client', clientId)
    const bc = builtClients.get(clientId)
    return {
      client_id: millsuiteClientId,
      client_name: bc?.name ?? null,
      client_email: bc?.email ?? null,
      client_phone: bc?.phone ?? null,
    }
  }

  for (const l of leads) {
    const cf = await clientFields(l.client_id ?? null)
    await upsertProject(l.id, {
      org_id: orgId,
      name: l.lead_name ?? 'Untitled',
      stage: LEAD_STATUS_TO_STAGE[l.status] ?? 'new_lead',
      bid_total: num(l.estimated_price) ?? 0,
      estimated_price: num(l.estimated_price),
      estimated_hours: num(l.estimated_hours),
      delivery_address: l.delivery_address ?? null,
      target_quarter: l.target_quarter ?? null,
      payment_terms: l.payment_terms ?? null,
      notes: l.scope_description ?? null,
      ...cf,
    })
  }

  for (const p of projects) {
    const cf = await clientFields(p.client_id ?? null)
    await upsertProject(p.id, {
      org_id: orgId,
      name: p.project_name ?? 'Untitled',
      stage: projectStatusToStage(p.status),
      bid_total: num(p.estimated_price) ?? 0,
      estimated_price: num(p.estimated_price),
      estimated_hours: num(p.estimated_hours),
      delivery_address: p.delivery_address ?? null,
      target_production_month: p.target_production_month ?? null,
      quoted_lead_time_weeks: num(p.quoted_lead_time_weeks),
      locked_shop_rate: num(p.locked_shop_rate),
      payment_terms: p.payment_terms ?? null,
      ...cf,
    })
  }
  console.log(`    ↳ ${inserted} inserted, ${updated} updated`)
}

// ── Subprojects (Built lead_subprojects + subprojects → subprojects) ──
export async function migrateSubprojects(ctx: Ctx): Promise<void> {
  const { built, ms, orgId, opts } = ctx
  if (opts.dryRun) {
    // Count only.
    const leads = await selectLeadsToMigrate(ctx)
    const projects = await selectProjectsToMigrate(ctx)
    let n = 0
    for (const l of leads) {
      const { count } = await built
        .from('lead_subprojects')
        .select('id', { count: 'exact', head: true })
        .eq('lead_id', l.id)
      n += count || 0
    }
    for (const p of projects) {
      const { count } = await built
        .from('subprojects')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', p.id)
      n += count || 0
    }
    console.log(`  subprojects: ${n} to migrate`)
    return
  }

  const projMap = await loadEntityMap(ms, orgId, 'project')
  let inserted = 0
  let updated = 0

  async function upsertSub(builtSubId: string, payload: Record<string, unknown>) {
    const existing = await lookupMillsuiteId(ms, orgId, 'subproject', builtSubId)
    if (existing) {
      const { error } = await ms.from('subprojects').update(payload).eq('id', existing)
      if (error) throw new Error(`update subproject ${builtSubId}: ${error.message}`)
      updated++
    } else {
      const { data, error } = await ms.from('subprojects').insert(payload).select('id').single()
      if (error || !data) throw new Error(`insert subproject ${builtSubId}: ${error?.message}`)
      await recordId(ms, orgId, 'subproject', builtSubId, data.id)
      inserted++
    }
  }

  function subPayload(s: any, millsuiteProjectId: string) {
    return {
      org_id: orgId,
      project_id: millsuiteProjectId,
      name: s.name ?? 'Subproject',
      sort_order: num(s.sequence_order) ?? 0,
      description: s.description ?? null,
      estimated_hours: num(s.estimated_hours),
      estimated_price: num(s.estimated_price),
      material_cost: num(s.material_cost),
      linear_feet: num(s.linear_feet),
      quality_type: s.quality_type ?? null,
      material_finish: s.material_finish ?? null,
      activity_type: s.activity_type ?? null,
      dimensions: s.dimensions ?? null,
      // Carry the estimate json across so chunk 4 can translate it in place;
      // ignore assembly_lines_json (v3, dead engine).
      dept_hours: s.dept_hours ?? null,
      spec_lines_json: s.spec_lines_json ?? null,
      pricing_lines_json: s.pricing_lines_json ?? null,
      details_json: s.details_json ?? null,
      exclusions_json: s.exclusions_json ?? null,
      specs_json: s.specs_json ?? null,
    }
  }

  // Lead subprojects → their MillSuite project.
  for (const l of await selectLeadsToMigrate(ctx)) {
    const msProjectId = projMap[l.id]
    if (!msProjectId) continue
    const { data: subs } = await built.from('lead_subprojects').select('*').eq('lead_id', l.id)
    for (const s of subs || []) await upsertSub(s.id, subPayload(s, msProjectId))
  }
  // Project subprojects → their MillSuite project.
  for (const p of await selectProjectsToMigrate(ctx)) {
    const msProjectId = projMap[p.id]
    if (!msProjectId) continue
    const { data: subs } = await built.from('subprojects').select('*').eq('project_id', p.id)
    for (const s of subs || []) await upsertSub(s.id, subPayload(s, msProjectId))
  }
  console.log(`    ↳ ${inserted} inserted, ${updated} updated`)
}

// ── Milestones (payment_terms.milestones → cash_flow_receivables) ──
// Idempotent per project: delete existing projected receivables, re-insert.
export async function migrateMilestones(ctx: Ctx): Promise<void> {
  const { built, ms, orgId, opts } = ctx
  const leads = await selectLeadsToMigrate(ctx)
  const projects = await selectProjectsToMigrate(ctx)
  const jobs = [
    ...leads.map((l) => ({ builtId: l.id, pt: l.payment_terms, price: num(l.estimated_price) ?? 0 })),
    ...projects.map((p) => ({ builtId: p.id, pt: p.payment_terms, price: num(p.estimated_price) ?? 0 })),
  ]

  if (opts.dryRun) {
    let n = 0
    let bad = 0
    for (const j of jobs) {
      const list = milestonesOf(j.pt)
      n += list.length
      const sum = list.reduce((s, m) => s + m.pct, 0)
      if (list.length && Math.abs(sum - 100) > 0.5) bad++
    }
    console.log(`  milestones: ${n} across ${jobs.length} project(s)` + (bad ? ` — ${bad} set(s) don't sum to 100 (will warn)` : ''))
    return
  }

  const projMap = await loadEntityMap(ms, orgId, 'project')
  let written = 0
  for (const j of jobs) {
    const msProjectId = projMap[j.builtId]
    if (!msProjectId) continue
    const list = milestonesOf(j.pt)
    if (list.length === 0) continue
    const sum = list.reduce((s, m) => s + m.pct, 0)
    if (Math.abs(sum - 100) > 0.5) {
      console.warn(`    ! project ${j.builtId} milestones sum to ${sum}% (not 100)`)
    }
    // Clear prior projected receivables for this project, then insert fresh.
    await ms
      .from('cash_flow_receivables')
      .delete()
      .eq('org_id', orgId)
      .eq('project_id', msProjectId)
      .eq('type', 'receivable')
      .eq('status', 'projected')
    const rows = list.map((m, idx) => ({
      org_id: orgId,
      project_id: msProjectId,
      type: 'receivable',
      status: 'projected',
      milestone_label: m.label,
      milestone_pct: m.pct,
      milestone_trigger: mapTrigger(m.trigger),
      amount: Math.round((j.price * m.pct) / 100),
      notes: `order:${idx}`,
    }))
    const { error } = await ms.from('cash_flow_receivables').insert(rows)
    if (error) throw new Error(`insert milestones for ${j.builtId}: ${error.message}`)
    written += rows.length
  }
  console.log(`    ↳ ${written} milestone rows written`)
}
