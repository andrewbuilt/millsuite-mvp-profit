// ============================================================================
// lib/bom-merge.ts — what a RE-parse is allowed to do. PURE.
// ============================================================================
// ⛔ NO SUPABASE IMPORT. Same rule as lib/payment-ledger and lib/supply-item:
// `lib/supabase` builds a client at module scope, so a verification script
// can't import anything that touches it.
//
// Andrew's rule, 2026-09-12: "re-parse appends new finds and flags count
// differences — it never overwrites or deletes edited rows."
//
// ⛔ THE WHOLE FILE EXISTS TO MAKE THAT RULE STRUCTURAL RATHER THAN REMEMBERED.
// `mergeParsedBom` returns ONLY inserts and parsed_qty flags. There is no
// shape in its return type that can express "change this row's qty", "rename
// this row", "untick this checkbox" or "delete this row" — so a future caller
// cannot do those things by accident, and a reviewer can see that from the
// types alone. This is the task-system merge-allowlist lesson: there, a field
// missing from an allowlist was silently reverted on every save, the indicator
// said "saved", and nothing surfaced it. An automatic write that quietly
// undoes a human edit is the worst kind of bug, because it looks like success.
//
// The other half of the rule is in the schema: `qty` (human) and `parsed_qty`
// (parser) are separate columns. See migration 103.
// ============================================================================

export type BomCategory = 'sheet_good' | 'hardware' | 'drawer' | 'other'

export interface BomRow {
  id: string
  category: BomCategory
  name: string
  spec: string | null
  /** The working count. A human owns it. */
  qty: number
  /** What the parser last said, or null on a hand-added row. */
  parsedQty: number | null
  unit: string
  source: 'parsed' | 'manual'
  checkedOff: boolean
  notes: string | null
}

/** One item as it comes back from the parser, already shape-checked. */
export interface ParsedBomItem {
  category: BomCategory
  name: string
  spec: string | null
  qty: number
  unit: string
  notes: string | null
}

/**
 * Identity for matching a parsed item against an existing row.
 *
 * ⛔ THIS IS WHAT STOPS A SECOND PARSE DUPLICATING THE LIST. Normalised so
 * that trivial differences in how the parser phrases the same thing don't
 * mint a new row: case, surrounding and repeated whitespace, and the
 * punctuation that drifts between passes (a drawing set reads "3/4in white
 * oak" one time and "3/4 in. White Oak" the next).
 *
 * ⚠️ Deliberately NOT fuzzy beyond that. "Blum 21in slide" and "Blum 18in
 * slide" are different things to buy, and a matcher loose enough to merge
 * them would silently collapse two line items into one — losing a count with
 * no trace. Under-matching creates a visible duplicate a human deletes;
 * over-matching destroys information. Prefer the visible failure.
 */
export function bomKey(category: string, name: string, spec: string | null): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[.,;:'"()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  return `${category}::${norm(name)}::${norm(spec || '')}`
}

export interface BomMergePlan {
  /** Items the list has never seen. Inserted with source='parsed'. */
  inserts: ParsedBomItem[]
  /**
   * Rows where the parser's count has changed. ⛔ Writes `parsed_qty` ONLY —
   * never `qty`. The difference is surfaced in the UI for a person to accept
   * or ignore.
   */
  flags: Array<{ id: string; parsedQty: number }>
  /** Matched rows the parser still agrees with. Nothing to write. */
  unchanged: number
}

/**
 * Work out what a re-parse may write.
 *
 * ⛔ NOTHING IS EVER DELETED, including a row the parser has stopped seeing.
 * A drawing revision that drops a cabinet does not entitle anything to remove
 * a line the shop may already have ordered against — and the parser missing
 * something on pass two is at least as likely as the drawings changing.
 */
export function mergeParsedBom(
  existing: BomRow[],
  incoming: ParsedBomItem[],
): BomMergePlan {
  const byKey = new Map<string, BomRow>()
  for (const row of existing) {
    // First writer wins: if a human has somehow created two rows with the
    // same key, matching the first keeps the merge deterministic rather than
    // flipping between them on consecutive parses.
    const k = bomKey(row.category, row.name, row.spec)
    if (!byKey.has(k)) byKey.set(k, row)
  }

  const plan: BomMergePlan = { inserts: [], flags: [], unchanged: 0 }
  // Guards against a parser that lists the same item twice in one response —
  // without this, pass one would insert it twice.
  const seen = new Set<string>()

  for (const item of incoming) {
    const k = bomKey(item.category, item.name, item.spec)
    if (seen.has(k)) continue
    seen.add(k)

    const match = byKey.get(k)
    if (!match) {
      plan.inserts.push(item)
      continue
    }
    // Compare against what the parser said LAST time, not against the human's
    // working number. Otherwise every corrected row would re-flag on every
    // parse, and the flag would come to mean "somebody edited this" rather
    // than "the drawings changed".
    const previous = match.parsedQty
    if (previous === null || Math.abs(previous - item.qty) > 0.0001) {
      plan.flags.push({ id: match.id, parsedQty: item.qty })
    } else {
      plan.unchanged += 1
    }
  }

  return plan
}

/** True when the parser's latest count disagrees with the working number —
 *  i.e. the row wants a human's attention. */
export function hasCountDisagreement(row: BomRow): boolean {
  if (row.parsedQty === null) return false
  return Math.abs(row.parsedQty - row.qty) > 0.0001
}

export const BOM_CATEGORY_LABEL: Record<BomCategory, string> = {
  sheet_good: 'Sheet goods',
  hardware: 'Hardware',
  drawer: 'Drawer boxes',
  other: 'Other',
}

/** Display order — what you buy first, roughly. */
export const BOM_CATEGORY_ORDER: BomCategory[] = ['sheet_good', 'hardware', 'drawer', 'other']
