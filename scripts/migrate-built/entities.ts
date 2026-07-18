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

function estimateLineRow(
  subprojectId: string,
  sortOrder: number,
  label: string,
  materialTotal: number,
  deptHours: Record<string, number>,
) {
  return {
    subproject_id: subprojectId,
    sort_order: sortOrder,
    description: label,
    spec_label: label,
    quantity: 1, // lump_cost_override + hours are already line totals
    unit: 'lot',
    lump_cost_override: Math.round(materialTotal),
    dept_hour_overrides: deptHours,
    product_key: null,
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
  const consumableMarkup = (Number(org?.consumable_markup_pct) || 0) / 100

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
      if (subIds.length > 0) await ms.from('estimate_lines').delete().in('subproject_id', subIds)
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
      await ms
        .from('projects')
        .update({
          built_archive: archive,
          target_margin_pct: 0,
          labor_margin_pct: 0,
          material_margin_pct: 0,
          consumable_margin_pct: 0,
        })
        .eq('id', msProjectId)
      continue
    }

    const { data: subs } = await ms
      .from('subprojects')
      .select('id, name, spec_lines_json, dept_hours, material_cost')
      .eq('project_id', msProjectId)
      .order('sort_order')

    const rows: ReturnType<typeof estimateLineRow>[] = []
    let projMaterial = 0
    let projHours = 0
    for (const s of subs || []) {
      const specLines = Array.isArray(s.spec_lines_json) ? s.spec_lines_json : []
      if (specLines.length > 0) {
        specLines.forEach((sl: any, idx: number) => {
          const material = (Number(sl.qty) || 0) * (Number(sl.rate) || 0)
          const dh = mapDeptHours(sl.dept_hours)
          const hours = sumHours(dh)
          if (material === 0 && hours === 0) return
          projMaterial += material
          projHours += hours
          rows.push(estimateLineRow(s.id, idx, String(sl.label || 'Line'), material, dh))
        })
      } else {
        // Labor-only / material-only sub (e.g. install): use sub-level fields.
        const dh = mapDeptHours(s.dept_hours)
        const hours = sumHours(dh)
        const material = Number(s.material_cost) || 0
        if (hours > 0 || material > 0) {
          projMaterial += material
          projHours += hours
          rows.push(estimateLineRow(s.id, 0, String(s.name || 'Work'), material, dh))
        }
      }
    }

    const cost = projMaterial * (1 + consumableMarkup) + projHours * shopRate
    const bid = Number(proj.bid_total) || 0
    const rawMargin = bid > 0 ? (bid - cost) / bid : 0
    const applied = Math.min(Math.max(rawMargin, 0), 0.95)
    const reconstructed = applied > 0 ? cost / (1 - applied) : cost
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
      reason = `reconstructed total off by ${deltaPct.toFixed(1)}%`
    }
    if (status === 'FLAG') flagged++

    report.push({
      project: proj.name,
      stage: proj.stage,
      bid: Math.round(bid),
      cost: Math.round(cost),
      marginPct: round2(rawMargin * 100),
      appliedMarginPct: round2(applied * 100),
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
    const marginPct = round2(applied * 100)
    await ms
      .from('projects')
      .update({
        target_margin_pct: marginPct,
        labor_margin_pct: marginPct,
        material_margin_pct: marginPct,
        consumable_margin_pct: marginPct,
      })
      .eq('id', msProjectId)
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
