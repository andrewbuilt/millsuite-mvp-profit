// ============================================================================
// lib/co-doc-math.ts — change orders v2: the rules, with no database.
// ============================================================================
// Pure on purpose (no `lib/supabase` import) so scripts/verify-co-docs can pin
// every rule below without a connection. `lib/co-docs.ts` does the IO and
// imports from here; nothing here knows what a table is.
//
// The model, in one paragraph: a project has at most ONE OPEN doc. Changes
// accumulate into it as items — new scope, removed scope, and (step 2) edits
// to existing scope. Everything stays editable until the doc is ACCEPTED, at
// which point the drafts are materialised into real subprojects, the doc
// locks, and the next one opens on demand.
// ============================================================================

import type { ComposerDefaults, ComposerDraft } from './composer'
import type { ComposerLineRow } from './composer-row'

// ── Types ───────────────────────────────────────────────────────────────────

export type CoDocStatus = 'open' | 'accepted' | 'void'
/**
 * ⛔ `adjustment` IS THE ONLY KIND THAT WORKS ON AN IMPORTED JOB (111).
 * The Built importer writes each migrated room as ONE lump line — measured:
 * 91 of 91 frozen subprojects have a single line or none — so "remove a line"
 * there means removing the entire scope, and taking an arbitrary amount off
 * had no representation at all. An adjustment is a description and a number,
 * which is also how half the lines on a real change order read.
 */
export type CoItemKind = 'add_sub' | 'edit_sub' | 'remove_sub' | 'adjustment'
/** 'current' = priced at today's rate book. 'original' = credited at the
 *  contract value the client actually signed. */
export type CreditBasis = 'current' | 'original'

export interface CoDoc {
  id: string
  org_id: string
  project_id: string
  number: number
  status: CoDocStatus
  title: string | null
  accepted_at: string | null
  accepted_by: string | null
  signed_name: string | null
  signed_at: string | null
  pdf_url: string | null
  qbo_invoice_id: string | null
  created_at: string
  /** Migration 110. Non-null = the client can see it in the portal. Optional
   *  on the type so a pre-110 read still satisfies it. */
  sent_at?: string | null
  /** The COUNTERSIGNED copy — distinct from `pdf_url`, which is the document
   *  as accepted. Writing one over the other destroys the blank-signature PDF
   *  the shop already emailed. */
  signed_pdf_url?: string | null
}

/**
 * One line of a drafted subproject. This is the composer's storage payload
 * (`ComposerLineRow`) plus the inputs needed to reopen it in the composer —
 * nothing else. On acceptance the row half is inserted VERBATIM, which is why
 * the quoted price and the resulting project total agree.
 */
export interface CoDraftLine {
  /** Stable id within the draft so React keys and edit/delete don't depend on
   *  array position — the array gets reordered by deletes. */
  key: string
  /** Re-hydrates the composer for an edit. */
  composer: ComposerDraft
  /** Inserted as-is at acceptance (plus subproject_id + sort_order). */
  row: ComposerLineRow
}

/** The `draft` jsonb payload for an `add_sub` item. */
export interface AddSubDraft {
  name: string
  /** consumables/waste %, carried to subprojects.defaults on materialisation
   *  so the accepted sub prices the same way it did as a draft. */
  defaults: ComposerDefaults
  lines: CoDraftLine[]
}

/**
 * The `draft` payload for an `edit_sub` item — a DIFF against the sub's
 * contract lines, not a replacement for them.
 *
 * ⛔ WHY THIS ISN'T "REOPEN THE SUB IN THE COMPOSER", WHICH IS WHAT THE SPEC
 * ASKED FOR. `AddLineComposer` refuses any line without `product_key` — it has
 * no math model for one — and the Built importer writes frozen lines with
 * dept hours and a material lump and no product_key at all. Measured
 * (scripts/inspect-line-editability): **Pajot 0 of 7 lines are composer-
 * editable. Every imported job is 0%.** 14 of 64 lines across all sold jobs.
 *
 * So on the jobs Andrew actually raises change orders against, "reopen and
 * edit" cannot work. What does work — and what his Pajot change IS — is
 * remove a line, add a line. Revision in the composer is offered where it's
 * possible (a native sub's composer lines) and is expressed as the same thing:
 * credit the old line, charge the new one, which is the spec's own money rule
 * for a modification.
 */
export interface EditSubDraft {
  subprojectId: string
  defaults: ComposerDefaults
  /** `estimate_lines.id` of contract lines to delete. Credited at the value
   *  they carry in the contract. */
  removeLineIds: string[]
  /** Brand-new lines, priced at today's rates. */
  addLines: CoDraftLine[]
  /** In-place revisions of composer lines. Priced as credit-old + add-new;
   *  applied as an UPDATE so the row keeps its id (and anything hanging off
   *  it) rather than being deleted and recreated. */
  reviseLines: Array<{ lineId: string; line: CoDraftLine }>
}

/** Every contract line this draft touches — removed outright or replaced. */
export function touchedLineIds(d: EditSubDraft): string[] {
  return [...(d.removeLineIds || []), ...(d.reviseLines || []).map((r) => r.lineId)]
}

/** Every line this draft introduces, priced at current rates. */
export function introducedLines(d: EditSubDraft): CoDraftLine[] {
  return [...(d.addLines || []), ...(d.reviseLines || []).map((r) => r.line)]
}

/** An edit that changes nothing shouldn't be on a change order at all. */
export function editIsEmpty(d: EditSubDraft): boolean {
  return touchedLineIds(d).length === 0 && (d.addLines?.length ?? 0) === 0
}

/**
 * ⛔ CAN NEW LINES GO INSIDE THIS SUBPROJECT AT ALL?
 *
 * A FROZEN sub's stored costs ARE its price (migration 108). Append a composer
 * line to it and `recomputeProjectBidTotal` prices that line frozen too — at
 * material cost, no labor, no margin — which is exactly the bug 108 fixed,
 * reintroduced one level down. The freeze is per-SUBPROJECT; the need here
 * would be per-LINE.
 *
 * Rather than move the freeze onto the line (a third migration, on the hot
 * pricing path), new work on a frozen sub goes on the change order as its OWN
 * scope, which already prices correctly at today's rates. REMOVING and
 * crediting lines from a frozen sub is unaffected — and that is the common
 * case, because every imported line is frozen and none of them is composer-
 * editable anyway.
 *
 * ⚠️ `lib/co-docs.saveEditDraft` re-checks this on the way in. The modal
 * disables the button, but a stale tab must not be able to append a $0-labor
 * line to a signed contract.
 */
export function canAddLinesToSub(
  project: { imported_at?: string | null } | null | undefined,
  sub: { price_frozen?: boolean | null } | null,
): Gate {
  // Same fallback direction as `isSubFrozen`: an absent flag on an imported
  // project means FROZEN, so a caller that forgot to select the column errs
  // toward refusing rather than toward mispricing.
  const frozen = sub && sub.price_frozen != null ? !!sub.price_frozen : !!project?.imported_at
  if (!frozen) return { ok: true, reason: null }
  return {
    ok: false,
    reason:
      'This scope came from Built at a fixed price, so new lines can’t be added inside it — they would price with no labor or margin. Add the work as new scope on the change order instead.',
  }
}

export interface CoDocItem {
  id: string
  doc_id: string
  subproject_id: string | null
  kind: CoItemKind
  description: string | null
  draft: AddSubDraft | Record<string, unknown>
  delta_amount: number
  credit_basis: CreditBasis | null
  sort_order: number
}

// ── Numbering ───────────────────────────────────────────────────────────────

/**
 * The next CO number for a project.
 *
 * ⛔ MAX + 1, NOT COUNT + 1. A voided doc keeps its number forever — the
 * client was already shown "CO-02", and reusing it would put two different
 * documents behind one name. Counting live docs would do exactly that the
 * moment one is voided.
 */
export function nextCoNumber(docs: Array<{ number: number | null }>): number {
  let max = 0
  for (const d of docs || []) {
    const n = Number(d.number)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}

/** "CO-02" — zero-padded, because that's how they're read aloud and sorted. */
export function coLabel(doc: { number: number | null }): string {
  return `CO-${String(doc.number ?? 0).padStart(2, '0')}`
}

// ── Money ───────────────────────────────────────────────────────────────────

/**
 * What the doc changes the contract by. Credits are already negative in
 * `delta_amount`, so this is a plain sum — a doc that adds $4,000 of scope and
 * credits $1,500 of removed scope is a $2,500 change order, one number, one
 * signature.
 */
export function docDelta(items: Array<{ delta_amount: number }>): number {
  return (items || []).reduce((a, i) => a + (Number(i.delta_amount) || 0), 0)
}

/** Price a drafted subproject's lines from the composer's cost buckets. See
 *  `lib/co-docs.priceAddSubDraft` for the bucket→price half, which needs the
 *  rate book and therefore the database. */
export function draftLineCost(line: CoDraftLine): number {
  const qty = Number(line.row.quantity) || 0
  return (Number(line.row.lump_cost_override) || 0) * qty
}

export interface DocSummary {
  adds: number
  edits: number
  removes: number
  adjustments: number
  /** Net change to the contract. */
  delta: number
  /** Additions only — what a separate QB invoice would bill (step 3). */
  additions: number
  credits: number
}

export function summarizeDoc(items: CoDocItem[]): DocSummary {
  const out: DocSummary = {
    adds: 0,
    edits: 0,
    removes: 0,
    adjustments: 0,
    delta: 0,
    additions: 0,
    credits: 0,
  }
  for (const i of items || []) {
    if (i.kind === 'add_sub') out.adds++
    else if (i.kind === 'edit_sub') out.edits++
    else if (i.kind === 'remove_sub') out.removes++
    else if (i.kind === 'adjustment') out.adjustments++
    const amt = Number(i.delta_amount) || 0
    out.delta += amt
    if (amt >= 0) out.additions += amt
    else out.credits += amt
  }
  return out
}

// ── Gates ───────────────────────────────────────────────────────────────────

export interface Gate {
  ok: boolean
  reason: string | null
}

/**
 * May this doc be sent to the client / accepted?
 *
 * ⛔ AN EMPTY DOC CANNOT BE ACCEPTED. `ensureOpenDoc` creates a doc the moment
 * someone clicks "Add scope", so an abandoned click leaves an empty open doc
 * sitting there. Accepting it would burn a CO number on a document that says
 * nothing and stamp a signature against no scope.
 *
 * ⛔ A DRAFT WITH NO LINES CANNOT BE ACCEPTED EITHER. It materialises into an
 * empty subproject worth $0 — a row on the production schedule with no work in
 * it, which reads as "somebody forgot to finish this" forever after.
 */
export function canAcceptDoc(doc: { status: CoDocStatus }, items: CoDocItem[]): Gate {
  if (doc.status === 'accepted') return { ok: false, reason: 'This change order is already accepted.' }
  if (doc.status === 'void') return { ok: false, reason: 'This change order was voided.' }
  if (!items || items.length === 0)
    return { ok: false, reason: 'Nothing in this change order yet — add or remove some scope first.' }

  for (const i of items) {
    if (i.kind === 'add_sub') {
      const d = i.draft as AddSubDraft
      if (!d?.name?.trim()) return { ok: false, reason: 'A new scope draft is missing its name.' }
      if (!Array.isArray(d.lines) || d.lines.length === 0)
        return { ok: false, reason: `"${d.name}" has no lines yet — price it before accepting.` }
    }
    if (i.kind === 'remove_sub' && !i.subproject_id)
      return { ok: false, reason: 'A removal is missing the subproject it removes.' }
    if (i.kind === 'adjustment') {
      // ⛔ AN ADJUSTMENT IS A NUMBER AND A REASON. Without the reason it's an
      // unexplained figure on a document the client signs; without the number
      // it's a sentence that changes nothing. Both, or it doesn't go.
      if (!i.description?.trim())
        return { ok: false, reason: 'An adjustment needs a description — the client reads it.' }
      if (!Number.isFinite(Number(i.delta_amount)) || Number(i.delta_amount) === 0)
        return { ok: false, reason: `"${i.description}" has no amount on it.` }
    }
    if (i.kind === 'edit_sub') {
      const d = i.draft as unknown as EditSubDraft
      if (!i.subproject_id) return { ok: false, reason: 'A revision is missing its subproject.' }
      // An edit that changes nothing would materialise as a no-op and leave a
      // line on the client's change order describing no change.
      if (editIsEmpty(d))
        return { ok: false, reason: 'A revision has no changes in it — remove it or edit it.' }
    }
  }
  return { ok: true, reason: null }
}

/**
 * ⛔ ONE ITEM PER SUBPROJECT PER DOC — enforced in the database by
 * `uniq_co_doc_items_sub`, and checked here first so the UI can say why rather
 * than surfacing a 23505. Two items against one sub in one doc would each hold
 * a different draft of the same thing and apply in an order nobody chose.
 */
export function canTouchSubproject(items: CoDocItem[], subprojectId: string): Gate {
  const existing = (items || []).find((i) => i.subproject_id === subprojectId)
  if (!existing) return { ok: true, reason: null }
  return {
    ok: false,
    reason:
      existing.kind === 'remove_sub'
        ? 'This scope is already being removed in this change order.'
        : 'This scope is already being changed in this change order.',
  }
}

// ── Display ─────────────────────────────────────────────────────────────────

/** The client-facing headline for an item. Falls back to the stored
 *  description, which is what the operator typed on the PDF. */
export function itemHeadline(item: CoDocItem, subName?: string | null): string {
  if (item.description?.trim()) return item.description.trim()
  switch (item.kind) {
    case 'add_sub':
      return `Add ${(item.draft as AddSubDraft)?.name || 'new scope'}`
    case 'remove_sub':
      return `Remove ${subName || 'scope'}`
    case 'edit_sub':
      return `Revise ${subName || 'scope'}`
    case 'adjustment':
      // The description IS the item — the branch above already returned it,
      // so reaching here means somebody saved one without a reason.
      return 'Adjustment'
  }
}

/** Next sort_order for a new item — max + 1, same reasoning as the CO number:
 *  a deleted item shouldn't let a later one reuse its slot and reorder the
 *  document the client is reading. */
export function nextItemOrder(items: Array<{ sort_order: number }>): number {
  let max = -1
  for (const i of items || []) {
    const n = Number(i.sort_order)
    if (Number.isFinite(n) && n > max) max = n
  }
  return max + 1
}
