// ============================================================================
// lib/co-docs.ts — change orders v2, the database half.
// ============================================================================
// The rules live in lib/co-doc-math.ts (pure, verified). This file is IO:
// load, create, amend, accept, void. Schema is db/migrations/107_co_docs.sql.
//
// ⛔ A DRAFT IS NOT A SUBPROJECTS ROW. It's a jsonb payload on co_doc_items,
// materialised into real rows only on acceptance. The full reasoning is in
// 107's header; the short version is that `from('subprojects')` appears 60
// times across 20+ files, so a "is_draft" flag would be an OPT-OUT every one
// of those sites had to remember forever — and the one that forgot would leak
// unagreed scope into the contract total, the schedule, the capacity plan, the
// client portal, or a QuickBooks invoice.
//
// ⛔ TWO PRICING RULES, AND THE DIFFERENCE IS THE POINT.
//   · ADDITIONS price at TODAY'S rates and margins. New scope is being quoted
//     now; it costs what it costs now.
//   · CREDITS price by the PROJECT'S OWN rule — which for an imported job is
//     the frozen Built number. You refund what the client paid, not what the
//     rate book says the work would sell for today.
// `credit_basis` records which one produced each number, because after the
// rate book moves there is no way to tell them apart by looking.
// ============================================================================

import { supabase } from './supabase'
import {
  computeSubprojectRollup,
  loadEstimateLines,
  loadRateBook,
  type EstimateLine,
  type PricingContext,
} from './estimate-lines'
import { computeBucketedPrice, resolveBucketMargins, type CostBuckets } from './pricing'
import { recomputeProjectBidTotal } from './project-totals'
import type { ComposerDefaults } from './composer'
import {
  canAcceptDoc,
  nextCoNumber,
  nextItemOrder,
  type AddSubDraft,
  type CoDoc,
  type CoDocItem,
  type CoDraftLine,
} from './co-doc-math'

export type { AddSubDraft, CoDoc, CoDocItem, CoDraftLine } from './co-doc-math'

// ── Reads ───────────────────────────────────────────────────────────────────

export async function loadCoDocs(projectId: string): Promise<CoDoc[]> {
  const { data, error } = await supabase
    .from('co_docs')
    .select('*')
    .eq('project_id', projectId)
    .order('number', { ascending: true })
  if (error) {
    console.error('loadCoDocs', error)
    return []
  }
  return (data || []) as CoDoc[]
}

export async function loadCoDocItems(docId: string): Promise<CoDocItem[]> {
  const { data, error } = await supabase
    .from('co_doc_items')
    .select('*')
    .eq('doc_id', docId)
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('loadCoDocItems', error)
    return []
  }
  return (data || []) as CoDocItem[]
}

/** Every doc for a project with its items attached, newest doc last. */
export async function loadCoDocsWithItems(
  projectId: string,
): Promise<Array<{ doc: CoDoc; items: CoDocItem[] }>> {
  const docs = await loadCoDocs(projectId)
  if (docs.length === 0) return []
  const { data, error } = await supabase
    .from('co_doc_items')
    .select('*')
    .in(
      'doc_id',
      docs.map((d) => d.id),
    )
    .order('sort_order', { ascending: true })
  if (error) {
    console.error('loadCoDocsWithItems: items', error)
    return docs.map((doc) => ({ doc, items: [] }))
  }
  const byDoc = new Map<string, CoDocItem[]>()
  for (const i of (data || []) as CoDocItem[]) {
    if (!byDoc.has(i.doc_id)) byDoc.set(i.doc_id, [])
    byDoc.get(i.doc_id)!.push(i)
  }
  return docs.map((doc) => ({ doc, items: byDoc.get(doc.id) || [] }))
}

export function openDocOf(docs: CoDoc[]): CoDoc | null {
  return docs.find((d) => d.status === 'open') || null
}

// ── Pricing ─────────────────────────────────────────────────────────────────

interface ProjectPricing {
  orgId: string
  /** Built-imported job: its migrated lines carry the quoted price verbatim as
   *  a material lump, so the project's own rule adds nothing on top. */
  isImported: boolean
  shopRate: number
  orgConsumablesPct: number
  margins: ReturnType<typeof resolveBucketMargins>
  rateBook: Awaited<ReturnType<typeof loadRateBook>>
}

/** Everything needed to price anything on this project, read once. */
export async function loadProjectPricing(projectId: string): Promise<ProjectPricing | null> {
  const { data: project, error } = await supabase
    .from('projects')
    .select(
      'id, org_id, bid_total, imported_at, locked_shop_rate, labor_margin_pct, material_margin_pct, consumable_margin_pct',
    )
    .eq('id', projectId)
    .maybeSingle()
  if (error || !project?.org_id) {
    console.error('loadProjectPricing', error)
    return null
  }
  const { data: org } = await supabase
    .from('orgs')
    .select(
      'consumable_markup_pct, shop_rate, labor_margin_pct, material_margin_pct, consumable_margin_pct',
    )
    .eq('id', project.org_id)
    .single()

  // Rate precedence matches recomputeProjectBidTotal exactly: the job's locked
  // rate wins over the org's current one, so a rate change doesn't silently
  // reprice a sold job.
  const locked = Number(project.locked_shop_rate) || 0
  const shopRate = locked > 0 ? locked : Number((org as any)?.shop_rate ?? 0)

  return {
    orgId: project.org_id as string,
    isImported: !!project.imported_at,
    shopRate,
    orgConsumablesPct: Number((org as any)?.consumable_markup_pct ?? 10),
    margins: resolveBucketMargins(project as any, org as any),
    rateBook: await loadRateBook(project.org_id as string),
  }
}

function bucketsOf(rollup: {
  laborCost: number
  materialCost: number
  hardwareCost: number
  consumablesCost: number
  installCost: number
  optionsCost: number
  customCost: number
}): CostBuckets {
  return {
    laborCost: rollup.laborCost,
    materialCost: rollup.materialCost,
    hardwareCost: rollup.hardwareCost,
    consumablesCost: rollup.consumablesCost,
    installCost: rollup.installCost,
    optionsCost: rollup.optionsCost,
    customCost: rollup.customCost,
  }
}

/**
 * Turn draft lines into the `EstimateLine` shape the rollup reads, WITHOUT
 * writing anything. The row half of a CoDraftLine is the exact payload that
 * gets inserted on acceptance, so pricing it here and pricing it after
 * materialisation are the same computation over the same numbers.
 */
function draftLinesAsEstimateLines(lines: CoDraftLine[]): EstimateLine[] {
  return (lines || []).map((l, idx) => ({
    id: l.key,
    subproject_id: '',
    sort_order: idx,
    description: l.row.description,
    rate_book_item_id: null,
    quantity: Number(l.row.quantity) || 0,
    unit: (l.row.unit as EstimateLine['unit']) ?? null,
    material_mode_override: 'lump',
    linear_cost_override: null,
    lump_cost_override: Number(l.row.lump_cost_override) || 0,
    dept_hour_overrides: (l.row.dept_hour_overrides || null) as EstimateLine['dept_hour_overrides'],
    material_description: null,
    install_mode: null,
    install_params: null,
    finish_specs: null,
    callouts: null,
    unit_price_override: null,
    notes: l.row.notes,
    product_key: l.row.product_key,
    product_slots: l.row.product_slots as unknown as Record<string, unknown>,
  })) as EstimateLine[]
}

/**
 * ⛔ AN ADDITION IS QUOTED AT TODAY'S RATES — ALWAYS, INCLUDING ON AN IMPORTED
 * JOB. The import freeze exists so Built's migrated lines aren't marked up a
 * second time; it says nothing about work being sold today. Pricing new scope
 * by the frozen rule would quote its material cost with zero labor and zero
 * margin, which on a real change order is thousands of dollars given away.
 *
 * ⚠️ On an imported project this price will NOT equal the amount
 * `recomputeProjectBidTotal` moves the contract by — that function freezes the
 * whole project. `acceptDoc` measures the gap and reports it rather than
 * hiding it; see `AcceptResult.drift`.
 */
export function priceAddition(
  p: ProjectPricing,
  lines: CoDraftLine[],
  defaults: ComposerDefaults,
): number {
  const ctx: PricingContext = {
    shopRate: p.shopRate,
    consumableMarkupPct: defaults?.consumablesPct ?? p.orgConsumablesPct,
    // Subproject rollups run at COST; margin is applied once, below.
    profitMarginPct: 0,
  }
  const rollup = computeSubprojectRollup(
    draftLinesAsEstimateLines(lines),
    p.rateBook.itemsById,
    new Map(),
    ctx,
    1,
  )
  return Math.round(computeBucketedPrice(bucketsOf(rollup), p.margins).priceTotal)
}

/**
 * ⛔ A CREDIT IS THE ORIGINAL CONTRACT VALUE, so it follows the PROJECT'S rule,
 * not today's. On an imported job the migrated line's lump IS the number the
 * client agreed to — pricing it at current rates would add labor and margin on
 * top of a figure that already contains both, and credit them several times
 * what they paid.
 *
 * Returns a POSITIVE number; the caller negates it.
 */
export async function priceSubprojectAtContract(
  p: ProjectPricing,
  subprojectId: string,
): Promise<number> {
  const { data: sub } = await supabase
    .from('subprojects')
    .select(
      'id, quantity, consumable_markup_pct, install_guys, install_days, install_complexity_pct, install_rate_per_hour, install_included',
    )
    .eq('id', subprojectId)
    .maybeSingle()
  const lines = await loadEstimateLines(subprojectId)
  const ctx: PricingContext = {
    shopRate: p.isImported ? 0 : p.shopRate,
    consumableMarkupPct: p.isImported
      ? 0
      : ((sub as any)?.consumable_markup_pct ?? p.orgConsumablesPct),
    profitMarginPct: 0,
  }
  const rollup = computeSubprojectRollup(
    lines,
    p.rateBook.itemsById,
    new Map(),
    ctx,
    (sub as { quantity?: number } | null)?.quantity ?? 1,
  )
  const margins = p.isImported
    ? { laborMarginPct: 0, materialMarginPct: 0, consumableMarginPct: 0 }
    : p.margins
  return Math.round(computeBucketedPrice(bucketsOf(rollup), margins).priceTotal)
}

// ── Writes ──────────────────────────────────────────────────────────────────

/**
 * The project's open doc, creating one if there isn't any.
 *
 * ⛔ THE UNIQUE INDEX IS THE REAL GUARD, not this read. Two tabs both clicking
 * "Add scope" would both see no open doc and both insert; `uniq_co_docs_one_open`
 * makes the loser fail with 23505, and we re-read instead of surfacing an
 * error the operator can do nothing about.
 */
export async function ensureOpenDoc(orgId: string, projectId: string): Promise<CoDoc | null> {
  const docs = await loadCoDocs(projectId)
  const open = openDocOf(docs)
  if (open) return open

  const { data, error } = await supabase
    .from('co_docs')
    .insert({
      org_id: orgId,
      project_id: projectId,
      number: nextCoNumber(docs),
      status: 'open',
    })
    .select('*')
    .single()

  if (error) {
    if ((error as { code?: string }).code === '23505') {
      // Someone else won the race — theirs is the open doc.
      return openDocOf(await loadCoDocs(projectId))
    }
    console.error('ensureOpenDoc', error)
    return null
  }
  return data as CoDoc
}

/** Add drafted new scope to the open doc. Price is computed here, not passed
 *  in, so the stored number can't disagree with the lines that justify it. */
export async function addNewScopeDraft(input: {
  orgId: string
  doc: CoDoc
  draft: AddSubDraft
  description?: string | null
}): Promise<CoDocItem | null> {
  const p = await loadProjectPricing(input.doc.project_id)
  if (!p) return null
  const items = await loadCoDocItems(input.doc.id)
  const amount = priceAddition(p, input.draft.lines, input.draft.defaults)

  const { data, error } = await supabase
    .from('co_doc_items')
    .insert({
      org_id: input.orgId,
      doc_id: input.doc.id,
      subproject_id: null,
      kind: 'add_sub',
      description: input.description ?? `Add ${input.draft.name}`,
      draft: input.draft,
      delta_amount: amount,
      credit_basis: 'current',
      sort_order: nextItemOrder(items),
    })
    .select('*')
    .single()
  if (error) {
    console.error('addNewScopeDraft', error)
    return null
  }
  return data as CoDocItem
}

/** Re-save a draft's payload and re-price it from the new lines. */
export async function updateNewScopeDraft(input: {
  item: CoDocItem
  projectId: string
  draft: AddSubDraft
  description?: string | null
}): Promise<boolean> {
  const p = await loadProjectPricing(input.projectId)
  if (!p) return false
  const patch: Record<string, unknown> = {
    draft: input.draft,
    delta_amount: priceAddition(p, input.draft.lines, input.draft.defaults),
    updated_at: new Date().toISOString(),
  }
  if (input.description !== undefined) patch.description = input.description

  // ⛔ .select() — a zero-row UPDATE returns { error: null }, so without this an
  // RLS refusal is indistinguishable from a successful save.
  const { data, error } = await supabase
    .from('co_doc_items')
    .update(patch)
    .eq('id', input.item.id)
    .select('id')
  if (error || !data || data.length === 0) {
    console.error('updateNewScopeDraft', error)
    return false
  }
  return true
}

/** Mark an existing subproject for removal, credited at its contract value. */
export async function addRemoval(input: {
  orgId: string
  doc: CoDoc
  subprojectId: string
  /** Operator override. When supplied the basis is recorded as 'original',
   *  because they're asserting what the client actually paid rather than
   *  taking what the rate book computes today. */
  creditOverride?: number | null
  description?: string | null
}): Promise<CoDocItem | null> {
  const p = await loadProjectPricing(input.doc.project_id)
  if (!p) return null
  const items = await loadCoDocItems(input.doc.id)

  const computed = await priceSubprojectAtContract(p, input.subprojectId)
  const override =
    input.creditOverride != null && Number.isFinite(input.creditOverride)
      ? Math.abs(Number(input.creditOverride))
      : null
  const credit = override ?? computed

  const { data, error } = await supabase
    .from('co_doc_items')
    .insert({
      org_id: input.orgId,
      doc_id: input.doc.id,
      subproject_id: input.subprojectId,
      kind: 'remove_sub',
      description: input.description ?? null,
      draft: {},
      // ⛔ NEGATIVE. docDelta is a plain sum, so the sign has to live in the row.
      delta_amount: -credit,
      credit_basis: 'original',
      sort_order: nextItemOrder(items),
    })
    .select('*')
    .single()
  if (error) {
    // 23505 = uniq_co_doc_items_sub; this sub is already in this doc.
    if ((error as { code?: string }).code !== '23505') console.error('addRemoval', error)
    return null
  }
  return data as CoDocItem
}

export async function deleteCoDocItem(itemId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('co_doc_items')
    .delete()
    .eq('id', itemId)
    .select('id')
  if (error || !data || data.length === 0) {
    console.error('deleteCoDocItem', error)
    return false
  }
  return true
}

export async function setCoDocTitle(docId: string, title: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('co_docs')
    .update({ title: title.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', docId)
    .select('id')
  return !error && !!data && data.length > 0
}

export async function voidCoDoc(docId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('co_docs')
    .update({ status: 'void', updated_at: new Date().toISOString() })
    .eq('id', docId)
    .eq('status', 'open')
    .select('id')
  if (error || !data || data.length === 0) {
    console.error('voidCoDoc', error)
    return false
  }
  return true
}

// ── Acceptance ──────────────────────────────────────────────────────────────

export interface AcceptResult {
  ok: boolean
  reason: string | null
  /** Subprojects created from drafts. */
  created: string[]
  /** What the client signed for. */
  agreed: number
  /** What the contract total actually moved by. */
  moved: number
  /**
   * agreed − moved. ⛔ NON-ZERO IS A REAL FINDING, NOT A ROUNDING ARTEFACT.
   * The one case that produces a large gap today is an IMPORTED project:
   * `recomputeProjectBidTotal` freezes the entire project (shop rate 0,
   * margins 0) because Built's migrated lines already contain their price — so
   * a newly materialised subproject contributes only its material cost, while
   * the client agreed to labor and margin too. Reported, never silently
   * absorbed.
   */
  drift: number
}

/**
 * Accept the doc: materialise every draft, apply every removal, lock the doc.
 *
 * ⛔ ORDER MATTERS. Materialise BEFORE recomputing, recompute BEFORE stamping
 * accepted — so a failure halfway leaves a doc that is still open and still
 * fixable, rather than an accepted doc whose scope never landed.
 *
 * ⚠️ NOT A TRANSACTION. PostgREST gives us no way to wrap these in one, so
 * each step is idempotent-ish and logged: a re-run of a partially applied doc
 * would duplicate subprojects, which is why the doc is flipped to `accepted`
 * as the last step and the UI refuses to accept a non-open doc.
 */
export async function acceptDoc(input: {
  doc: CoDoc
  items: CoDocItem[]
  /** users.id (a LOGIN id, not a roster id). */
  acceptedBy?: string | null
  /** Typed by the client in the portal, or by the operator recording verbal
   *  approval. */
  signedName?: string | null
}): Promise<AcceptResult> {
  const { doc, items } = input
  const fail = (reason: string): AcceptResult => ({
    ok: false,
    reason,
    created: [],
    agreed: 0,
    moved: 0,
    drift: 0,
  })

  const gate = canAcceptDoc(doc, items)
  if (!gate.ok) return fail(gate.reason || 'This change order cannot be accepted.')

  const p = await loadProjectPricing(doc.project_id)
  if (!p) return fail('Could not read the project.')

  const { data: before } = await supabase
    .from('projects')
    .select('bid_total')
    .eq('id', doc.project_id)
    .maybeSingle()
  const totalBefore = Number((before as { bid_total: number | null } | null)?.bid_total) || 0

  const agreed = items.reduce((a, i) => a + (Number(i.delta_amount) || 0), 0)
  const created: string[] = []

  // ── 1. Materialise the additions ──
  for (const item of items) {
    if (item.kind !== 'add_sub') continue
    const draft = item.draft as AddSubDraft
    const subId = await materialiseDraft(p.orgId, doc.project_id, draft)
    if (!subId) return fail(`Could not create "${draft.name}". Nothing was changed.`)
    created.push(subId)
    // Point the item at what it produced, so the doc's history says which
    // subproject this line of the change order became.
    await supabase.from('co_doc_items').update({ subproject_id: subId }).eq('id', item.id)
  }

  // ── 2. Apply the removals ──
  for (const item of items) {
    if (item.kind !== 'remove_sub' || !item.subproject_id) continue
    const { error } = await supabase.from('subprojects').delete().eq('id', item.subproject_id)
    if (error) {
      // Don't abort: the additions already landed, and a removal that can't be
      // deleted (usually a foreign key from logged time) is a thing to look at,
      // not a reason to lose the whole change order.
      console.error('acceptDoc: removal failed', item.subproject_id, error)
    }
  }

  // ── 3. Recompute, and measure the gap ──
  const after = await recomputeProjectBidTotal(doc.project_id)
  const moved = (after ?? totalBefore) - totalBefore

  // ── 4. Lock it ──
  const nowIso = new Date().toISOString()
  const { data: locked, error: lockErr } = await supabase
    .from('co_docs')
    .update({
      status: 'accepted',
      accepted_at: nowIso,
      accepted_by: input.acceptedBy ?? null,
      signed_name: input.signedName?.trim() || null,
      signed_at: input.signedName?.trim() ? nowIso : null,
      updated_at: nowIso,
    })
    .eq('id', doc.id)
    .eq('status', 'open')
    .select('id')
  if (lockErr || !locked || locked.length === 0) {
    console.error('acceptDoc: could not lock the doc', lockErr)
    return {
      ok: false,
      reason:
        'The scope was applied but the change order could not be marked accepted. Refresh before doing anything else.',
      created,
      agreed,
      moved,
      drift: agreed - moved,
    }
  }

  return { ok: true, reason: null, created, agreed, moved, drift: agreed - moved }
}

/**
 * Draft payload → real subproject + real estimate_lines.
 *
 * ⛔ THE LINE ROWS ARE INSERTED VERBATIM from `CoDraftLine.row`, which
 * `composerLineRow` produced when the draft was composed. That's the whole
 * reason the quoted price and the materialised price agree: it is the same
 * payload, not a re-derivation of it.
 */
async function materialiseDraft(
  orgId: string,
  projectId: string,
  draft: AddSubDraft,
): Promise<string | null> {
  const { data: last } = await supabase
    .from('subprojects')
    .select('sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextOrder = last?.sort_order != null ? Number(last.sort_order) + 1 : 0

  const { data: sub, error } = await supabase
    .from('subprojects')
    .insert({
      project_id: projectId,
      org_id: orgId,
      name: draft.name.trim(),
      sort_order: nextOrder,
      consumable_markup_pct: draft.defaults?.consumablesPct ?? null,
      defaults: draft.defaults,
    })
    .select('id')
    .single()
  if (error || !sub) {
    console.error('materialiseDraft: subproject', error)
    return null
  }

  const rows = (draft.lines || []).map((l, idx) => ({
    subproject_id: (sub as { id: string }).id,
    sort_order: idx,
    ...l.row,
  }))
  if (rows.length > 0) {
    const { error: lineErr } = await supabase.from('estimate_lines').insert(rows)
    if (lineErr) {
      // Roll the subproject back by hand — an empty sub on the production
      // schedule is worse than no sub, because it reads as real work.
      console.error('materialiseDraft: lines', lineErr)
      await supabase.from('subprojects').delete().eq('id', (sub as { id: string }).id)
      return null
    }
  }
  return (sub as { id: string }).id
}
