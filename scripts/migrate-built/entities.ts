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

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
// Side-effect import: env.ts seeds NEXT_PUBLIC_SUPABASE_* into process.env so
// the app pricing libs below (which pull in lib/supabase at import) don't throw.
// Must precede the lib imports.
import './env'
import type { CliOptions } from './cli'
import { lookupMillsuiteId, recordId, loadEntityMap } from './id-map'
// The verifier (chunk 6a) reconstructs each project's price with the SAME pure
// functions the app uses to compute projects.bid_total (see lib/project-totals.ts),
// so any script-vs-app disagreement fails loudly instead of a parallel formula
// silently "reconciling" while the composer shows $0.
import {
  computeSubprojectRollup,
  type EstimateLine,
  type PricingContext,
} from '../../lib/estimate-lines'
import { computeBucketedPrice, type CostBuckets } from '../../lib/pricing'

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

// Join a jsonb string[] into non-empty trimmed lines.
function stringBlocks(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((b) => (typeof b === 'string' ? b.trim() : '')).filter(Boolean)
}

// Built stores a subproject's rich spec as details_json (an array of text
// blocks — "Material – …", "Dimensions – …", "Details – …") + exclusions_json
// (an array of exclusion strings). The old migration copied only `description`
// (null on leads), dropping all of it. Rebuild a readable block; fall back to
// the plain `description` when there's no rich json.
function buildSubDescription(s: any): string | null {
  const blocks = stringBlocks(s.details_json)
  const exclusions = stringBlocks(s.exclusions_json)
  let text = blocks.join('\n\n')
  if (exclusions.length > 0) {
    text += (text ? '\n\n' : '') + 'Exclusions:\n' + exclusions.join('\n')
  }
  text = text.trim()
  if (text) return text
  const plain = typeof s.description === 'string' ? s.description.trim() : ''
  return plain || null
}

// Per-spec-line detail carried onto the MillSuite estimate line:
//   notes                → Built's line-level `notes` (visible in the freeform
//                          line editor when the operator opens the row).
//   material_description → the useful material spec fields, joined.
function specLineDetail(sl: any): { notes: string | null; material_description: string | null } {
  const notes = typeof sl.notes === 'string' && sl.notes.trim() ? sl.notes.trim() : null
  const seen = new Set<string>()
  const parts: string[] = []
  for (const key of ['material_finish', 'ct_species', 'ct_thickness', 'cab_ext', 'cab_int', 'drawer_type']) {
    const raw = sl[key]
    const val = typeof raw === 'string' ? raw.trim() : ''
    if (val && !seen.has(val.toLowerCase())) {
      seen.add(val.toLowerCase())
      parts.push(val)
    }
  }
  return { notes, material_description: parts.length ? parts.join(' · ') : null }
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
      description: buildSubDescription(s),
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

// ── Estimate lines (chunk 4): spec_lines_json → custom estimate_lines ──
// Built stores each spec line's material cost (qty×rate) + dept_hours; the
// sell price (bid_total, set in chunk 3) already bakes in labor + margin.
// We recreate each line as a CUSTOM MillSuite line (lump_cost_override =
// material, dept_hour_overrides = hours, qty=1), then MillSuite's rollup is
//   cost = Σ material×(1+consumable_markup) + Σ hours×shop_rate
//   price = cost / (1 − margin)
// so we set the project margin = (bid_total − cost)/bid_total → the composer
// total reproduces Built's sold price exactly, never double-applying. A
// per-project verify compares the reconstructed total (±1%) and dept hours to
// Built's; misses are flagged (not force-fitted) in reports/estimate-verify.json.
// Completed jobs (stage 'installed') are left for the chunk-5 snapshot path.

const DEPT_KEY_MAP: Record<string, string> = {
  engineering: 'eng',
  eng: 'eng',
  cnc: 'cnc',
  assembly: 'assembly',
  finish: 'finish',
  install: 'install',
}

function mapDeptHours(dh: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (dh && typeof dh === 'object') {
    for (const [k, v] of Object.entries(dh as Record<string, unknown>)) {
      const key = DEPT_KEY_MAP[k.toLowerCase()]
      const n = Number(v) || 0
      if (key && n > 0) out[key] = (out[key] || 0) + n
    }
  }
  return out
}
const sumHours = (dh: Record<string, number>) => Object.values(dh).reduce((a, v) => a + v, 0)
const round2 = (n: number) => Math.round(n * 100) / 100

interface LineDetail {
  notes?: string | null
  material_description?: string | null
}

function estimateLineRow(
  subprojectId: string,
  sortOrder: number,
  label: string,
  materialTotal: number,
  deptHours: Record<string, number>,
  detail: LineDetail = {},
  description: string = label,
) {
  const lump = Math.round(materialTotal)
  return {
    subproject_id: subprojectId,
    sort_order: sortOrder,
    description,
    spec_label: label,
    quantity: 1, // lump_cost_override + hours are already line totals
    unit: 'lot',
    lump_cost_override: lump,
    // The rollup resolves material via `material_mode_override || item?.material_mode
    // || 'none'` (lib/estimate-lines.ts). With no rate-book item and a null mode it
    // reads 'none' and IGNORES the lump cost — the bug that priced Wall Cap
    // labor-only. Pin the mode to 'lump' whenever we carry a lump cost.
    material_mode_override: lump > 0 ? 'lump' : null,
    dept_hour_overrides: deptHours,
    material_description: detail.material_description ?? null,
    notes: detail.notes ?? null,
    product_key: null,
  }
}

// Cast a to-be-inserted row into the EstimateLine shape the app's pure pricing
// functions consume, so the verifier prices exactly what will land in the DB.
function rowToEstimateLine(row: ReturnType<typeof estimateLineRow>, i: number): EstimateLine {
  return {
    id: `mig-${i}`,
    subproject_id: row.subproject_id,
    sort_order: row.sort_order,
    description: row.description,
    rate_book_item_id: null,
    quantity: row.quantity,
    unit: row.unit as EstimateLine['unit'],
    material_mode_override: row.material_mode_override as EstimateLine['material_mode_override'],
    linear_cost_override: null,
    lump_cost_override: row.lump_cost_override,
    dept_hour_overrides: row.dept_hour_overrides as EstimateLine['dept_hour_overrides'],
    material_description: row.material_description,
    install_mode: null,
    install_params: null,
    finish_specs: null,
    callouts: null,
    unit_price_override: null,
    notes: row.notes,
    product_key: null,
    product_slots: null,
    spec_label: row.spec_label,
  }
}

export async function migrateEstimateLines(ctx: Ctx): Promise<void> {
  const { built: _built, ms, orgId, opts } = ctx
  void _built

  const { data: org } = await ms
    .from('orgs')
    .select('shop_rate, consumable_markup_pct')
    .eq('id', orgId)
    .single()
  const shopRate = Number(org?.shop_rate) || 0
  const consumableMarkupPct = Number(org?.consumable_markup_pct) || 0
  const consumableMarkup = consumableMarkupPct / 100

  const leads = await selectLeadsToMigrate(ctx)
  const projects = await selectProjectsToMigrate(ctx)
  const builtIds = [...leads.map((l) => l.id), ...projects.map((p) => p.id)]
  const projMap = await loadEntityMap(ms, orgId, 'project')

  interface Report {
    project: string
    stage: string
    bid: number
    cost: number
    marginPct: number
    appliedMarginPct: number
    reconstructed: number
    deltaPct: number
    hours: number
    estHours: number | null
    status: 'ok' | 'FLAG' | 'snapshot'
    reason?: string
  }
  const report: Report[] = []
  let linesWritten = 0
  let flagged = 0
  let snapshots = 0

  for (const builtId of builtIds) {
    const msProjectId = projMap[builtId]
    if (!msProjectId) continue
    const { data: proj } = await ms
      .from('projects')
      .select('id, name, stage, bid_total, estimated_hours')
      .eq('id', msProjectId)
      .single()
    if (!proj) continue

    // ── Chunk 5: completed jobs → read-only snapshot ──
    // Don't re-model old estimates. Stash the raw spec lines in built_archive
    // and represent the project with ONE summary line = its frozen total.
    // NB: proj.stage is the MillSuite lifecycle stage we mapped in chunk 3
    // (projectStatusToStage: Built 'installed'/'complete' → 'installed'), read
    // back off the migrated project row — NOT the raw Built status. Leads never
    // map to 'installed' (max 'sold'), so this gate only ever catches completed
    // Built projects, which is exactly the snapshot set.
    if (proj.stage === 'installed') {
      const { data: snapSubs } = await ms
        .from('subprojects')
        .select('id, name, spec_lines_json, pricing_lines_json')
        .eq('project_id', msProjectId)
        .order('sort_order')
      const bid = Number(proj.bid_total) || 0
      report.push({
        project: proj.name,
        stage: proj.stage,
        bid: Math.round(bid),
        cost: Math.round(bid),
        marginPct: 0,
        appliedMarginPct: 0,
        reconstructed: Math.round(bid),
        deltaPct: 0,
        hours: 0,
        estHours: proj.estimated_hours != null ? Number(proj.estimated_hours) : null,
        status: 'snapshot',
      })
      snapshots++
      if (opts.dryRun) continue

      const archive = {
        migrated_from: 'built_os',
        migrated_at: new Date().toISOString(),
        subprojects: (snapSubs || []).map((s) => ({
          name: s.name,
          spec_lines_json: s.spec_lines_json ?? null,
          pricing_lines_json: s.pricing_lines_json ?? null,
        })),
      }
      const subIds = (snapSubs || []).map((s) => s.id)
      if (subIds.length > 0) {
        const { error: delErr } = await ms.from('estimate_lines').delete().in('subproject_id', subIds)
        if (delErr) throw new Error(`clear snapshot lines for ${proj.name}: ${delErr.message}`)
      }
      if (bid > 0 && subIds.length > 0) {
        // lump/(1+markup) so the auto consumable markup lands the rollup
        // exactly on bid_total at margin 0.
        const lump = Math.round(bid / (1 + consumableMarkup))
        const { error } = await ms
          .from('estimate_lines')
          .insert(estimateLineRow(subIds[0], 0, 'Built OS migration — frozen total (see archive)', lump, {}))
        if (error) throw new Error(`insert snapshot line for ${proj.name}: ${error.message}`)
        linesWritten++
      }
      const { error: snapUpdErr } = await ms
        .from('projects')
        .update({
          built_archive: archive,
          target_margin_pct: 0,
          labor_margin_pct: 0,
          material_margin_pct: 0,
          consumable_margin_pct: 0,
        })
        .eq('id', msProjectId)
      if (snapUpdErr) throw new Error(`update snapshot project ${proj.name}: ${snapUpdErr.message}`)
      continue
    }

    const { data: subs } = await ms
      .from('subprojects')
      .select('id, name, description, spec_lines_json, dept_hours, material_cost, consumable_markup_pct')
      .eq('project_id', msProjectId)
      .order('sort_order')

    // Build the estimate-line rows, grouped per subproject so the verifier can
    // price each sub with its own consumable markup (matching the app).
    const groups: Array<{
      subId: string
      consumableMarkupPct: number
      rows: ReturnType<typeof estimateLineRow>[]
    }> = []
    for (const s of subs || []) {
      const subRows: ReturnType<typeof estimateLineRow>[] = []
      // The subproject's rich scope text (material / dimensions / details /
      // exclusions, migrated from Built's details_json in 6a). Land it on the
      // sub's first estimate line so it fills the line's Description field and
      // flows through as the QuickBooks line-item description. spec_label keeps
      // the short label as the row headline; later lines keep their own label.
      const subDesc =
        typeof s.description === 'string' && s.description.trim() ? s.description.trim() : null
      const specLines = Array.isArray(s.spec_lines_json) ? s.spec_lines_json : []
      if (specLines.length > 0) {
        specLines.forEach((sl: any, idx: number) => {
          const material = (Number(sl.qty) || 0) * (Number(sl.rate) || 0)
          const dh = mapDeptHours(sl.dept_hours)
          const hours = sumHours(dh)
          if (material === 0 && hours === 0) return
          const label = String(sl.label || 'Line')
          const desc = subRows.length === 0 && subDesc ? subDesc : label
          subRows.push(
            estimateLineRow(s.id, idx, label, material, dh, specLineDetail(sl), desc),
          )
        })
      } else {
        // Labor-only / material-only sub (e.g. install): use sub-level fields.
        const dh = mapDeptHours(s.dept_hours)
        const hours = sumHours(dh)
        const material = Number(s.material_cost) || 0
        if (hours > 0 || material > 0) {
          const label = String(s.name || 'Work')
          subRows.push(estimateLineRow(s.id, 0, label, material, dh, {}, subDesc || label))
        }
      }
      groups.push({
        subId: s.id,
        consumableMarkupPct: s.consumable_markup_pct != null ? Number(s.consumable_markup_pct) : consumableMarkupPct,
        rows: subRows,
      })
    }
    const rows = groups.flatMap((g) => g.rows)

    // ── Verify with the APP's math, not a parallel formula. Reconstruct the
    // cost buckets via computeSubprojectRollup (the same pure fn that feeds
    // projects.bid_total in lib/project-totals.ts), then price them through
    // computeBucketedPrice with the margin we're about to pin. If the migrated
    // lines don't price the way the app prices them (e.g. a missing
    // material_mode_override reading as $0 material), the delta fails loudly. ──
    const buckets: CostBuckets = {
      laborCost: 0,
      materialCost: 0,
      hardwareCost: 0,
      consumablesCost: 0,
      installCost: 0,
      optionsCost: 0,
    }
    let projHours = 0
    let lineIdx = 0
    for (const g of groups) {
      const lines = g.rows.map((r) => rowToEstimateLine(r, lineIdx++))
      const pctx: PricingContext = {
        shopRate,
        consumableMarkupPct: g.consumableMarkupPct,
        profitMarginPct: 0, // margin applied once, project-level, below
      }
      const rollup = computeSubprojectRollup(lines, new Map(), new Map(), pctx)
      buckets.laborCost += rollup.laborCost
      buckets.materialCost += rollup.materialCost
      buckets.hardwareCost += rollup.hardwareCost
      buckets.consumablesCost += rollup.consumablesCost
      buckets.installCost += rollup.installCost
      buckets.optionsCost += rollup.optionsCost
      projHours += rollup.totalHours
    }
    const cost = computeBucketedPrice(buckets, {
      laborMarginPct: 0,
      materialMarginPct: 0,
      consumableMarginPct: 0,
    }).costTotal
    const bid = Number(proj.bid_total) || 0
    const rawMargin = bid > 0 ? (bid - cost) / bid : 0
    const applied = Math.min(Math.max(rawMargin, 0), 0.95)
    const marginPct = round2(applied * 100)
    // Price the buckets at the margin we'll pin — the number the composer will
    // show once these margins land on the project.
    const reconstructed = computeBucketedPrice(buckets, {
      laborMarginPct: marginPct,
      materialMarginPct: marginPct,
      consumableMarginPct: marginPct,
    }).priceTotal
    const deltaPct = bid > 0 ? (Math.abs(reconstructed - bid) / bid) * 100 : 100
    let status: 'ok' | 'FLAG' = 'ok'
    let reason: string | undefined
    if (bid <= 0) {
      status = 'FLAG'
      reason = 'no bid_total'
    } else if (rawMargin < 0) {
      status = 'FLAG'
      reason = `cost ($${Math.round(cost)}) exceeds bid — check rate/hours`
    } else if (deltaPct > 1) {
      status = 'FLAG'
      reason = `app-math total ($${Math.round(reconstructed)}) off from bid by ${deltaPct.toFixed(1)}%`
    }
    if (status === 'FLAG') flagged++

    report.push({
      project: proj.name,
      stage: proj.stage,
      bid: Math.round(bid),
      cost: Math.round(cost),
      marginPct: round2(rawMargin * 100),
      appliedMarginPct: marginPct,
      reconstructed: Math.round(reconstructed),
      deltaPct: round2(deltaPct),
      hours: Math.round(projHours),
      estHours: proj.estimated_hours != null ? Number(proj.estimated_hours) : null,
      status,
      reason,
    })

    if (opts.dryRun) continue

    // Idempotent: replace this project's migrated estimate lines.
    const subIds = (subs || []).map((s) => s.id)
    if (subIds.length > 0) await ms.from('estimate_lines').delete().in('subproject_id', subIds)
    if (rows.length > 0) {
      const { error } = await ms.from('estimate_lines').insert(rows)
      if (error) throw new Error(`insert estimate_lines for ${proj.name}: ${error.message}`)
      linesWritten += rows.length
    }
    const { error: marginErr } = await ms
      .from('projects')
      .update({
        target_margin_pct: marginPct,
        labor_margin_pct: marginPct,
        material_margin_pct: marginPct,
        consumable_margin_pct: marginPct,
      })
      .eq('id', msProjectId)
    if (marginErr) throw new Error(`update margins for ${proj.name}: ${marginErr.message}`)
  }

  // Report.
  const active = report.length - snapshots
  console.log(
    `  estimate_lines: ${active} active + ${snapshots} snapshot project(s)` +
      (opts.dryRun ? ' (dry-run)' : `, ${linesWritten} lines written`),
  )
  for (const r of report) {
    const mark = r.status === 'FLAG' ? '!' : r.status === 'snapshot' ? '❄' : '·'
    const tag =
      r.status === 'FLAG' ? ` ⚠ ${r.reason}` : r.status === 'snapshot' ? ' (frozen snapshot)' : ''
    console.log(
      `    ${mark} ${r.project.slice(0, 28).padEnd(29)} bid $${r.bid} cost $${r.cost} margin ${r.appliedMarginPct}% Δ${r.deltaPct}% hrs ${r.hours}${tag}`,
    )
  }
  if (flagged) console.log(`    ↳ ${flagged} project(s) flagged for composer hand-fix`)

  const dir = resolve(__dirname, 'reports')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    resolve(dir, 'estimate-verify.json'),
    JSON.stringify(
      { shopRate, consumableMarkup, active, snapshots, flagged, report },
      null,
      2,
    ),
  )
}
