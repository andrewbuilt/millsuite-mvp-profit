// ============================================================================
// lib/subproject-description.ts — subproject → QuickBooks line description
// ============================================================================
// 6a-2. One QB invoice line per subproject; this builds that line's rich
// Description from the subproject's real scope fields (name, material/finish,
// details_json blocks, spec-line notes, exclusions_json) — ported from Built
// OS's buildRichDescription (app/api/qbo/route.ts). Pure + client-safe so the
// project page's invoice preview and the server push agree byte-for-byte.
// ============================================================================

/** The subproject fields this module reads. Everything optional — a lead
 *  subproject may have only a name. */
export interface SubprojectScope {
  name?: string | null
  material_finish?: string | null
  quality_type?: string | null
  dimensions?: string | null
  description?: string | null
  activity_type?: string | null
  details_json?: unknown
  exclusions_json?: unknown
  spec_lines_json?: unknown
  dept_hours?: Record<string, number> | null
  /** When true, this sub bills its own install — noted on the line (066). */
  install_included?: boolean | null
}

// Default activity type when a subproject has none — matches Built's fallback.
export const DEFAULT_ACTIVITY_TYPE = 'Millwork - Cabinets'

// A dash in any of QB's / Built's glyphs (hyphen, en, em, minus). Used to
// normalize "Millwork – Cabinets" vs "Millwork - Cabinets" before matching.
const DASH_VARIANTS = /[‐‑‒–—―−]/g

/** Normalize a QB item / activity-type name for strict-but-tolerant matching:
 *  lowercase, unify dash glyphs, collapse whitespace, trim. Equivalent names
 *  match; genuine near-misses still don't. */
export function normalizeItemName(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(DASH_VARIANTS, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when an activity type is an install/delivery line (gets the canned
 *  install scope instead of the material-scope description). */
export function isInstallActivity(activityType: string | null | undefined): boolean {
  const a = (activityType ?? '').toLowerCase()
  return a.includes('install') || a.includes('delivery')
}

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => (typeof x === 'string' ? x : String(x ?? ''))).filter((s) => s.trim())
}

// Strip a leading bullet glyph so we can re-prefix "- " uniformly.
function stripBullet(line: string): string {
  return line.replace(/^\s*[-•*]\s*/, '')
}

/** Canned install/delivery scope — ported from Built's buildInstallDescription. */
export function buildInstallDescription(_sub: SubprojectScope): string {
  return [
    'Delivery, Installation & Project Management',
    '***Pricing subject to change based on site conditions.',
    '',
    '- Installation locations must be ready to receive finished product and conditioned',
    '- Installation locations must be painted and free of other trades for installation',
    '- Site must be weatherized and water tight',
    '- Building access must have clear paths to freight elevators.',
    '- GC/Client to provide any site restrictions or unique conditions',
  ].join('\n')
}

/** Build the rich QB line description for a subproject. Ported from Built OS
 *  (buildRichDescription): Item name, Material/Finish, Description blocks
 *  (details_json → legacy description → spec-line notes), then Exclusions. */
export function buildRichDescription(sub: SubprojectScope): string {
  if (isInstallActivity(sub.activity_type)) return buildInstallDescription(sub)

  // NB: Built prepends "Item - {name}" here because its QB description is the
  // whole line. MillSuite already shows the subproject name as the line
  // headline, so repeating it here just doubles the name — omit it.
  const lines: string[] = []

  if (sub.material_finish || sub.quality_type) {
    const finish = sub.material_finish || sub.quality_type || ''
    lines.push(`Material - ${finish}`)
  }

  // Detail blocks: prefer the structured details_json, else the legacy squashed
  // description; then fold in anything extra carried on the spec lines.
  const details: string[] = []
  const detailBlocks = toStringArray(sub.details_json)
  if (detailBlocks.length > 0) {
    details.push(...detailBlocks)
  } else if (typeof sub.description === 'string' && sub.description.trim()) {
    details.push(sub.description.trim())
  }

  const specLines = Array.isArray(sub.spec_lines_json) ? sub.spec_lines_json : []
  for (const sl of specLines as any[]) {
    const mf = typeof sl?.material_finish === 'string' ? sl.material_finish.trim() : ''
    if (mf && !details.some((d) => d.includes(mf))) details.push(`${mf} finish`)
    if (sl?.drawer_type && Number(sl?.qty) > 0) {
      details.push(`QTY ${sl.qty} "${sl.drawer_type}" drawers with integrated soft close slides`)
    }
    const note = typeof sl?.notes === 'string' ? sl.notes.trim() : ''
    if (note && !note.startsWith('AI:') && !details.includes(note)) details.push(note)
  }

  if (details.length > 0) {
    lines.push('')
    lines.push('Description - ' + stripBullet(details[0]))
    // Continuation blocks (Dimensions / Details / etc.) render without a
    // leading "- " — cleaner in the estimate + QB description.
    for (let i = 1; i < details.length; i++) lines.push(stripBullet(details[i]))
  }

  // "Includes install" subs bill their own install — call it out on the line.
  if (sub.install_included) {
    lines.push('')
    lines.push('Includes Installation')
  }

  const exclusions = toStringArray(sub.exclusions_json)
  if (exclusions.length > 0) {
    lines.push('')
    lines.push('Exclusions:')
    for (const ex of exclusions) lines.push(`- ${stripBullet(ex)}`)
  }

  return lines.join('\n')
}

// ── Reading it back ─────────────────────────────────────────────────────────
//
// The estimate PDF renders the same scope text as labelled sections with real
// spacing, rather than the one squashed paragraph it used to be. It gets that
// by parsing the string `buildRichDescription` produced, NOT from structured
// fields on the payload — deliberately:
//
//   · Sent estimates re-render from `projects.estimate_snapshot_json`, which
//     stores the flattened `lineItems` and nothing else. Structured fields on
//     the payload would only ever reach freshly-generated estimates, leaving
//     every estimate already sent rendering the old blob forever.
//   · One source of truth. The QB push and the PDF keep showing byte-identical
//     scope, because there's still only one place the text is built.
//
// The cost is that this parser is coupled to the format above — so THE TWO
// MUST BE EDITED TOGETHER. It's written to fail soft: anything it doesn't
// recognise comes back as a plain unlabelled block, which renders as today's
// text rather than losing content.

export interface ScopeSection {
  /** Section heading ("Material", "Description", "Exclusions") — null for a
   *  leading block with no label, e.g. the canned install scope. */
  label: string | null
  lines: string[]
  /** Render as a dash list rather than paragraphs. */
  bullets?: boolean
}

/** Split a built description back into labelled sections for display.
 *  Pure; safe on empty input (returns []). */
export function parseRichDescription(text: string): ScopeSection[] {
  const raw = (text ?? '').split('\n')
  const sections: ScopeSection[] = []
  let current: ScopeSection | null = null

  const push = () => {
    if (current && current.lines.length > 0) sections.push(current)
    current = null
  }

  for (const rawLine of raw) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue // blank lines were the old separator; we space it ourselves now

    const material = /^Material\s+-\s+(.*)$/.exec(line)
    if (material) {
      push()
      current = { label: 'Material', lines: [material[1].trim()] }
      continue
    }

    const description = /^Description\s+-\s+(.*)$/.exec(line)
    if (description) {
      push()
      current = { label: 'Description', lines: [description[1].trim()] }
      continue
    }

    // Shops write "Dimensions - …" / "Details - …" as their own detail blocks,
    // so they arrive as continuation lines under Description. Promote them to
    // real sections — that's what makes a long kitchen line scannable.
    // A fixed keyword list, not a generic `Word - value` match, so a detail
    // that happens to start "Island - ..." doesn't invent a section heading.
    const keyed = /^(Dimensions|Details|Hardware|Finish|Notes)\s+-\s+(.*)$/i.exec(line)
    if (keyed) {
      push()
      const label = keyed[1]
      current = {
        label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
        lines: [keyed[2].trim()],
      }
      continue
    }

    if (/^Includes Installation$/i.test(line)) {
      push()
      current = { label: null, lines: ['Includes installation'] }
      push()
      continue
    }

    if (/^Exclusions:?$/i.test(line)) {
      push()
      current = { label: 'Exclusions', lines: [], bullets: true }
      continue
    }

    // Continuation of whatever section we're in. Exclusions arrive as "- x";
    // strip the glyph so the renderer owns the bullet.
    // (`body` is annotated because `current` is reassigned from it below, and
    // TS otherwise reports a circular inference through the closure.)
    const body: string = current?.bullets ? stripBullet(line) : line
    if (current) current.lines.push(body)
    else current = { label: null, lines: [body] }
  }
  push()

  return sections
}
