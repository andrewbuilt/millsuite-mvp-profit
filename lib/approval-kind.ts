// ============================================================================
// lib/approval-kind.ts — Finish / Hardware / Drawing / Other (migration 135)
// ============================================================================
// PURE — no supabase import, safe on the server, in the browser and in the
// verify script. One grouping, used one-to-one by the pre-production page and
// the client's approval portal, so the two can't sort the same callout into
// different piles.
//
// `guessItemKind` is the same rule migration 135's backfill runs in SQL. If
// you change one, change the other (scripts/verify-portal-b2b.mjs holds the
// two side by side).
// ============================================================================

export const ITEM_KINDS = ['finish', 'hardware', 'drawing', 'other'] as const
export type ItemKind = (typeof ITEM_KINDS)[number]

/** Group heading, plural — what the client and the shop both read. */
export const KIND_GROUP_LABEL: Record<ItemKind, string> = {
  finish: 'Finishes',
  hardware: 'Hardware',
  drawing: 'Drawings',
  other: 'Other',
}

/** Picker label, singular — the "+ Add callout" type picker. */
export const KIND_LABEL: Record<ItemKind, string> = {
  finish: 'Finish',
  hardware: 'Hardware',
  drawing: 'Drawing',
  other: 'Other',
}

export function normalizeItemKind(v: unknown): ItemKind {
  return (ITEM_KINDS as readonly string[]).includes(String(v)) ? (v as ItemKind) : 'other'
}

// Substring matches, case-insensitive — identical to the `~*` patterns in 135.
export const HARDWARE_LABEL_RE = /(pull|knob|handle|hinge|slide|glide|hardware|latch|lock|blum|hettich|salice|grass)/i
export const FINISH_LABEL_RE =
  /(finish|paint|stain|sheen|colou?r|lacquer|veneer|laminate|plam|material|species|countertop|quartz|stone)/i
export const DRAWING_LABEL_RE = /(drawing|shop dwg|elevation|submittal)/i
export const HARDWARE_DETAIL_RE = /(pull|knob|handle|hinge|slide|glide|blum|hettich|salice)/i

/**
 * Best guess at a callout's group from its words. Order matters: a hardware
 * word in the LABEL wins ("Pulls · satin nickel finish" is hardware), then
 * finish/material words, then drawings, then a hardware word in the material
 * text, then "it carries a finish at all". Anything else is Other — a wrong
 * confident guess is worse than an honest "Other" someone re-files in a click.
 */
export function guessItemKind(input: {
  label?: string | null
  material?: string | null
  finish?: string | null
}): ItemKind {
  const label = input.label || ''
  if (HARDWARE_LABEL_RE.test(label)) return 'hardware'
  if (FINISH_LABEL_RE.test(label)) return 'finish'
  if (DRAWING_LABEL_RE.test(label)) return 'drawing'
  if (HARDWARE_DETAIL_RE.test(input.material || '')) return 'hardware'
  if ((input.finish || '').trim()) return 'finish'
  return 'other'
}

/** Bucket rows by kind in the fixed display order, dropping empty groups. */
export function groupByKind<T extends { item_kind?: string | null }>(
  rows: T[],
): Array<{ kind: ItemKind; label: string; rows: T[] }> {
  return ITEM_KINDS.map((kind) => ({
    kind,
    label: KIND_GROUP_LABEL[kind],
    rows: rows.filter((r) => normalizeItemKind(r.item_kind) === kind),
  })).filter((g) => g.rows.length > 0)
}

/** A hardware link the client can click. Only http(s) — a `javascript:` URL
 *  typed into the field must never become an href on a public page. */
export function safeHttpUrl(raw: string | null | undefined): string | null {
  const v = (raw || '').trim()
  if (!v) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(withScheme)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** "richelieu.com/BP98765-195" — the link as the client reads it. */
export function shortLinkLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/+$/, '')
    const label = `${u.hostname.replace(/^www\./, '')}${path}`
    return label.length > 48 ? `${label.slice(0, 47)}…` : label
  } catch {
    return url
  }
}
