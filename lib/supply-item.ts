// ============================================================================
// lib/supply-item.ts — the supply SHAPE and the search. PURE.
// ============================================================================
// ⛔ NO SUPABASE IMPORT, AND THAT IS THE WHOLE REASON THIS FILE EXISTS.
// `lib/supabase` builds a client at module scope, so anything importing it —
// directly or transitively — cannot be loaded by a verification script
// without credentials. `verify-payments` was written against `lib/payments`
// and could not run as documented until the pure half was split out; this is
// that lesson applied up front rather than after.
//
// The data layer (lib/supplies) imports from here and re-exports, so callers
// still have one import site.
// ============================================================================

export interface SupplyItem {
  id: string
  /** Already normalised through the allowlist — safe to use as an href. */
  url: string | null
  name: string
  vendor: string | null
  vendorInfo: string | null
  notes: string | null
  active: boolean
  createdAt: string
}

/**
 * Does this supply match what was typed?
 *
 * ⛔ SEARCHES EVERY FIELD, because there is no category column in v1 and the
 * search is therefore the ONLY way to narrow the list. Andrew looks things up
 * by whatever he remembers — the vendor, a phone number, a word in the notes —
 * so matching on `name` alone would make the page feel broken.
 *
 * ⛔ TERMS ARE AND-ED ACROSS THE WHOLE ROW, not per field: "klingspor
 * sandpaper" must find the row whose VENDOR is one word and whose NAME is the
 * other. Per-field matching misses it; OR-ing the terms would widen the list
 * as you type instead of narrowing it.
 */
export function supplyMatches(item: SupplyItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = [item.name, item.vendor, item.vendorInfo, item.notes, item.url]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((term) => haystack.includes(term))
}
