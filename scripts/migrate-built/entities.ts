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
import { importIds, type Manifest, type ManifestJob } from './manifest'
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
import { isInstallActivity } from '../../lib/subproject-description'
import { computeInstallHours } from '../../lib/install-prefill'

const INSTALL_HOURS_PER_DAY = 8

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
  /** Selective-migration pick list (6c). Only 'import' rows are migrated;
   *  everything else is skipped + logged. Required for a live run. */
  manifest: Manifest
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

/**
 * Positive-number-or-null. num() can't be used for rates: Number(null) === 0
 * and 0 is finite, so `num(x) ?? fallback` silently yields 0 instead of the
 * fallback — which is how imported jobs ended up with locked_shop_rate = 0
 * (the app then treated them as unset and priced at the CURRENT org rate,
 * disagreeing with the margin the script had derived at Built's rate).
 */
function posNum(v: unknown): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
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

/**
 * Client ids behind every non-skipped manifest job (6c). Reads the Built lead
 * and project rows named in the manifest and collects their client_id, so the
 * client migration pulls exactly those and no one else's.
 */
async function manifestClientIds(ctx: Ctx): Promise<string[]> {
  const { built, manifest } = ctx
  const leadIds = manifest.jobs
    .filter((j) => j.decision !== 'skip' && j.entity === 'lead')
    .map((j) => j.built_id)
  const projectIds = manifest.jobs
    .filter((j) => j.decision !== 'skip' && j.entity === 'project')
    .map((j) => j.built_id)
  const ids = new Set<string>()
  if (leadIds.length) {
    const { data } = await built.from('leads').select('client_id').in('id', leadIds)
    for (const r of data || []) if (r.client_id) ids.add(r.client_id)
  }
  if (projectIds.length) {
    const { data } = await built.from('projects').select('client_id').in('id', projectIds)
    for (const r of data || []) if (r.client_id) ids.add(r.client_id)
  }
  return [...ids]
}

// ── Clients ──
export async function migrateClients(ctx: Ctx): Promise<void> {
  const { built, ms, orgId, opts, scope } = ctx
  // 6c: clients follow their jobs — only the ones attached to a manifest row
  // that isn't 'skip' come across. Re-enter jobs bring their client too (that's
  // the point: the client record exists so Andrew can rebuild the estimate).
  const clientIds = await manifestClientIds(ctx)
  if (clientIds.length === 0) {
    console.log('  clients: 0 to migrate (no manifest jobs resolve to a client)')
    return
  }
  let q = built.from('clients').select('*').in('id', clientIds)
  if (scope.clientId) q = q.eq('id', scope.clientId)
  q = withLimit(q, ctx)
  const { data: rows, error } = await q
  if (error) throw new Error(`read Built clients: ${error.message}`)
  const clients = rows || []
  console.log(`  clients: ${clients.length} to migrate (from ${clientIds.length} manifest job clients)`)
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
  const { built, scope, manifest } = ctx
  if (scope.id && scope.kind !== 'lead') return []
  // 6c: leads are no longer pulled wholesale — only manifest 'import' rows.
  const ids = importIds(manifest, 'lead')
  if (ids.length === 0) return []
  let q = built.from('leads').select('*').in('id', ids)
  if (scope.kind === 'lead' && scope.id) {
    if (!ids.includes(scope.id)) return [] // --project outside the manifest
    q = q.eq('id', scope.id)
  }
  q = withLimit(q, ctx)
  const { data, error } = await q
  if (error) throw new Error(`read Built leads: ${error.message}`)
  return data || []
}

// Built project statuses we treat as "finished" — skipped entirely (Andrew's
// call: don't migrate completed jobs, don't snapshot them either).
const FINISHED_PROJECT_STATUSES = ['installed', 'complete']

async function selectProjectsToMigrate(ctx: Ctx): Promise<any[]> {
  const { built, scope, manifest } = ctx
  if (scope.id && scope.kind !== 'project') return []
  // 6c: manifest-driven. The finished-status guard stays as a backstop — a
  // finished job shouldn't be on the pick list, but don't import one if it is.
  const ids = importIds(manifest, 'project')
  if (ids.length === 0) return []
  let q = built
    .from('projects')
    .select('*')
    .in('id', ids)
    .not('status', 'in', '("installed","complete")')
  if (scope.kind === 'project' && scope.id) {
    if (!ids.includes(scope.id)) return []
    q = q.eq('id', scope.id)
  }
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

  // Count the rows we're intentionally skipping (only when not scoped).
  if (!ctx.scope.id) {
    const { count: lost } = await built
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'lost')
    const { count: finished } = await built
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .in('status', FINISHED_PROJECT_STATUSES)
    const skips: string[] = []
    if (lost) skips.push(`${lost} lost leads`)
    if (finished) skips.push(`${finished} finished projects`)
    console.log(
      `  projects: ${leads.length} from open leads + ${projects.length} from projects` +
        (skips.length ? ` (skipping ${skips.join(', ')})` : ''),
    )
  } else {
    console.log(`  projects: ${leads.length} lead(s) + ${projects.length} project(s) in scope`)
  }
  if (opts.dryRun) return

  const builtClients = await loadBuiltClients(built)
  let inserted = 0
  let updated = 0

  async function upsertProject(builtId: string, payload: Record<string, unknown>) {
    // 6c: stamp every migrated project so the UI can badge it "IMPORTED".
    // Set on insert and preserved on re-run (idempotent — keeps the original
    // import timestamp rather than bumping it each pass).
    const existing = await lookupMillsuiteId(ms, orgId, 'project', builtId)
    if (existing) {
      // Keep the ORIGINAL import timestamp on re-run; only backfill if unset
      // (e.g. a project migrated before 080 added the column).
      const { data: cur } = await ms
        .from('projects')
        .select('imported_at')
        .eq('id', existing)
        .maybeSingle()
      const stamp = (cur as any)?.imported_at
        ? {}
        : { imported_at: new Date().toISOString() }
      const { error } = await ms
        .from('projects')
        .update({ ...payload, ...stamp })
        .eq('id', existing)
      if (error) throw new Error(`update project ${builtId}: ${error.message}`)
      updated++
    } else {
      const { data, error } = await ms
        .from('projects')
        .insert({ ...payload, imported_at: new Date().toISOString() })
        .select('id')
        .single()
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
      // Pin the job's labor rate (6c) — Built's rate, never MillSuite's.
      // Costing an imported job at MillSuite's current rate inflates labor on
      // every subproject; the project margin then absorbs it, so the total
      // still lands on the sold price while the sub-level numbers drift off
      // Built's. Leads store labor_rate; the manifest carries Built's
      // effective rate for the (many) rows that have none.
      locked_shop_rate: posNum(l.labor_rate) ?? ctx.manifest.builtShopRate,
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
      // Built's own locked rate when it has one, else Built's effective rate
      // from the manifest. Never MillSuite's org rate — see the lead branch.
      locked_shop_rate: posNum(p.locked_shop_rate) ?? ctx.manifest.builtShopRate,
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
      // Pin Built's consumables % on the sub. The APP reads this column
      // (falling back to the org's 15%), so without it the app would price
      // consumables 5 points higher than the script did and the two would
      // disagree on the same job.
      consumable_markup_pct: ctx.manifest.builtConsumablesPct,
      quality_type: s.quality_type ?? null,
      material_finish: s.material_finish ?? null,
      activity_type: s.activity_type ?? null,
      dimensions: s.dimensions ?? null,
      // Install prefill — Built's install subs carry men/days here; map them to
      // MillSuite's install prefill columns so the migrated install block
      // prices via guys×days×rate (not just raw install dept-hours). Non-install
      // subs have these null in Built, so this is a no-op for them. Flag the
      // sub as install-included when it carries install (066).
      install_guys: num(s.install_men),
      install_days: num(s.install_days),
      install_included: (num(s.install_men) ?? 0) > 0,
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
) {
  const lump = Math.round(materialTotal)
  return {
    subproject_id: subprojectId,
    sort_order: sortOrder,
    description: label,
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
  // Imported jobs consume at BUILT's rate, not MillSuite's org default —
  // otherwise the same materials cost more here than the client was quoted
  // (Built 10% vs MillSuite 15% on this org) and the derived margin has to
  // absorb the gap, pushing every subproject's number off.
  const consumableMarkupPct =
    ctx.manifest.builtConsumablesPct ?? (Number(org?.consumable_markup_pct) || 0)
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
      .select('id, name, stage, bid_total, estimated_hours, locked_shop_rate')
      .eq('id', msProjectId)
      .single()
    if (!proj) continue

    // The rate this job is priced at. Built's own locked rate wins; where
    // Built never recorded one we pin the CURRENT org rate, which both
    // reproduces the numbers we're importing today and freezes them against
    // future shop-rate changes. Critically this is the same rate the app's
    // rollup will use (lib/project-totals reads locked_shop_rate), so the
    // margin derived below reproduces the sold price in the app exactly.
    // Pinned by migrateProjects from Built's rate. Falling back to the org
    // rate here would re-introduce the very drift the pin exists to prevent,
    // so only do it if the pin is somehow missing.
    const projRate =
      Number((proj as any).locked_shop_rate) || ctx.manifest.builtShopRate || shopRate

    // Finished jobs are excluded upstream (selectProjectsToMigrate skips Built
    // 'installed'/'complete'), so no snapshotting — Andrew's call is to not pull
    // completed jobs in at all. Defensive: if an installed-stage project ever
    // slips through, skip it rather than re-model or snapshot it.
    if (proj.stage === 'installed') continue

    const { data: subs } = await ms
      .from('subprojects')
      .select(
        'id, name, activity_type, spec_lines_json, dept_hours, material_cost, consumable_markup_pct, install_guys, install_days, install_complexity_pct, install_rate_per_hour',
      )
      .eq('project_id', msProjectId)
      .order('sort_order')

    // Install blocks price via the install prefill (guys × days × rate), NOT via
    // estimate lines — so we skip their lines and add the prefill cost to the
    // verify buckets. Writing both would double-count install (the app folds the
    // prefill in on top of any install-dept-hours line).
    let installBucketCost = 0
    let installBucketHours = 0

    // Build the estimate-line rows, grouped per subproject so the verifier can
    // price each sub with its own consumable markup (matching the app).
    const groups: Array<{
      subId: string
      consumableMarkupPct: number
      rows: ReturnType<typeof estimateLineRow>[]
    }> = []
    for (const s of subs || []) {
      const subRows: ReturnType<typeof estimateLineRow>[] = []
      // Install block → no estimate lines; price it from the install prefill so
      // it's counted exactly once (matches the app's InstallPrefill rollup).
      if (isInstallActivity(s.activity_type)) {
        const guys = Number(s.install_guys) || 0
        const days = Number(s.install_days) || 0
        const rate = Number(s.install_rate_per_hour) || projRate
        const pct = Number(s.install_complexity_pct) || 0
        if (guys > 0 && days > 0 && rate > 0) {
          const h = guys * days * INSTALL_HOURS_PER_DAY
          installBucketHours += h
          installBucketCost += h * rate * (1 + pct / 100)
        }
        groups.push({
          subId: s.id,
          consumableMarkupPct:
            s.consumable_markup_pct != null ? Number(s.consumable_markup_pct) : consumableMarkupPct,
          rows: [],
        })
        continue
      }
      const specLines = Array.isArray(s.spec_lines_json) ? s.spec_lines_json : []
      if (specLines.length > 0) {
        specLines.forEach((sl: any, idx: number) => {
          const material = (Number(sl.qty) || 0) * (Number(sl.rate) || 0)
          const dh = mapDeptHours(sl.dept_hours)
          const hours = sumHours(dh)
          if (material === 0 && hours === 0) return
          // Line label stays short (Built's "spec line"). The rich scope text
          // lives on the subproject (details_json / exclusions_json) and is
          // rendered + edited in the scope editor, then assembled into the QB
          // line description at push time (buildRichDescription).
          subRows.push(
            estimateLineRow(s.id, idx, String(sl.label || 'Line'), material, dh, specLineDetail(sl)),
          )
        })
      } else {
        // Labor-only / material-only sub (e.g. install): use sub-level fields.
        const dh = mapDeptHours(s.dept_hours)
        const hours = sumHours(dh)
        const material = Number(s.material_cost) || 0
        if (hours > 0 || material > 0) {
          subRows.push(estimateLineRow(s.id, 0, String(s.name || 'Work'), material, dh))
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
        shopRate: projRate,
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
    // Install blocks priced off the prefill (not lines) — fold them in once.
    buckets.installCost += installBucketCost
    projHours += installBucketHours
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

    // Re-freeze the sold price. Inserting estimate_lines fires the app's
    // recomputeProjectBidTotalForLine, which rewrites bid_total from the
    // margins stored at that moment — i.e. the PREVIOUS run's. Left alone the
    // next run derives its margin from that polluted bid and the price walks
    // away from what the client signed (Batia drifted $160,139 → $165,689 this
    // way). Built's audited price from the manifest is authoritative.
    const frozenBid = ctx.manifest.byId.get(builtId)?.expected_price ?? bid
    if (frozenBid > 0) {
      const { error: bidErr } = await ms
        .from('projects')
        .update({ bid_total: frozenBid })
        .eq('id', msProjectId)
      if (bidErr) throw new Error(`re-freeze bid_total for ${proj.name}: ${bidErr.message}`)
    }
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

// ── 6c: re-enter reference sheets ──

/**
 * For every manifest row marked 're-enter', dump what Built knows about the
 * job (scope text, spec lines, price, dept hours) to a reference sheet so
 * Andrew can rebuild the estimate natively in MillSuite with the new rate
 * book. No project/estimate rows are written for these — only the client
 * (handled by migrateClients).
 */
export async function dumpReEnterSheets(ctx: Ctx): Promise<void> {
  const { built, manifest } = ctx
  const rows = manifest.jobs.filter((j) => j.decision === 're-enter')
  if (rows.length === 0) {
    console.log('  re-enter: none listed')
    return
  }
  const sheets: any[] = []
  for (const j of rows) {
    const table = j.entity === 'lead' ? 'leads' : 'projects'
    const { data: job } = await built.from(table).select('*').eq('id', j.built_id).maybeSingle()
    const subTable = j.entity === 'lead' ? 'lead_subprojects' : 'subprojects'
    const fk = j.entity === 'lead' ? 'lead_id' : 'project_id'
    const { data: subs } = await built.from(subTable).select('*').eq(fk, j.built_id)
    sheets.push({
      name: j.name,
      built_id: j.built_id,
      entity: j.entity,
      expected_price: j.expected_price,
      expected_hours: j.expected_hours,
      client_id: (job as any)?.client_id ?? null,
      status: (job as any)?.status ?? null,
      subprojects: (subs || []).map((s: any) => ({
        name: s.name ?? s.title ?? null,
        activity_type: s.activity_type ?? null,
        description: s.description ?? null,
        details: s.details_json ?? null,
        exclusions: s.exclusions_json ?? null,
        price: s.price ?? s.total_price ?? null,
        spec_lines: s.spec_lines_json ?? null,
      })),
    })
  }
  const dir = resolve(__dirname, 'reports')
  mkdirSync(dir, { recursive: true })
  const out = resolve(dir, 're-enter-reference.json')
  writeFileSync(out, JSON.stringify({ generated_for: sheets.length, sheets }, null, 2))
  console.log(`  re-enter: ${sheets.length} reference sheet(s) → ${out}`)
  for (const s of sheets) {
    console.log(`    · ${s.name} — $${s.expected_price ?? '?'} / ${s.expected_hours ?? '?'} hrs, ${s.subprojects.length} sub(s)`)
  }
}

// ── 6c: checksum verification ──

/**
 * After an import, compare each manifest job's MillSuite bid_total + dept
 * hours against the Built-side checksums recorded in the manifest. Drift is
 * FLAGGED loudly (and written to reports/manifest-verify.json) rather than
 * silently accepted — this is the guard that a job came across whole.
 */
export async function verifyAgainstManifest(ctx: Ctx): Promise<void> {
  const { ms, orgId, manifest, opts, scope } = ctx
  if (opts.dryRun) {
    console.log('  checksums: skipped (dry-run — nothing imported to verify)')
    return
  }
  // Scoped run (--project) verifies only that job; otherwise every import row.
  // Without this a single-job test pass reports the other 11 as "NOT IMPORTED".
  const jobs = manifest.jobs.filter(
    (j) => j.decision === 'import' && (!scope.id || j.built_id === scope.id),
  )
  const report: any[] = []
  let flagged = 0

  for (const j of jobs) {
    const projectId = await lookupMillsuiteId(ms, orgId, 'project', j.built_id)
    if (!projectId) {
      report.push({ name: j.name, built_id: j.built_id, status: 'MISSING', reason: 'not imported' })
      flagged++
      continue
    }
    const { data: proj } = await ms
      .from('projects')
      .select('bid_total')
      .eq('id', projectId)
      .maybeSingle()
    const bid = Math.round(Number((proj as any)?.bid_total) || 0)

    // Hours = estimate-line dept hours PLUS install-prefill hours. Install
    // subs deliberately carry no estimate lines (they price from guys × days ×
    // rate — see migrateEstimateLines), so summing lines alone undercounts a
    // job by exactly its install hours. Uses the app's own computeInstallHours
    // so the two can't drift.
    const { data: subs } = await ms
      .from('subprojects')
      .select('id, install_guys, install_days, install_complexity_pct, install_included')
      .eq('project_id', projectId)
    const subIds = (subs || []).map((s: any) => s.id)
    let hours = 0
    if (subIds.length) {
      const { data: lines } = await ms
        .from('estimate_lines')
        .select('quantity, dept_hour_overrides')
        .in('subproject_id', subIds)
      for (const l of lines || []) {
        const o = (l as any).dept_hour_overrides || {}
        const perUnit =
          (Number(o.eng) || 0) + (Number(o.cnc) || 0) + (Number(o.assembly) || 0) +
          (Number(o.finish) || 0) + (Number(o.install) || 0)
        hours += perUnit * (Number((l as any).quantity) || 0)
      }
    }
    for (const s of subs || []) {
      hours += computeInstallHours({
        guys: (s as any).install_guys,
        days: (s as any).install_days,
        complexityPct: (s as any).install_complexity_pct,
        included: (s as any).install_included,
      })
    }
    hours = Math.round(hours)

    const expPrice = j.expected_price == null ? null : Math.round(j.expected_price)
    const expHours = j.expected_hours == null ? null : Math.round(j.expected_hours)
    // Price tolerance: $25 or 0.05%, whichever is larger. The migration
    // back-solves a project margin so the rollup reproduces Built's sold
    // price; that division rounds, so a six-figure job can land a few dollars
    // off. Real drift (a changed shop rate, a dropped subproject) moves the
    // number by hundreds or thousands, well outside this band.
    const priceTol = expPrice == null ? 0 : Math.max(25, expPrice * 0.0005)
    const priceDelta = expPrice == null ? 0 : bid - expPrice
    const priceOk = expPrice == null || Math.abs(priceDelta) <= priceTol
    // Hours allow 1% slack (per-unit hours × qty vs Built's stored total).
    const hoursOk =
      expHours == null || expHours === 0
        ? true
        : Math.abs(hours - expHours) / expHours <= 0.01
    const status = priceOk && hoursOk ? 'ok' : 'FLAG'
    if (status === 'FLAG') flagged++
    report.push({
      name: j.name,
      built_id: j.built_id,
      millsuite_project_id: projectId,
      bid,
      expected_price: expPrice,
      priceDelta,
      priceOk,
      hours,
      expected_hours: expHours,
      hoursOk,
      status,
    })
  }

  console.log(`  checksums: ${jobs.length} job(s) verified against the manifest`)
  for (const r of report) {
    if (r.status === 'MISSING') {
      console.log(`    ! ${String(r.name).slice(0, 34).padEnd(35)} NOT IMPORTED`)
      continue
    }
    const mark = r.status === 'FLAG' ? '!' : '·'
    const priceTag = r.priceOk
      ? `$${r.bid}` + (r.priceDelta ? ` (${r.priceDelta > 0 ? '+' : ''}${r.priceDelta} rounding)` : '')
      : `$${r.bid} ≠ $${r.expected_price} ⚠`
    const hoursTag = r.hoursOk ? `${r.hours}h` : `${r.hours}h ≠ ${r.expected_hours}h ⚠`
    console.log(`    ${mark} ${String(r.name).slice(0, 34).padEnd(35)} ${priceTag} · ${hoursTag}`)
  }
  if (flagged) {
    console.log(`    ↳ ⚠ ${flagged} job(s) DRIFTED from the Built checksums — inspect before continuing`)
  } else if (jobs.length) {
    console.log('    ↳ all imported jobs match Built on price + hours')
  }

  const dir = resolve(__dirname, 'reports')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    resolve(dir, 'manifest-verify.json'),
    JSON.stringify({ verified: jobs.length, flagged, report }, null, 2),
  )
}

// ── 6c-2: FROZEN import pricing ─────────────────────────────────────────────
// Supersedes the margin-reconstruction path above. These jobs were already
// quoted in Built; the price cannot vary. We do NOT try to make MillSuite's
// engine reproduce Built's math. Instead each Built sub becomes ONE line
// carrying its price verbatim, with hours preserved for scheduling +
// est-vs-actual and material kept as a budget number. lib/project-totals prices
// imported jobs with a zero rate / zero consumables / zero margin context, so
// the stored prices ARE the total — summing exactly to Built's contract price.
//
// The per-sub prices come from Built's OWN rollup, reproduced below. The catch:
// the pricing lives on the LEAD (`lead_subprojects.profit_multiplier`), not on
// the converted project — `subprojects` has no multiplier column at all, which
// is why an earlier pass concluded the per-sub splits weren't stored and fell
// back to a cost-weighted allocation. They are stored; they're just one table
// over. `builtSubPrices` walks `leads.converted_to_project_id` back to the lead.

/** Countertop board-foot multipliers — Built's CT_THICKNESS_MULT. */
const CT_THICKNESS_MULT: Record<string, number> = { '4/4"': 1.0, '6/4"': 1.5, '8/4"': 2.0 }

/** Material for a Built spec line. Ported from Built's `computeLineAmount`
 *  (lib/pricing.ts) — countertops price off board feet, vendor/sub lines carry
 *  Built's markup, everything else is qty × rate. */
function builtLineMaterial(l: any): number {
  const rate = Number(l?.rate) || 0
  if (l?.prefil === 'countertop') {
    const tm = CT_THICKNESS_MULT[l?.ct_thickness] ?? 1.5
    const dims = Array.isArray(l?.ct_dimensions) ? l.ct_dimensions : []
    const bdft = dims.reduce(
      (s: number, d: any) =>
        s +
        (((Number(d?.length) || 0) * (Number(d?.width) || 0)) / 144) *
          tm *
          (Number(d?.qty) || 0) *
          1.25,
      0,
    )
    return bdft * rate
  }
  if (l?.prefil === 'vendor_sub') {
    const base = Math.max(Number(l?.qty) || 0, 1) * rate
    return base * (1 + (Number(l?.markup_pct) || 0) / 100)
  }
  return (Number(l?.qty) || 0) * rate
}

function deptHoursOf(d: any): Record<string, number> {
  const src = d || {}
  return {
    eng: Number(src.engineering) || 0,
    cnc: Number(src.cnc) || 0,
    assembly: Number(src.assembly) || 0,
    finish: Number(src.finish) || 0,
    install: Number(src.install) || 0,
  }
}

/** Normalized name key for matching a Built lead sub to its migrated twin. */
function subKey(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

interface BuiltSubPrice {
  key: string
  name: string
  price: number
  material: number
}

/**
 * Built's own per-subproject prices for a job, reproduced from
 * `lead_subprojects` with Built's `rollupSubproject` math:
 *
 *   millwork: material + consumables + labor × profit_multiplier
 *   install:  days × men × hours_per_day × rate × profit_multiplier
 *
 * `builtId` may be a lead id (manifest entity 'lead') or a converted project id
 * (entity 'project') — both resolve to the same lead. Returns null when there's
 * no lead behind the job, which drops the caller back to a cost-weighted split.
 */
async function builtSubPrices(
  ctx: Ctx,
  builtId: string,
  shopRate: number,
  orgConsumablesPct: number,
): Promise<BuiltSubPrice[] | null> {
  const { built } = ctx
  const { data: byId } = await built
    .from('leads')
    .select('id, consumables_percent')
    .eq('id', builtId)
    .maybeSingle()
  let lead = byId as { id: string; consumables_percent: number | null } | null
  if (!lead) {
    const { data: byProject } = await built
      .from('leads')
      .select('id, consumables_percent')
      .eq('converted_to_project_id', builtId)
      .maybeSingle()
    lead = byProject as { id: string; consumables_percent: number | null } | null
  }
  if (!lead) return null

  const { data: subs } = await built
    .from('lead_subprojects')
    .select('*')
    .eq('lead_id', lead.id)
    .order('sequence_order')
  if (!subs || subs.length === 0) return null

  const leadConsumables = Number(lead.consumables_percent)
  const fallbackConsumables = Number.isFinite(leadConsumables)
    ? leadConsumables
    : orgConsumablesPct

  return subs.map((s: any) => {
    const mult =
      typeof s.profit_multiplier === 'number' && s.profit_multiplier > 0
        ? s.profit_multiplier
        : s.kind === 'install'
          ? 1.0
          : 1.25
    if (s.kind === 'install') {
      const hours =
        (Number(s.install_days) || 0) *
        (Number(s.install_men) || 0) *
        (Number(s.install_hours_per_day) || 8)
      const rate = Number(s.install_rate_per_hour) || 68
      return { key: subKey(s.name), name: s.name, price: hours * rate * mult, material: 0 }
    }
    const specs = Array.isArray(s.spec_lines_json) ? s.spec_lines_json : []
    const material = specs.length
      ? specs.reduce((a: number, l: any) => a + builtLineMaterial(l), 0)
      : Number(s.material_cost) || 0
    const hours = Object.values(deptHoursOf(s.dept_hours)).reduce((a, b) => a + b, 0)
    const consumablesPct =
      typeof s.consumables_pct === 'number' && s.consumables_pct >= 0
        ? s.consumables_pct
        : fallbackConsumables
    const consumables = material * (consumablesPct / 100)
    const labor = hours * shopRate
    return {
      key: subKey(s.name),
      name: s.name,
      price: material + consumables + labor * mult,
      material,
    }
  })
}

export async function migrateEstimateLinesFrozen(ctx: Ctx): Promise<void> {
  const { ms, orgId, opts, manifest } = ctx
  const leads = await selectLeadsToMigrate(ctx)
  const projects = await selectProjectsToMigrate(ctx)
  const builtIds = [...leads.map((l) => l.id), ...projects.map((p) => p.id)]
  const projMap = await loadEntityMap(ms, orgId, 'project')
  const consumPct = manifest.builtConsumablesPct ?? 10
  const builtRate = manifest.builtShopRate ?? 0

  const report: Array<Record<string, unknown>> = []
  let linesWritten = 0

  for (const builtId of builtIds) {
    const msProjectId = projMap[builtId]
    if (!msProjectId) continue
    const job = manifest.byId.get(builtId)
    const { data: proj } = await ms
      .from('projects')
      .select('id, name, stage, bid_total')
      .eq('id', msProjectId)
      .single()
    if (!proj || proj.stage === 'installed') continue

    // The contract price is Built's audited number from the manifest — never a
    // value read back out of MillSuite, which the app's auto-recompute can have
    // already moved.
    const contract = Math.round(Number(job?.expected_price ?? proj.bid_total) || 0)

    const { data: subs } = await ms
      .from('subprojects')
      .select('id, name, activity_type, spec_lines_json, dept_hours, install_guys, install_days')
      .eq('project_id', msProjectId)
      .order('sort_order')

    const rows: Array<{
      subId: string
      name: string
      material: number
      hours: Record<string, number>
      totalHours: number
      basis: number
    }> = []
    for (const s of subs || []) {
      const specs = Array.isArray((s as any).spec_lines_json) ? (s as any).spec_lines_json : []
      const material = specs.reduce((a: number, l: any) => a + builtLineMaterial(l), 0)
      const hours = deptHoursOf((s as any).dept_hours)
      const totalHours = Object.values(hours).reduce((a, b) => a + b, 0)
      // Cost basis — only used by the fallback split below.
      const basis = material * (1 + consumPct / 100) + totalHours * builtRate
      rows.push({ subId: (s as any).id, name: (s as any).name ?? 'Subproject', material, hours, totalHours, basis })
    }

    // ── Per-sub prices ──────────────────────────────────────────────────────
    // Preferred: Built's own numbers, reproduced from the lead (see
    // `builtSubPrices`). Matched to the migrated subs by name — the converted
    // project's subs are copies of the lead's, so the names line up; anything
    // unmatched falls back to position.
    const built = await builtSubPrices(ctx, builtId, builtRate, consumPct)
    let exact: number[] = []
    let source: 'built' | 'allocated' = 'allocated'
    if (built && built.length > 0) {
      const byKey = new Map(built.map((b) => [b.key, b]))
      const matched = rows.map((r, i) => byKey.get(subKey(r.name)) ?? built[i] ?? null)
      const complete = matched.every(Boolean)
      const sum = matched.reduce((a, m) => a + (m?.price ?? 0), 0)
      // Built rounds each sub for display and the lead price is the rounded
      // sum, so a couple of dollars of drift is expected; anything more means
      // the lead and the quote have diverged (subs added/removed after the
      // sale, or a profit multiplier backfilled to the 1.25 default by Built's
      // own later migration) and the split can't be trusted.
      if (complete && Math.abs(sum - contract) <= 5) {
        exact = matched.map((m) => m!.price)
        source = 'built'
      } else {
        console.log(
          `    ! ${proj.name}: Built per-sub prices sum to $${Math.round(sum)} vs contract $${contract}` +
            `${complete ? '' : ' (unmatched subs)'} — falling back to a cost-weighted split`,
        )
      }
    }
    if (exact.length === 0) {
      const basisTotal = rows.reduce((a, r) => a + r.basis, 0)
      exact = rows.map((r, i) =>
        basisTotal > 0 ? (contract * r.basis) / basisTotal : i === 0 ? contract : 0,
      )
    }
    // Round to whole dollars by largest remainder, so every sub lands within $1
    // of its exact value AND the set sums to EXACTLY the contract price (6c-2
    // makes that an equality, not a tolerance).
    const prices = exact.map((v) => Math.floor(v))
    let short = contract - prices.reduce((a, b) => a + b, 0)
    const byFraction = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac)
    for (let k = 0; short > 0 && byFraction.length > 0; k++, short--) {
      prices[byFraction[k % byFraction.length].i] += 1
    }
    // Over-allocated (only reachable via the fallback split): shave the largest.
    while (short < 0 && prices.length > 0) {
      let big = 0
      for (let i = 1; i < prices.length; i++) if (prices[i] > prices[big]) big = i
      prices[big] -= 1
      short++
    }

    report.push({
      project: proj.name,
      contract,
      subs: rows.length,
      allocated: prices.reduce((a, b) => a + b, 0),
      hours: Math.round(rows.reduce((a, r) => a + r.totalHours, 0)),
      material: Math.round(rows.reduce((a, r) => a + r.material, 0)),
      source,
      // Per-sub detail so Andrew can spot-check a job against Built's own
      // subproject cards without opening the DB.
      lines: rows.map((r, i) => ({
        sub: r.name,
        price: prices[i],
        hours: r.totalHours,
        material: Math.round(r.material),
      })),
    })

    if (opts.dryRun) continue

    // Replace this project's migrated lines with the frozen set.
    const subIds = rows.map((r) => r.subId)
    if (subIds.length > 0) await ms.from('estimate_lines').delete().in('subproject_id', subIds)

    const inserts = rows.map((r, i) => ({
      subproject_id: r.subId,
      sort_order: 0,
      description: r.name,
      quantity: 1,
      unit: 'job',
      // The quoted price, carried as the line's cost. Imported projects price
      // with a zero-rate/zero-margin context, so cost == price == quote.
      material_mode_override: 'lump',
      lump_cost_override: prices[i],
      // Hours are preserved for scheduling, capacity and est-vs-actual. They
      // cost nothing on an imported job (rate 0) — margin is measured at the
      // end from actuals, per 6c-2.
      dept_hour_overrides: r.hours,
      material_description:
        r.material > 0 ? `Material budget: $${Math.round(r.material).toLocaleString()}` : null,
      composer_hours_corrected: true,
    }))
    if (inserts.length > 0) {
      const { error } = await ms.from('estimate_lines').insert(inserts)
      if (error) throw new Error(`insert frozen lines for ${proj.name}: ${error.message}`)
      linesWritten += inserts.length
    }

    // Margins to zero (the price is the price) + re-freeze the contract total.
    const { error: projErr } = await ms
      .from('projects')
      .update({
        target_margin_pct: 0,
        labor_margin_pct: 0,
        material_margin_pct: 0,
        consumable_margin_pct: 0,
        bid_total: contract,
      })
      .eq('id', msProjectId)
    if (projErr) throw new Error(`freeze project ${proj.name}: ${projErr.message}`)

    // The install prefill would add cost + hours ON TOP of the frozen line that
    // already carries both, so switch it off for imported subs. Also store the
    // material budget on the sub as a real number (not just the line's note) so
    // the imported project panel can total it without parsing text.
    for (const r of rows) {
      await ms
        .from('subprojects')
        .update({ install_included: false, material_cost: Math.round(r.material) })
        .eq('id', r.subId)
    }
  }

  console.log(
    `  estimate_lines (FROZEN): ${report.length} project(s)` +
      (opts.dryRun ? ' (dry-run)' : `, ${linesWritten} lines written`),
  )
  for (const r of report) {
    const ok = r.allocated === r.contract ? '·' : '!'
    console.log(
      `    ${ok} ${String(r.project).slice(0, 30).padEnd(31)} contract $${r.contract} = Σ$${r.allocated} across ${r.subs} sub(s) · ${r.hours}h · material $${r.material} · ${r.source === 'built' ? "Built's per-sub prices" : 'cost-weighted split'}`,
    )
  }

  const dir = resolve(__dirname, 'reports')
  mkdirSync(dir, { recursive: true })
  writeFileSync(resolve(dir, 'frozen-import.json'), JSON.stringify(report, null, 2))
}
