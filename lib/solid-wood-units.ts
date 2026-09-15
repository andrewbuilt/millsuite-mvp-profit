// ============================================================================
// lib/solid-wood-units.ts — quarter-inch thickness formatting. Pure.
// ============================================================================
// ⛔ WHY THESE TWO ONE-LINERS LIVE ALONE.
//
// They were in `lib/solid-wood.ts`, which imports `lib/supabase` at module
// scope. `lib/composer.ts` imports them as VALUES, so the entire composer —
// and everything that imports it, including the change-order draft pricing —
// built a database client the moment it was loaded. That made the composer's
// storage contract impossible to test: `npx tsx scripts/verify-co-docs.mjs`
// died with "supabaseUrl is required" before running a single assertion.
//
// Same split as lib/payment-schedule, lib/time-filters, lib/divide-block: the
// logic a verify script needs must not sit behind an IO import.
// `lib/solid-wood.ts` re-exports both, so every existing caller is unaffected.
// ============================================================================

/** 4 → "4/4", 8 → "8/4". Rounds and floors at 1 — lumber isn't sold in
 *  fractions of a quarter, and "0/4" would read as an error. */
export function formatThickness(quarters: number): string {
  const q = Math.max(1, Math.round(quarters))
  return `${q}/4`
}

/** Approximate inches for a tooltip / detail row. 4/4 → 1.0 in, 8/4 → 2.0 in. */
export function quartersToInches(quarters: number): number {
  return Math.max(0, quarters) / 4
}
