// ============================================================================
// lib/handoff-contacts.ts — a job's OTHER contacts: GC, designer, … (136)
// ============================================================================
// PURE — no supabase import. Shared by the pre-production Handoff card, the
// client's approval portal (read model + the public contact route) and the
// verify script.
//
// The point of contact is NOT in this list. It stays in projects.poc_name /
// poc_phone / poc_email, which is what the production gate reads. These are
// the extra people on a job, each filed under a category. They never gate.
// ============================================================================

export const CONTACT_CATEGORIES = ['gc', 'designer', 'architect', 'owner', 'site', 'other'] as const
export type ContactCategory = (typeof CONTACT_CATEGORIES)[number]

export const CONTACT_CATEGORY_LABEL: Record<ContactCategory, string> = {
  gc: 'General contractor',
  designer: 'Designer',
  architect: 'Architect',
  owner: 'Owner',
  site: 'Site super',
  other: 'Other',
}

/** The short tag shown beside a name ("GC · David Andrukaitis"). */
export const CONTACT_CATEGORY_SHORT: Record<ContactCategory, string> = {
  gc: 'GC',
  designer: 'Designer',
  architect: 'Architect',
  owner: 'Owner',
  site: 'Site super',
  other: 'Other',
}

export interface HandoffContact {
  id: string
  category: ContactCategory
  name: string
  phone: string | null
  email: string | null
}

/** More than this on one job is a directory, not a handoff sheet — and it
 *  bounds what a public link can append. */
export const MAX_HANDOFF_CONTACTS = 8

const clean = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : ''

export function normalizeContactCategory(v: unknown): ContactCategory {
  return (CONTACT_CATEGORIES as readonly string[]).includes(String(v)) ? (v as ContactCategory) : 'other'
}

export function newContactId(): string {
  return `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Whatever is in the column → a clean list. Rows with no name are dropped (a
 *  phone number filed under nobody is not a contact); ids are de-duplicated. */
export function normalizeHandoffContacts(raw: unknown): HandoffContact[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: HandoffContact[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    const name = clean(row.name, 80)
    if (!name) continue
    let id = clean(row.id, 40)
    if (!id || seen.has(id)) id = newContactId()
    seen.add(id)
    out.push({
      id,
      category: normalizeContactCategory(row.category),
      name,
      phone: clean(row.phone, 40) || null,
      email: clean(row.email, 120) || null,
    })
    if (out.length >= MAX_HANDOFF_CONTACTS) break
  }
  return out
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface ContactMergeResult {
  contacts: HandoffContact[]
  /** One line per change, in the client's words — these become activity. */
  changes: Array<{ kind: 'added' | 'updated'; category: ContactCategory; name: string }>
  error: string | null
}

/**
 * What a CLIENT'S edit (from the public portal) does to the list.
 *
 * ⛔ A CLIENT CAN ADD AND CORRECT, NEVER REMOVE. A submitted row whose id we
 * already hold updates that row; a row with a name and no known id is added;
 * a row we hold that the client left out — or blanked — is kept as it was.
 * Removing a contact is the shop's call, on the pre-production page. So no
 * request from a public link can empty the shop's records, and the list can
 * only grow to MAX_HANDOFF_CONTACTS.
 */
export function mergeClientContacts(currentRaw: unknown, submitted: unknown): ContactMergeResult {
  const contacts = normalizeHandoffContacts(currentRaw).map((c) => ({ ...c }))
  const changes: ContactMergeResult['changes'] = []
  if (!Array.isArray(submitted)) return { contacts, changes, error: null }

  for (const r of submitted.slice(0, MAX_HANDOFF_CONTACTS * 2)) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    const name = clean(row.name, 80)
    const phone = clean(row.phone, 40) || null
    const email = clean(row.email, 120) || null
    const category = normalizeContactCategory(row.category)
    if (email && !EMAIL_RE.test(email)) return { contacts, changes: [], error: 'That email doesn’t look right' }

    const existing = contacts.find((c) => c.id === clean(row.id, 40))
    if (existing) {
      if (!name) continue // blanking a name is not a delete
      const next = { ...existing, name, category, phone: phone ?? existing.phone, email: email ?? existing.email }
      // An emptied phone/email box means "leave it" too, same as the POC fields.
      if (JSON.stringify(next) !== JSON.stringify(existing)) {
        Object.assign(existing, next)
        changes.push({ kind: 'updated', category, name })
      }
      continue
    }
    if (!name) continue
    if (contacts.length >= MAX_HANDOFF_CONTACTS) {
      return { contacts, changes: [], error: `That’s the most contacts a project can hold (${MAX_HANDOFF_CONTACTS})` }
    }
    contacts.push({ id: newContactId(), category, name, phone, email })
    changes.push({ kind: 'added', category, name })
  }
  return { contacts, changes, error: null }
}

/** "added a Designer contact" / "updated the GC contact" — activity wording. */
export function contactChangeText(c: { kind: 'added' | 'updated'; category: ContactCategory }): string {
  const tag = CONTACT_CATEGORY_SHORT[c.category]
  return c.kind === 'added' ? `added ${/^[AEIO]/.test(tag) ? 'an' : 'a'} ${tag} contact` : `updated the ${tag} contact`
}
