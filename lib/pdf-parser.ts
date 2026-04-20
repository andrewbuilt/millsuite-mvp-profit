// ============================================================================
// lib/pdf-parser.ts — real PDF parser for the sales-dashboard intake flow
// ============================================================================
// Replaces the Phase 2 filename-read stub. Given a PDF (or image) file, we:
//   1. extract text using pdfjs-dist (dynamic-imported in the browser, so it
//      doesn't balloon the server bundle or blow up SSR)
//   2. run lightweight regex entity extractors over the text: emails, phones,
//      street-style addresses, money amounts, dates, and Title-Case name or
//      company candidates
//   3. return a ParsedPdf object the UI turns into role-tagged candidate chips
//
// Intentionally pragmatic — this is V1 of "real parsing," not an ML model.
// Phase 10 closes the suggestion loop; ingestion accuracy can climb there.
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
  | 'other'

export interface ParsedCandidate {
  id: string // stable id for react keys (random)
  kind: 'email' | 'phone' | 'address' | 'amount' | 'date' | 'name' | 'company'
  value: string
  role?: CandidateRole // user picks via dropdown in the UI
  confidence: 'high' | 'medium' | 'low'
}

export interface ParsedPdf {
  fileName: string
  pageCount: number
  text: string // concatenated page text (truncated to 20k chars for safety)
  candidates: ParsedCandidate[]
  projectNameGuess: string | null
  parseSucceeded: boolean // false → UI should drop into manual-entry fallback
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
const NAME_STOPWORDS = new Set([
  'The', 'This', 'That', 'These', 'Those', 'And', 'But', 'For', 'With',
  'From', 'Please', 'Thank', 'Thanks', 'Dear', 'Hello', 'Regards',
  'Sincerely', 'Attn', 'Attention', 'Subject', 'Re', 'Date', 'Project',
  'Job', 'Quote', 'Estimate', 'Invoice', 'Proposal', 'Drawing', 'Drawings',
  'Page', 'Sheet', 'Scale', 'Notes', 'Note', 'General', 'Specifications',
  'Spec', 'Kitchen', 'Bathroom', 'Bedroom', 'Living', 'Dining', 'Master',
  'Cabinet', 'Cabinets', 'Millwork',
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

// ── Public entry point ──

export async function parsePdfFile(file: File): Promise<ParsedPdf> {
  // Images bypass text extraction — we just seed the filename guess and let
  // the UI drop into the manual/chip-driven path.
  const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf'
  if (!isPdf) {
    return {
      fileName: file.name,
      pageCount: 0,
      text: '',
      candidates: [],
      projectNameGuess: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      parseSucceeded: false,
    }
  }

  try {
    const { text, pageCount } = await extractTextFromPdf(file)
    const candidates: ParsedCandidate[] = [
      ...extractEmails(text),
      ...extractPhones(text),
      ...extractAddresses(text),
      ...extractAmounts(text),
      ...extractDates(text),
      ...extractNamesAndCompanies(text),
    ]
    // Ranking: high confidence first, then by kind order so the UI groups
    // nicely. Also cap names/companies to the 6 strongest since these are
    // the noisiest extractors.
    const strong = candidates.filter((c) => c.kind !== 'name' && c.kind !== 'company')
    const softCap = candidates
      .filter((c) => c.kind === 'name' || c.kind === 'company')
      .slice(0, 8)
    const sorted = [...strong, ...softCap]

    return {
      fileName: file.name,
      pageCount,
      text,
      candidates: sorted,
      projectNameGuess: guessProjectName(text, file.name),
      parseSucceeded: sorted.length > 0,
    }
  } catch (err) {
    // pdfjs failure (encrypted PDF, scanned-only, etc.) → fall back to the
    // manual-entry path with filename seed.
    console.warn('parsePdfFile failed', err)
    return {
      fileName: file.name,
      pageCount: 0,
      text: '',
      candidates: [],
      projectNameGuess: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '),
      parseSucceeded: false,
    }
  }
}

// Default role guess for a candidate. Used when populating dropdowns so the
// user's first click is usually accept-not-correct.
export function defaultRoleFor(c: ParsedCandidate): CandidateRole {
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
    default:
      return ['other']
  }
}
