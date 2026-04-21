// ============================================================================
// lib/pdf-parser.ts — PDF parser for the sales-dashboard intake flow
// ============================================================================
// Primary path: POST the PDF to /api/parse-drawings, which asks Claude to pull
// structured intake + shop scope off the drawing set (header fields, rooms,
// items with LF). We transform that into the ParsedPdf envelope the sales UI
// already understands — header fields become role-tagged candidates with
// pre-assigned roles, rooms become `kind: 'room'` chips, and items get
// stashed on the envelope so subproject seeding can pass LF through.
//
// Fallback path: if the API call fails (no API key, 500, 413 too large, etc.)
// we drop back to the pdfjs + regex extractor so the user still gets chips to
// work with. The regex extractor is intentionally conservative — it's the
// safety net, not the headline feature.
// ============================================================================

export type CandidateRole =
  | 'client_name'
  | 'client_company'
  | 'designer'
  | 'gc'
  | 'venue'
  | 'address'
  | 'email'
  | 'phone'
  | 'amount'
  | 'date'
  | 'room'
  | 'other'

export interface ParsedCandidate {
  id: string // stable id for react keys (random)
  kind: 'email' | 'phone' | 'address' | 'amount' | 'date' | 'name' | 'company' | 'room'
  value: string
  role?: CandidateRole // user picks via dropdown in the UI
  defaultRole?: CandidateRole // API-assigned default; overrides kind-based defaultRoleFor()
  confidence: 'high' | 'medium' | 'low'
}

/** Scope item returned by the AI parser. Used for LF-aware subproject seeding. */
export interface ParsedScopeItem {
  name: string
  room: string
  category: string
  linear_feet: number | null
  quantity: number
  notes: string
}

export interface ParsedPdf {
  fileName: string
  pageCount: number
  text: string // concatenated page text (truncated to 20k chars for safety)
  candidates: ParsedCandidate[]
  projectNameGuess: string | null
  parseSucceeded: boolean // false → UI should drop into manual-entry fallback
  // Optional — populated when the AI parser succeeds. The sales page can thread
  // these through to createRoomSubprojects so LF lands on subprojects.
  items?: ParsedScopeItem[]
  scopeSummary?: string | null
  source?: 'api' | 'regex' | 'none'
  // Populated when the AI path failed. Surfaced in the UI so users know why
  // they're looking at fallback chips instead of a clean AI parse.
  apiError?: string | null
}

// Short id helper; we don't need crypto-strong ids for react keys.
function rid() {
  return Math.random().toString(36).slice(2, 10)
}

// Known US state abbreviations (used to validate address candidates).
const US_STATES = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'
    .split(' ')
)

// Words that commonly start sentences and are not person/company names.
// Room words live in ROOM_WORDS below — they still need to be filtered out
// of the name extractor so "Kitchen" doesn't come back as a client name.
const NAME_STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For', 'With',
  'From', 'Please', 'Thank', 'Thanks', 'Dear', 'Hello', 'Regards',
  'Sincerely', 'Attn', 'Attention', 'Subject', 'Re', 'Date', 'Project',
  'Job', 'Quote', 'Estimate', 'Invoice', 'Proposal', 'Drawing', 'Drawings',
  'Page', 'Sheet', 'Scale', 'Notes', 'Note', 'General', 'Specifications',
  'Spec', 'Elevation', 'Elevations', 'Plan', 'Plans', 'Section', 'Detail',
])

// Single-word hits that mark a room / subproject candidate. Used two ways:
// (a) as a filter so the name extractor doesn't misclassify rooms as clients;
// (b) as a seed for the room extractor — any line that contains one of these
// words is a candidate (we grab the nearest label like "Master Bathroom",
// "Kitchen — Island", or just "Kitchen").
const ROOM_WORDS = new Set([
  'Kitchen', 'Kitchens', 'Bathroom', 'Bathrooms', 'Bath', 'Powder',
  'Bedroom', 'Bedrooms', 'Living', 'Dining', 'Family', 'Great',
  'Master', 'Primary', 'Guest', 'Office', 'Study', 'Library',
  'Laundry', 'Mudroom', 'Pantry', 'Closet', 'Foyer', 'Entry',
  'Hallway', 'Hall', 'Basement', 'Garage', 'Nursery', 'Playroom',
  'Butler', 'Wetbar', 'Wet', 'Bar', 'Wine', 'Media', 'Theater',
  'Vanity', 'Vanities', 'Island', 'Built-in', 'Builtin', 'Bookcase',
  'Bookcases', 'Wardrobe', 'Wardrobes',
])

// Rooms that we also accept as multi-word phrases ("Master Bathroom",
// "Wet Bar", "Butler's Pantry", "Powder Room").
const ROOM_SUFFIXES = new Set([
  'Kitchen', 'Bathroom', 'Bath', 'Bedroom', 'Room', 'Office', 'Study',
  'Closet', 'Pantry', 'Foyer', 'Entry', 'Hallway', 'Hall', 'Basement',
  'Garage', 'Nursery', 'Playroom', 'Vanity', 'Island', 'Bar', 'Mudroom',
  'Laundry', 'Library',
])

// Common company-entity suffixes that upgrade a Title-Case phrase from
// "name" to "company".
const COMPANY_TAILS = /\b(?:LLC|Inc\.?|Incorporated|Co\.?|Corp\.?|Ltd\.?|Corporation|Company|Studio|Studios|Design|Designs|Architects?|Interiors?|Group|Partners?|Associates|Construction|Builders?|Homes|Development|Custom|Millwork|Cabinetry)\b/i

// ── Text extraction ──

async function extractTextFromPdf(file: File): Promise<{ text: string; pageCount: number }> {
  // pdfjs-dist's legacy build ships CJS-compatible glue so it imports cleanly
  // under our current bundler config. Worker is pointed at a CDN to avoid a
  // public/ file copy step.
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.mjs')
  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/legacy/build/pdf.worker.mjs`
  } catch {
    /* ignore — some environments reject writes to GlobalWorkerOptions */
  }

  const buf = await file.arrayBuffer()
  const doc = await pdfjsLib.getDocument({ data: buf, disableWorker: false }).promise
  const pages: string[] = []
  const maxPages = Math.min(doc.numPages, 8) // cap at 8 pages — first sheet
                                              // of a drawing set carries the
                                              // title block anyway
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const text = (content.items || [])
      .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
      .join(' ')
    pages.push(text)
  }
  return { text: pages.join('\n\n').slice(0, 20_000), pageCount: doc.numPages }
}

// ── Entity extractors ──

function extractEmails(text: string): ParsedCandidate[] {
  const seen = new Set<string>()
  const out: ParsedCandidate[] = []
  const re = /[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const v = m[0].replace(/[.,;]$/, '')
    if (seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push({ id: rid(), kind: 'email', value: v, confidence: 'high' })
  }
  return out
}

function extractPhones(text: string): ParsedCandidate[] {
  const seen = new Set<string>()
  const out: ParsedCandidate[] = []
  // Matches (555) 555-5555, 555-555-5555, 555.555.5555, +1 555 555 5555.
  const re = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const digits = m[0].replace(/\D/g, '')
    if (digits.length < 10 || digits.length > 11) continue
    const norm = digits.length === 11 ? digits.slice(1) : digits
    const pretty = `(${norm.slice(0, 3)}) ${norm.slice(3, 6)}-${norm.slice(6)}`
    if (seen.has(pretty)) continue
    seen.add(pretty)
    out.push({ id: rid(), kind: 'phone', value: pretty, confidence: 'high' })
  }
  return out
}

function extractAmounts(text: string): ParsedCandidate[] {
  const seen = new Set<string>()
  const out: ParsedCandidate[] = []
  const re = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\$\s?\d+(?:\.\d{2})?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const v = m[0].replace(/\s/g, '')
    const n = Number(v.replace(/[$,]/g, ''))
    if (!Number.isFinite(n) || n < 100) continue // skip trivial callouts ($12)
    if (seen.has(v)) continue
    seen.add(v)
    out.push({
      id: rid(),
      kind: 'amount',
      value: v,
      confidence: n >= 1000 ? 'high' : 'medium',
    })
  }
  return out
}

function extractDates(text: string): ParsedCandidate[] {
  const seen = new Set<string>()
  const out: ParsedCandidate[] = []
  const patterns: RegExp[] = [
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
    /\b\d{1,2}-\d{1,2}-\d{2,4}\b/g,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const v = m[0].trim()
      if (seen.has(v)) continue
      seen.add(v)
      out.push({ id: rid(), kind: 'date', value: v, confidence: 'medium' })
    }
  }
  return out
}

function extractAddresses(text: string): ParsedCandidate[] {
  const seen = new Set<string>()
  const out: ParsedCandidate[] = []
  // Street line + city/state/zip on same or next line. Keep it simple:
  // look for "### Name St/Ave/Rd/Blvd/Dr/Ln/Ct/Way/Pl/Hwy/Pkwy" and snap up
  // trailing city/state/zip if present.
  const streetRe =
    /\b(\d{1,6}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,4}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Way|Place|Pl|Highway|Hwy|Parkway|Pkwy|Circle|Cir|Terrace|Ter)\b\.?)(?:[,\s]+([A-Z][A-Za-z.' -]+),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?))?/g
  let m: RegExpExecArray | null
  while ((m = streetRe.exec(text))) {
    const street = m[1]?.trim()
    const city = m[2]?.trim()
    const state = m[3]?.trim()
    const zip = m[4]?.trim()
    let v = street
    let conf: ParsedCandidate['confidence'] = 'medium'
    if (state && US_STATES.has(state.toUpperCase())) {
      v = `${street}, ${city}, ${state} ${zip}`
      conf = 'high'
    }
    if (seen.has(v)) continue
    seen.add(v)
    out.push({ id: rid(), kind: 'address', value: v, confidence: conf })
  }
  return out
}

function extractNamesAndCompanies(text: string): ParsedCandidate[] {
  const seen = new Set<string>()
  const out: ParsedCandidate[] = []
  // Title-Case sequences of 2–4 words, filtered against stopwords. We scan
  // line-by-line so a newline cuts runs and we don't get "Quote Sarah
  // Henderson Kitchen" as one phrase.
  const lines = text.split(/[\n\r]+/)
  const phraseRe = /\b([A-Z][a-zA-Z'&.-]{1,}(?:\s+(?:&|and|of|the|de|la)?\s?[A-Z][a-zA-Z'&.-]{1,}){1,3})\b/g
  for (const line of lines) {
    let m: RegExpExecArray | null
    while ((m = phraseRe.exec(line))) {
      const phrase = m[1].trim().replace(/\s+/g, ' ')
      const firstWord = phrase.split(' ')[0]
      if (NAME_STOPWORDS.has(firstWord)) continue
      // If any word of the phrase is a room word, the room extractor owns it.
      if (phrase.split(' ').some((w) => ROOM_WORDS.has(w))) continue
      // Phrases that are pure letters without any lowercase char are usually
      // headings (e.g. "KITCHEN PLAN") — skip.
      if (!/[a-z]/.test(phrase)) continue
      if (phrase.length > 80) continue
      const key = phrase.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const isCompany = COMPANY_TAILS.test(phrase)
      out.push({
        id: rid(),
        kind: isCompany ? 'company' : 'name',
        value: phrase,
        confidence: isCompany ? 'high' : 'medium',
      })
    }
  }
  return out
}

// ── Room / subproject detection ──
// We want to pull "Kitchen", "Master Bathroom", "Butler's Pantry", "Wet Bar",
// etc. off the drawings so the user can tag them as rooms and we'll seed
// subprojects automatically. We handle three shapes:
//   1. Short Title-Case phrases that include a ROOM_WORD (e.g. "Master Bath")
//   2. ALL-CAPS sheet headers that are just a room ("KITCHEN", "POWDER ROOM")
//   3. Bullet-y lines like "• Kitchen" / "1. Master Bathroom"
// Multi-word detection grabs up to 2 Title-Case words ahead of the seed word
// so "Master Bathroom" is one chip, not two.

function normalizeRoomLabel(s: string): string {
  return s
    .replace(/[^\w\s'&-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Title Case every word — handles ALL-CAPS input like "POWDER ROOM".
    .split(' ')
    .map((w) => {
      if (!w) return w
      // Preserve "Built-in" style hyphenation.
      return w
        .split('-')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join('-')
    })
    .join(' ')
}

function extractRooms(text: string): ParsedCandidate[] {
  const seen = new Set<string>()
  const out: ParsedCandidate[] = []
  const lines = text.split(/[\n\r]+/)

  for (let raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.length > 80) continue // body paragraphs, not labels

    // Strip leading bullets / numbering so "1. Master Bathroom" becomes
    // "Master Bathroom".
    const cleaned = line.replace(/^[\s•●◦\-*·]*\d{0,2}[.)]?\s+/, '')

    // Case A: the line IS a short room label (e.g. "Kitchen", "POWDER ROOM",
    // "Master Bath", "Butler's Pantry"). Accept lines with 1–4 tokens where at
    // least one token is a room word.
    const tokens = cleaned.split(/\s+/)
    if (tokens.length >= 1 && tokens.length <= 4) {
      const asTitle = tokens
        .map((t) =>
          /^[A-Z][A-Z0-9'.-]*$/.test(t)
            ? t.charAt(0) + t.slice(1).toLowerCase()
            : t
        )
      const hasRoom = asTitle.some((t) => {
        const bare = t.replace(/[^A-Za-z-]/g, '')
        return (
          ROOM_WORDS.has(bare) ||
          ROOM_WORDS.has(bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase())
        )
      })
      if (hasRoom) {
        const label = normalizeRoomLabel(cleaned)
        const key = label.toLowerCase()
        if (label.length >= 3 && !seen.has(key)) {
          seen.add(key)
          // Heuristic: multi-word matches are higher-signal than a bare
          // "Kitchen" dropped in body text.
          const conf: ParsedCandidate['confidence'] =
            tokens.length >= 2 ? 'high' : 'medium'
          out.push({ id: rid(), kind: 'room', value: label, confidence: conf })
          continue
        }
      }
    }

    // Case B: room phrase embedded in a longer line — e.g.
    // "Henderson residence — kitchen & master bath renovation". Scan for
    // Title-Case or ALL-CAPS room phrases.
    const embedded =
      /\b([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){0,2})\b/g
    let m: RegExpExecArray | null
    while ((m = embedded.exec(cleaned))) {
      const phrase = m[1].trim()
      const words = phrase.split(/\s+/)
      // Must contain a room word and either be 2+ words or end in a known
      // room suffix.
      const hasRoom = words.some((w) => ROOM_WORDS.has(w))
      const endsRoom = ROOM_SUFFIXES.has(words[words.length - 1])
      if (!hasRoom && !endsRoom) continue
      if (words.length === 1 && !endsRoom) continue
      const label = normalizeRoomLabel(phrase)
      const key = label.toLowerCase()
      if (seen.has(key)) continue
      if (label.length < 3 || label.length > 40) continue
      seen.add(key)
      out.push({ id: rid(), kind: 'room', value: label, confidence: 'medium' })
    }
  }

  // Cap at 12 rooms — a drawing set with more than that is unusual and the
  // overflow is almost always noise.
  return out.slice(0, 12)
}

// Guess a project name: first non-trivial line of the text that looks like
// a heading (short, Title Case or ALL CAPS, no address/amount/date noise).
function guessProjectName(text: string, fileName: string): string | null {
  const cleanedFile = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
  const lines = text
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  for (const line of lines.slice(0, 12)) {
    if (line.length < 6 || line.length > 80) continue
    if (/^\d/.test(line)) continue
    if (/[$@]/.test(line)) continue
    if (/\b(?:page|sheet|scale|drawing|revision|rev\.|dated?)\b/i.test(line)) continue
    // Title-case-ish check: at least two words, first letters mostly upper.
    const words = line.split(/\s+/).filter((w) => w.length > 1)
    if (words.length < 2) continue
    const upperish = words.filter((w) => /^[A-Z]/.test(w)).length
    if (upperish / words.length < 0.6) continue
    return line
  }
  return cleanedFile || null
}

// ── API-backed parser (primary path) ──

import { supabase } from '@/lib/supabase'

const PARSE_BUCKET = 'parse-drawings'

// Encode a File as base64 without blowing the call stack on large PDFs.
async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)
  // String.fromCharCode.apply has a max-arguments ceiling; chunk the bytes so
  // a 20 MB PDF doesn't throw RangeError.
  let binary = ''
  const chunk = 0x8000 // 32 KB
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length))
    binary += String.fromCharCode.apply(null, Array.from(slice) as any)
  }
  if (typeof btoa === 'function') return btoa(binary)
  // Node fallback (shouldn't trigger in the browser)
  return Buffer.from(binary, 'binary').toString('base64')
}

function randomKey(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  )
}

/**
 * Upload the PDF to the `parse-drawings` Supabase bucket and return the
 * storage path. Scoped to `{orgId}/...` so RLS grants the browser insert
 * rights for this org's own prefix.
 */
async function uploadToParseBucket(
  file: File,
  orgId: string,
): Promise<{ path: string } | { error: string }> {
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-60)
  const path = `${orgId}/${randomKey()}-${safeName}`
  const { error } = await supabase.storage.from(PARSE_BUCKET).upload(path, file, {
    contentType: file.type || 'application/pdf',
    upsert: false,
  })
  if (error) return { error: error.message || 'upload failed' }
  return { path }
}

interface ApiResponse {
  project_name: string | null
  scope_summary: string | null
  file_name: string | null
  header: {
    client_name: string | null
    client_company: string | null
    designer_name: string | null
    gc_name: string | null
    address: string | null
    email: string | null
    phone: string | null
    estimated_price: number | null
    date: string | null
  }
  rooms: string[]
  items: ParsedScopeItem[]
}

// Shape a header field into a ParsedCandidate with the correct kind + pre-
// assigned role. `kind` controls which icon + dropdown options the UI shows;
// `defaultRole` is what the page seeds into the role dropdown.
function headerCandidate(
  value: string,
  kind: ParsedCandidate['kind'],
  role: CandidateRole,
): ParsedCandidate {
  return {
    id: rid(),
    kind,
    value,
    defaultRole: role,
    confidence: 'high',
  }
}

function formatAmount(n: number): string {
  // The rest of the app sees amounts as "$12,345" strings — keep that shape so
  // Number(value.replace(/[$,]/g, '')) still works in the sales page.
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function buildCandidatesFromApi(api: ApiResponse): ParsedCandidate[] {
  const out: ParsedCandidate[] = []
  const h = api.header || ({} as ApiResponse['header'])

  if (h.client_name) out.push(headerCandidate(h.client_name, 'name', 'client_name'))
  if (h.client_company) out.push(headerCandidate(h.client_company, 'company', 'client_company'))
  if (h.designer_name) {
    // Designer-like values can be a person or a firm; COMPANY_TAILS distinguishes.
    const kind: ParsedCandidate['kind'] = COMPANY_TAILS.test(h.designer_name) ? 'company' : 'name'
    out.push(headerCandidate(h.designer_name, kind, 'designer'))
  }
  if (h.gc_name) {
    const kind: ParsedCandidate['kind'] = COMPANY_TAILS.test(h.gc_name) ? 'company' : 'name'
    out.push(headerCandidate(h.gc_name, kind, 'gc'))
  }
  if (h.address) out.push(headerCandidate(h.address, 'address', 'address'))
  if (h.email) out.push(headerCandidate(h.email, 'email', 'email'))
  if (h.phone) out.push(headerCandidate(h.phone, 'phone', 'phone'))
  if (typeof h.estimated_price === 'number' && h.estimated_price > 0) {
    out.push(headerCandidate(formatAmount(h.estimated_price), 'amount', 'amount'))
  }
  if (h.date) out.push(headerCandidate(h.date, 'date', 'date'))

  // Rooms — one chip per room, pre-assigned to the `room` role. The sales page
  // uses `pickAll('room')` to collect them and seed subprojects.
  const roomSet = new Set<string>()
  for (const r of api.rooms || []) {
    const label = typeof r === 'string' ? r.trim() : ''
    if (!label) continue
    const key = label.toLowerCase()
    if (roomSet.has(key)) continue
    roomSet.add(key)
    out.push({
      id: rid(),
      kind: 'room',
      value: label,
      defaultRole: 'room',
      confidence: 'high',
    })
  }

  return out
}

interface ParseApiResult {
  pdf?: ParsedPdf
  error?: string
}

/**
 * Call /api/parse-drawings. Prefers the storage-path flow (unlimited file
 * size), falls back to inline base64 for small PDFs when orgId isn't
 * available. Returns either a parsed envelope or an error message —
 * `null` is no longer used so the caller can surface the failure.
 */
async function parseViaApi(file: File, orgId?: string): Promise<ParseApiResult> {
  let payload: Record<string, any>
  let uploadedPath: string | null = null

  if (orgId) {
    const up = await uploadToParseBucket(file, orgId)
    if ('error' in up) {
      return { error: `Upload failed: ${up.error}` }
    }
    uploadedPath = up.path
    payload = {
      storage_path: up.path,
      file_name: file.name,
      mime_type: file.type || 'application/pdf',
    }
  } else {
    // Small-file path — limited by the Vercel 4.5 MB request-body ceiling.
    try {
      const base64 = await fileToBase64(file)
      payload = {
        base64_content: base64,
        file_name: file.name,
        mime_type: file.type || 'application/pdf',
      }
    } catch (err: any) {
      return { error: `Encoding failed: ${err?.message || String(err)}` }
    }
  }

  let resp: Response
  try {
    resp = await fetch('/api/parse-drawings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err: any) {
    return { error: `Network error: ${err?.message || String(err)}` }
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    let message = `API ${resp.status}`
    try {
      const parsed = JSON.parse(body)
      if (parsed?.error) message = parsed.error
    } catch {
      if (body) message = body.slice(0, 240)
    }
    console.warn('parse-drawings API failed', resp.status, message)
    // If the client uploaded to storage but the server couldn't parse, try
    // to clean up opportunistically. A failed delete isn't worth surfacing.
    if (uploadedPath) {
      supabase.storage.from(PARSE_BUCKET).remove([uploadedPath]).catch(() => {})
    }
    return { error: message }
  }

  const api = (await resp.json()) as ApiResponse
  const candidates = buildCandidatesFromApi(api)
  return {
    pdf: {
      fileName: file.name,
      pageCount: 0, // API doesn't report page count; we don't need it downstream
      text: '',
      candidates,
      projectNameGuess:
        api.project_name ||
        file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() ||
        null,
      parseSucceeded: candidates.length > 0,
      items: Array.isArray(api.items) ? api.items : [],
      scopeSummary: api.scope_summary || null,
      source: 'api',
      apiError: null,
    },
  }
}

// ── Regex fallback (used when the API is unavailable) ──

async function parseViaRegex(file: File): Promise<ParsedPdf> {
  try {
    const { text, pageCount } = await extractTextFromPdf(file)
    const candidates: ParsedCandidate[] = [
      ...extractEmails(text),
      ...extractPhones(text),
      ...extractAddresses(text),
      ...extractAmounts(text),
      ...extractDates(text),
      ...extractRooms(text),
      ...extractNamesAndCompanies(text),
    ]
    // Ranking: high confidence first, then by kind order so the UI groups
    // nicely. Also cap names/companies to the 8 strongest since these are
    // the noisiest extractors.
    const strong = candidates.filter(
      (c) => c.kind !== 'name' && c.kind !== 'company' && c.kind !== 'room'
    )
    const rooms = candidates.filter((c) => c.kind === 'room')
    const softCap = candidates
      .filter((c) => c.kind === 'name' || c.kind === 'company')
      .slice(0, 8)
    const sorted = [...strong, ...rooms, ...softCap]

    return {
      fileName: file.name,
      pageCount,
      text,
      candidates: sorted,
      projectNameGuess: guessProjectName(text, file.name),
      parseSucceeded: sorted.length > 0,
      source: 'regex',
    }
  } catch (err) {
    console.warn('parsePdfFile regex fallback failed', err)
    return {
      fileName: file.name,
      pageCount: 0,
      text: '',
      candidates: [],
      projectNameGuess: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      parseSucceeded: false,
      source: 'none',
    }
  }
}

// ── Public entry point ──

/**
 * Parse a drawings PDF.
 * @param file  The File the user dropped on the sales page.
 * @param orgId The current org's id — used to namespace the storage upload
 *              so the server can read it back under RLS. If omitted the
 *              parser falls back to inline base64 (limited to ~3 MB).
 */
export async function parsePdfFile(file: File, orgId?: string): Promise<ParsedPdf> {
  // Images bypass the API (it only accepts PDFs) and the regex path (pdfjs
  // only speaks PDF). Drop straight into the manual-entry flow with a
  // filename seed.
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
  if (!isPdf) {
    return {
      fileName: file.name,
      pageCount: 0,
      text: '',
      candidates: [],
      projectNameGuess: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      parseSucceeded: false,
      source: 'none',
    }
  }

  // Try the Claude-backed API first. If it fails we drop to the regex
  // extractor so the user still sees SOMETHING, but we stash the API error
  // on the envelope so the UI can show a "fallback mode" banner.
  const result = await parseViaApi(file, orgId)
  if (result.pdf) return result.pdf

  const regex = await parseViaRegex(file)
  regex.apiError = result.error || 'AI parser returned no result'
  return regex
}

// Default role guess for a candidate. Used when populating dropdowns so the
// user's first click is usually accept-not-correct. The API parser pre-assigns
// roles via defaultRole (e.g. a name extracted from the "Designed by" field is
// tagged `designer`), so honor that first before falling back to kind heuristics.
export function defaultRoleFor(c: ParsedCandidate): CandidateRole {
  if (c.defaultRole) return c.defaultRole
  switch (c.kind) {
    case 'email':
      return 'email'
    case 'phone':
      return 'phone'
    case 'address':
      return 'address'
    case 'amount':
      return 'amount'
    case 'date':
      return 'date'
    case 'company':
      return 'client_company'
    case 'name':
      return 'client_name'
    case 'room':
      return 'room'
    default:
      return 'other'
  }
}

export const ROLE_LABEL: Record<CandidateRole, string> = {
  client_name: 'Client',
  client_company: 'Client company',
  designer: 'Designer',
  gc: 'GC',
  venue: 'Venue',
  address: 'Address',
  email: 'Email',
  phone: 'Phone',
  amount: 'Amount',
  date: 'Date',
  room: 'Room / subproject',
  other: 'Ignore',
}

/**
 * Role options surfaced in the dropdown for each candidate. Pre-filtered to
 * the roles that make sense for the candidate's kind so the UI isn't a wall
 * of mismatched options.
 */
export function roleOptionsFor(c: ParsedCandidate): CandidateRole[] {
  switch (c.kind) {
    case 'email':
      return ['email', 'other']
    case 'phone':
      return ['phone', 'other']
    case 'address':
      return ['address', 'venue', 'other']
    case 'amount':
      return ['amount', 'other']
    case 'date':
      return ['date', 'other']
    case 'company':
      return ['client_company', 'designer', 'gc', 'venue', 'other']
    case 'name':
      return ['client_name', 'designer', 'gc', 'other']
    case 'room':
      return ['room', 'other']
    default:
      return ['other']
  }
}
