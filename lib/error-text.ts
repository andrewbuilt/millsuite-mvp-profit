// ============================================================================
// lib/error-text.ts — turn ANY thrown value into words for a banner
// ============================================================================
// ⛔ WHY (2026-11-12, PTO approve broken for everyone incl. the owner). The
// /team handlers did `e instanceof Error ? e.message : 'Could not approve…'`.
// Supabase/PostgREST errors are PLAIN OBJECTS ({ message, details, hint,
// code }), not Errors — so every database refusal showed the generic
// fallback and the real reason stayed hidden for weeks. This keeps it.
// ============================================================================

export function errorText(e: unknown, fallback = 'Something went wrong.'): string {
  if (!e) return fallback
  if (typeof e === 'string') return e
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'object') {
    const o = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [o.message, o.details, o.hint].filter((x) => typeof x === 'string' && x.trim()) as string[]
    if (parts.length) return `${parts.join(' — ')}${o.code ? ` (${String(o.code)})` : ''}`
    if (o.code) return `${fallback} (${String(o.code)})`
  }
  return fallback
}
