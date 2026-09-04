// ============================================================================
// EstimatePresentationPdf — Built's premium estimate template
// ============================================================================
// A SECOND template, not a replacement. `EstimatePdf` is untouched and stays
// the default — it's what Bam and the B2B work go out on. This one exists
// because "we're sending out $600k estimates, it needs to look way better".
//
// ⛔ THE VISUAL SPEC IS `mockups/estimate-presentation-mockup.html` (v3). It
// survived two markup rounds with Andrew and the CUTS ARE LOAD-BEARING — do
// not reintroduce them:
//   · NO stats on the cover. They're a small dotted-rule row on the closing
//     page now.
//   · NO materials palette. Auto-aggregating materials across subs needs
//     curation nobody has done; each sub keeps its authored Material line.
//   · The cover's centrepiece is the PACKAGE INDEX — every subproject,
//     dot-leadered to its price, summing to the total. It has to read well at
//     1 subproject and at 20.
//
// SIZING: the mockup is a screen document 850px wide standing in for a letter
// page. Rather than hand-convert every number and lose the ability to diff
// against it, `mm()` scales mockup pixels to points by exactly 612/850. Every
// size below is therefore the mockup's own number, which is what makes "same
// size and spacing as the mockup" checkable rather than a matter of opinion.
//
// Fonts are vendored, not dependencies — see lib/estimate-fonts. If they're
// missing this renders in the built-ins rather than crashing.
// ============================================================================

import React from 'react'
import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import { parseRichDescription } from '@/lib/subproject-description'
import { pdfText } from '@/lib/pdf-text'
import { estimateFonts } from '@/lib/estimate-fonts'
import type { EstimatePdfLine, EstimateScheduleRow } from './EstimatePdf'

/** Mockup pixels → PDF points. The mockup is 850px wide for a 612pt page. */
const SCALE = 612 / 850
const mm = (px: number) => +(px * SCALE).toFixed(2)

const INK = '#17150F'
const MUT = '#7C776E'
const FAINT = '#9A958B'
const HAIR = '#C7C2B6'

export interface EstimateCoverStat {
  value: string
  label: string
}

export interface EstimatePresentationProps {
  estimateNumber: string
  estimateDate: string
  validUntil?: string | null
  org: {
    name: string
    logo_url?: string | null
    business_address?: string | null
    business_city?: string | null
    business_state?: string | null
    business_zip?: string | null
    business_phone?: string | null
    business_email?: string | null
  }
  project: { name: string } | null
  client: { name: string; address?: string | null; email?: string | null; phone?: string | null } | null
  lines: EstimatePdfLine[]
  schedule: EstimateScheduleRow[]
  totals: { subtotal: number; taxPct: number; taxAmount: number; total: number }
  terms?: string | null
  closingNote?: string | null
  /** The cover's editorial sentence. Generated at send time, editable, and
   *  persisted — so a regenerate reproduces what was actually sent. */
  headline?: string | null
  /** Closing-page stat row. Empty ⇒ the row is omitted entirely, which is the
   *  right answer for every shop that hasn't written any. */
  stats?: EstimateCoverStat[]
  /** Who signs the closing note. */
  signature?: string | null
}

/**
 * The cover sentence: "A custom millwork package for the Kennedy Residence."
 *
 * ⛔ The article is conditional on purpose. A household reads wrong without it
 * ("for Kennedy Residence") and a person reads wrong WITH it ("for the Patrick
 * Kennedy"), and Built's client records hold both. So it's added only for
 * names that are plainly a place or household, and never when the name already
 * begins with "The".
 */
export function estimateHeadlineFor(name: string): string {
  const n = (name || '').trim()
  if (!n) return 'A custom millwork package.'
  const needsArticle =
    !/^the\s/i.test(n) && /\b(residence|household|family|house|estate|home)\s*$/i.test(n)
  return `A custom millwork package for ${needsArticle ? 'the ' : ''}${n}.`
}

const money = (n: number) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Split a trailing plan reference off a subproject name.
 *
 * Built writes them into the name — "Kitchen Cabinets (Sheets: 1-11)" — and
 * the mockup shows the reference set apart from the title in its own muted
 * run. Pulled apart here so the headline stays a clean name.
 */
export function splitPlanRef(title: string): { name: string; planRef: string | null } {
  const m = /^(.*?)\s*\(\s*((?:sheets?|plans?|dwg|drawing)s?\b[^)]*)\)\s*$/i.exec(title.trim())
  if (!m) return { name: title.trim(), planRef: null }
  return { name: m[1].trim() || title.trim(), planRef: m[2].trim().replace(/\s+/g, ' ') }
}

interface ScopeDetail {
  text: string
  /** Spans both columns. See the note in toScopeBlock. */
  wide: boolean
}

interface ScopeBlock {
  name: string
  planRef: string | null
  amount: number
  material: string | null
  details: ScopeDetail[]
  excludes: string | null
  installIncluded: boolean
}

/** Generic containers — their label says nothing a reader needs. Real shop
 *  data puts a dozen lines under one "Details -", and prefixing every one of
 *  them printed "Details —" thirteen times down a page. */
const NOISE_LABELS = new Set(['details', 'description'])

/** A long line in a 50%-wide column leaves its neighbour stranded beside a
 *  wall of text. Anything past this spans the full width instead. */
const WIDE_DETAIL_CHARS = 110

/**
 * One estimate line → one presentation scope block.
 *
 * Parsed from the flattened description rather than passed structured, for the
 * same reason the standard template does it: estimates already sent re-render
 * from a stored flat snapshot, so anything that only worked on freshly
 * computed data would render those as one grey blob.
 *
 * ⛔ WHAT REAL DATA ACTUALLY LOOKS LIKE (checked against Kennedy EST-0017, not
 * assumed) — two things break the obvious implementation:
 *
 *   "Description - Material - Paint Grade Sheet Goods, Engineered Sheet Goods"
 *
 * The material is NESTED INSIDE the Description section, so there is no
 * section labelled "Material" to find. Reading `label === 'material'` finds
 * nothing and the material silently leaks into the detail grid carrying its
 * own "Material - " prefix. So we look for the prefix on the LINE, wherever it
 * sits.
 *
 *   "Details - Satin lacquer finish…"  followed by a dozen bare lines
 *
 * Everything after a "Details -" line is a CONTINUATION of that section, so a
 * kitchen arrives as one section holding thirteen lines. Prefixing each with
 * its label printed "Details —" thirteen times.
 */
export function toScopeBlock(li: EstimatePdfLine): ScopeBlock {
  const nl = li.description.indexOf('\n')
  const titleLine = nl >= 0 ? li.description.slice(0, nl) : li.description
  const body = nl >= 0 ? li.description.slice(nl + 1).replace(/^\n+/, '') : ''
  const { name, planRef } = splitPlanRef(titleLine)
  const sections = body ? parseRichDescription(body) : []

  let material: string | null = null
  let excludes: string | null = null
  let installIncluded = false
  const details: ScopeDetail[] = []

  const MATERIAL_LINE = /^material\s*[-–—:]\s*(.+)$/i

  for (const s of sections) {
    const label = (s.label || '').toLowerCase()
    if (label === 'exclusions') {
      excludes = s.lines.join(' · ') || null
      continue
    }
    if (!s.label && s.lines.some((l) => /includes installation/i.test(l))) {
      installIncluded = true
      continue
    }
    for (const raw of s.lines) {
      const line = raw.trim()
      if (!line) continue

      // The material can arrive as its own section OR nested in Description.
      const m = MATERIAL_LINE.exec(line)
      if ((label === 'material' || m) && !material) {
        material = (m ? m[1] : line).trim()
        continue
      }
      if (label === 'material') continue

      const showLabel = s.label && !NOISE_LABELS.has(label)
      const text = showLabel ? `${s.label} — ${line}` : line
      details.push({ text, wide: text.length > WIDE_DETAIL_CHARS })
    }
  }
  // Walk the two-column flow and widen a final item that would land alone in
  // the left column — otherwise its dotted rule stops halfway across the page
  // with nothing beside it, which reads as a rendering fault rather than a
  // grid. Wide items occupy a whole row, so they reset the column.
  let col = 0
  for (let i = 0; i < details.length; i++) {
    if (details[i].wide) {
      col = 0
      continue
    }
    if (i === details.length - 1 && col === 0) details[i].wide = true
    col = col === 0 ? 1 : 0
  }

  return { name, planRef, amount: Number(li.amount) || 0, material, details, excludes, installIncluded }
}

const f = estimateFonts()

const s = StyleSheet.create({
  page: {
    backgroundColor: '#FFFFFE',
    color: INK,
    fontFamily: f.sans,
    paddingTop: mm(88),
    paddingBottom: mm(64),
    paddingHorizontal: mm(96),
    fontSize: mm(13),
  },
  // ── run header / footer ──
  runhead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    // ⛔ The mockup says 84px here and 84px above the index. Those are SCREEN
    // numbers — the mockup is `min-height:1080px`, so it just grew when the
    // content didn't fit. A letter page can't grow: at the mockup's spacing a
    // 12-subproject cover overflowed and left "Prepared for" alone on a second
    // sheet. Tightened until Williams (the largest real package) fits one page.
    marginBottom: mm(40),
  },
  runheadBrand: {
    fontFamily: f.sans,
    fontWeight: 600,
    fontSize: mm(10),
    letterSpacing: mm(10) * 0.24,
    color: INK,
  },
  runheadRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'baseline' },
  runheadMeta: {
    fontSize: mm(10),
    fontWeight: 500,
    letterSpacing: mm(10) * 0.16,
    color: FAINT,
  },
  runheadSep: { color: '#D6D1C6', marginHorizontal: mm(6), fontSize: mm(10) },
  // Absolutely positioned + `fixed` so it prints on EVERY page. As a normal
  // flow element it rendered once, at the end of each <Page>'s content — so a
  // scope section that spilled across three sheets carried the address on the
  // last one only.
  runfoot: {
    position: 'absolute',
    bottom: mm(34),
    left: mm(96),
    right: mm(96),
    flexDirection: 'row',
    fontSize: mm(10),
    letterSpacing: mm(10) * 0.1,
    color: '#B4AFA4',
  },
  kicker: {
    fontSize: mm(10),
    fontWeight: 500,
    letterSpacing: mm(10) * 0.22,
    color: FAINT,
    textTransform: 'uppercase',
  },
  // ── cover ──
  h1: {
    fontFamily: f.serif,
    fontWeight: 300,
    fontSize: mm(32),
    lineHeight: 1.22,
    marginTop: mm(18),
    maxWidth: mm(560),
  },
  totalline: { flexDirection: 'row', alignItems: 'baseline', marginTop: mm(26) },
  totallineLabel: {
    fontSize: mm(11),
    fontWeight: 600,
    letterSpacing: mm(11) * 0.16,
    textTransform: 'uppercase',
  },
  totallineAmt: { fontFamily: f.mono, fontSize: mm(17), marginLeft: mm(14) },
  index: { marginTop: mm(26) },
  idxrow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: mm(12),
    // overridden per-row when the package is long — see `idxPad`

    borderBottomWidth: 1,
    borderBottomStyle: 'dotted',
    borderBottomColor: HAIR,
  },
  // Same fixed-split reasoning as scopeHead — the index carries the same long
  // names ("Powder 1 & 2 · Bunk · …") next to the same right-aligned prices.
  idxName: { width: '78%', fontSize: mm(13), paddingRight: mm(16) },
  idxAmt: { width: '22%', fontFamily: f.mono, fontSize: mm(12.5), textAlign: 'right' },
  idxSumRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingTop: mm(16),
  },
  idxSumName: {
    width: '78%',
    fontSize: mm(12),
    fontWeight: 600,
    letterSpacing: mm(12) * 0.16,
    textTransform: 'uppercase',
  },
  idxSumAmt: { width: '22%', fontFamily: f.mono, fontSize: mm(14.5), textAlign: 'right' },
  prepared: { paddingTop: mm(24) },
  preparedGrid: { flexDirection: 'row', marginTop: mm(18) },
  preparedCell: { width: '33.33%', paddingRight: mm(40) },
  preparedName: { fontSize: mm(14) },
  preparedSub: { fontSize: mm(12), color: MUT, marginTop: mm(5) },
  // ── scope pages ──
  scopeSec: { marginBottom: mm(30) },
  scopeHead: { flexDirection: 'row', alignItems: 'baseline', marginTop: mm(16) },
  // ⛔ EXPLICIT WIDTHS, not flexShrink. The real title "Powder 1 & 2 · Bunk ·
  // Caydon · Dallas · Emery · Finley · Pool Bath vanities" printed straight
  // THROUGH its own $34,872. Neither flexShrink on the Text nor on a wrapping
  // View fixed it — react-pdf measures the Text at its full content width and
  // overlaps the sibling rather than wrapping. A fixed split is the only
  // version that can't collide, at any name length.
  scopeNameBox: { width: '68%', paddingRight: mm(16) },
  scopeName: { fontFamily: f.serif, fontWeight: 400, fontSize: mm(21) },
  scopeRight: { width: '32%', alignItems: 'flex-end' },
  scopeRightTop: { flexDirection: 'row', alignItems: 'baseline' },
  installNote: { fontSize: mm(9.5), color: MUT, marginTop: mm(3) },
  scopePlan: { fontSize: mm(11.5), color: MUT, paddingRight: mm(12) },
  scopeAmt: { fontFamily: f.mono, fontSize: mm(14.5) },
  matline: { fontSize: mm(12), color: MUT, marginTop: mm(8) },
  details: { flexDirection: 'row', flexWrap: 'wrap', marginTop: mm(10) },
  detailCell: {
    width: '50%',
    paddingRight: mm(32),
    paddingVertical: mm(7),
    borderBottomWidth: 1,
    borderBottomStyle: 'dotted',
    borderBottomColor: HAIR,
  },
  detailText: { fontSize: mm(12.5), lineHeight: 1.55 },
  subfoot: { flexDirection: 'row', marginTop: mm(12), fontSize: mm(11), color: MUT },
  // ── numbers ──
  bigtotal: { fontFamily: f.mono, fontSize: mm(36), marginTop: mm(18) },
  schedule: { marginTop: mm(40) },
  schedrow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingVertical: mm(14),
    borderBottomWidth: 1,
    borderBottomStyle: 'dotted',
    borderBottomColor: HAIR,
  },
  schedPct: { fontFamily: f.mono, fontSize: mm(13), width: mm(58) },
  schedLabel: { fontSize: mm(13), fontWeight: 600 },
  schedTrigger: { fontSize: mm(11.5), color: MUT, marginTop: mm(2) },
  schedAmt: { fontFamily: f.mono, fontSize: mm(13), marginLeft: 'auto' },
  terms: { marginTop: mm(40) },
  termsText: { fontSize: mm(11.5), lineHeight: 1.75, color: MUT, marginTop: mm(12) },
  thanks: { marginTop: mm(44) },
  thanksText: {
    fontFamily: f.serif,
    fontWeight: 300,
    fontStyle: 'italic',
    fontSize: mm(16),
    lineHeight: 1.6,
    marginTop: mm(16),
    maxWidth: mm(480),
  },
  sig: {
    fontSize: mm(11),
    fontWeight: 600,
    letterSpacing: mm(11) * 0.16,
    textTransform: 'uppercase',
    marginTop: mm(14),
  },
  ministats: {
    flexDirection: 'row',
    marginTop: mm(28),
    paddingTop: mm(18),
    borderTopWidth: 1,
    borderTopStyle: 'dotted',
    borderTopColor: HAIR,
  },
  ministat: { marginRight: mm(44) },
  ministatV: { fontFamily: f.mono, fontSize: mm(15) },
  ministatL: {
    fontSize: mm(10),
    letterSpacing: mm(10) * 0.14,
    textTransform: 'uppercase',
    color: FAINT,
    marginTop: mm(4),
  },
  accept: { flexDirection: 'row', paddingTop: mm(36) },
  acceptBox: {
    width: '50%',
    marginRight: mm(64),
    borderTopWidth: 1,
    borderTopColor: INK,
    paddingTop: mm(10),
    fontSize: mm(10),
    fontWeight: 500,
    letterSpacing: mm(10) * 0.2,
    textTransform: 'uppercase',
    color: FAINT,
  },
  spacer: { flexGrow: 1 },
})

function RunHead({ brand, num, right }: { brand: string; num: string; right: string }) {
  return (
    <View style={s.runhead} fixed>
      <Text style={s.runheadBrand}>{pdfText(brand.toUpperCase())}</Text>
      <View style={s.runheadRight}>
        <Text style={s.runheadMeta}>{pdfText(num)}</Text>
        <Text style={s.runheadSep}>/</Text>
        <Text style={s.runheadMeta}>{pdfText(right)}</Text>
      </View>
    </View>
  )
}

function RunFoot({ left, right }: { left: string; right: string }) {
  return (
    <View style={s.runfoot} fixed>
      <Text>{pdfText(left)}</Text>
      <Text style={{ marginLeft: 'auto' }}>{pdfText(right)}</Text>
    </View>
  )
}

export function EstimatePresentationPdf(props: EstimatePresentationProps) {
  const {
    estimateNumber,
    estimateDate,
    validUntil,
    org,
    project,
    client,
    lines,
    schedule,
    totals,
    terms,
    closingNote,
    headline,
    stats,
    signature,
  } = props

  const blocks = lines.map(toScopeBlock)
  const projectName = project?.name || 'Project'
  const addressLine = [
    org.business_address,
    [org.business_city, org.business_state].filter(Boolean).join(', '),
    org.business_zip,
  ]
    .filter(Boolean)
    .join(', ')
  const footRight = org.business_email || org.business_phone || ''
  const indexSum = blocks.reduce((n, b) => n + b.amount, 0)
  // The index sums the lines; the total is what the estimate says. They agree
  // in every normal case — but tax makes them legitimately differ, so the sum
  // row shows the LINE sum and the closing page shows the real total rather
  // than quietly printing one number twice.
  const coverTotal = totals.total || indexSum
  const cleanStats = (stats || []).filter((x) => x && String(x.value).trim() && String(x.label).trim())

  // The index has to read well at 1 subproject and at 20 (Andrew's brief), and
  // a letter page is fixed. Beyond a dozen rows the generous padding is what
  // breaks it, so density steps down rather than the page overflowing. Past
  // ~18 the index legitimately continues onto a second sheet, which reads far
  // better than a squeezed one.
  // Measured against real packages, not guessed: Kennedy has 20 subprojects
  // and at the previous values the sum row and "Prepared for" were pushed onto
  // a second, near-empty sheet.
  const idxPad = blocks.length > 16 ? mm(3) : blocks.length > 11 ? mm(7) : mm(12)

  // How many scope blocks fit before a page break is react-pdf's problem, not
  // ours — each block is wrap={false} so a subproject never splits across a
  // page mid-detail, and the page flows the rest.
  return (
    <Document>
      {/* ── 1 · COVER ── */}
      <Page size="LETTER" style={s.page}>
        <RunHead brand={org.name} num={estimateNumber} right={projectName} />

        {/* ⛔ No logo image on the cover. The mockup deliberately doesn't have
            one — the run header's wordmark IS the branding — and dropping an
            org logo in above the kicker rendered as a stray centred mark that
            fought the headline. It also cost ~26pt of the vertical budget the
            package index needs at 20 subprojects. */}

        <Text style={s.kicker}>
          {pdfText(
            [
              `Estimate ${estimateNumber}`,
              fmtDate(estimateDate),
              validUntil ? `Valid until ${fmtDate(validUntil)}` : 'Valid 30 days',
            ]
              .filter(Boolean)
              .join('  ·  '),
          )}
        </Text>

        <Text style={s.h1}>
          {pdfText(headline || estimateHeadlineFor(client?.name || projectName))}
        </Text>

        <View style={s.totalline}>
          <Text style={s.totallineLabel}>Estimate total</Text>
          <Text style={s.totallineAmt}>{money(coverTotal)}</Text>
        </View>

        <View style={s.index}>
          <Text style={[s.kicker, { marginBottom: mm(10) }]}>
            {pdfText(`The package · ${blocks.length} ${blocks.length === 1 ? 'space' : 'spaces'}`)}
          </Text>
          {blocks.map((b, i) => (
            <View key={i} style={[s.idxrow, { paddingVertical: idxPad }]} wrap={false}>
              <Text style={s.idxName}>{pdfText(b.name)}</Text>
              <Text style={s.idxAmt}>{money(b.amount)}</Text>
            </View>
          ))}
          <View style={s.idxSumRow}>
            <Text style={s.idxSumName}>Estimate total</Text>
            <Text style={s.idxSumAmt}>{money(indexSum)}</Text>
          </View>
        </View>

        <View style={s.spacer} />

        {/* wrap={false}: at 20 subprojects the third cell's address split
            across the page break, leaving two lines alone on a blank sheet.
            If it ever can't fit it now moves whole rather than tearing. */}
        <View style={s.prepared} wrap={false}>
          <Text style={s.kicker}>Prepared for</Text>
          <View style={s.preparedGrid}>
            <View style={s.preparedCell}>
              <Text style={s.preparedName}>{pdfText(client?.name || '—')}</Text>
              <Text style={s.preparedSub}>Client</Text>
            </View>
            <View style={s.preparedCell}>
              <Text style={s.preparedName}>{pdfText(projectName)}</Text>
              <Text style={s.preparedSub}>Project</Text>
            </View>
            <View style={s.preparedCell}>
              <Text style={s.preparedName}>{pdfText(org.name)}</Text>
              <Text style={s.preparedSub}>
                {pdfText([addressLine, org.business_phone].filter(Boolean).join(' · '))}
              </Text>
            </View>
          </View>
        </View>

        <RunFoot left={addressLine} right={footRight} />
      </Page>

      {/* ── 2 · THE WORK ── */}
      <Page size="LETTER" style={s.page}>
        {/* No "The work" label — Andrew's call. It appeared twice (kicker and
            run header) and named something the reader can already see. */}
        <RunHead brand={org.name} num={estimateNumber} right={projectName} />

        {blocks.map((b, i) => (
          // ⛔ The SECTION must be allowed to wrap. With wrap={false} on the
          // whole block, a subproject that didn't fit in the remaining space
          // moved to the next page entire — and since a real block runs most
          // of a page, that meant ONE SUBPROJECT PER PAGE with ~40% of every
          // sheet left blank. Kennedy came out at 22 pages.
          //
          // Only the HEADER is held together (title + price + material line),
          // with minPresenceAhead so it can't be stranded at the foot of a
          // page with its details overleaf. The detail grid flows freely.
          <View key={i} style={s.scopeSec}>
            <View wrap={false} minPresenceAhead={mm(35)}>
              <View style={s.scopeHead}>
                <View style={s.scopeNameBox}>
                  <Text style={s.scopeName}>{pdfText(b.name)}</Text>
                </View>
                <View style={s.scopeRight}>
                  <View style={s.scopeRightTop}>
                    {b.planRef ? <Text style={s.scopePlan}>{pdfText(b.planRef)}</Text> : null}
                    <Text style={s.scopeAmt}>{money(b.amount)}</Text>
                  </View>
                  {/* Andrew's call: it belongs with the price, not stranded at
                      the foot of the block — it qualifies what the number buys. */}
                  {b.installIncluded ? (
                    <Text style={s.installNote}>Installation included</Text>
                  ) : null}
                </View>
              </View>
              {b.material ? <Text style={s.matline}>{pdfText(b.material)}</Text> : null}
            </View>
            {b.details.length > 0 && (
              <View style={s.details}>
                {b.details.map((d, di) => (
                  <View
                    key={di}
                    style={[
                      s.detailCell,
                      // Full width for a lone detail (a half-width dotted rule
                      // hanging in white space reads as broken) and for a very
                      // long one (which would otherwise strand its neighbour
                      // beside a wall of text).
                      b.details.length === 1 || d.wide
                        ? { width: '100%', paddingRight: 0 }
                        : {},
                    ]}
                  >
                    <Text style={s.detailText}>{pdfText(d.text)}</Text>
                  </View>
                ))}
              </View>
            )}
            {b.excludes ? (
              <View style={s.subfoot}>
                <Text>{pdfText(`Excludes: ${b.excludes}`)}</Text>
              </View>
            ) : null}
          </View>
        ))}

        <RunFoot left={addressLine} right={footRight} />
      </Page>

      {/* ── 3 · THE NUMBERS ── */}
      <Page size="LETTER" style={s.page}>
        <RunHead brand={org.name} num={estimateNumber} right="The numbers" />
        <Text style={s.kicker}>The numbers</Text>
        <Text style={s.bigtotal}>{money(totals.total || indexSum)}</Text>

        {schedule.length > 0 && (
          <View style={s.schedule}>
            <Text style={[s.kicker, { marginBottom: mm(6) }]}>Payment schedule</Text>
            {schedule.map((r, i) => (
              <View
                key={i}
                style={[s.schedrow, i === schedule.length - 1 ? { borderBottomWidth: 0 } : {}]}
                wrap={false}
              >
                <Text style={s.schedPct}>{`${Math.round(Number(r.pct) || 0)}%`}</Text>
                <View style={{ flexShrink: 1 }}>
                  <Text style={s.schedLabel}>{pdfText(r.label)}</Text>
                  {r.trigger ? <Text style={s.schedTrigger}>{pdfText(r.trigger)}</Text> : null}
                </View>
                <Text style={s.schedAmt}>{money(r.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {terms ? (
          <View style={s.terms}>
            <Text style={s.kicker}>Terms</Text>
            <Text style={s.termsText}>{pdfText(terms)}</Text>
          </View>
        ) : null}

        {closingNote ? (
          <View style={s.thanks}>
            <Text style={s.kicker}>From the shop</Text>
            {/* ⛔ Split on the shop's own line breaks and space the paragraphs.
                As one Text the stored note's newlines rendered at the body
                line-height, so a new sentence began flush against the wrapped
                tail of the previous one and the block read as a mistake.
                A trailing "- Andrew" line becomes the signature, since that's
                what it is — the design has a styled sign-off for it. */}
            {(() => {
              const paras = closingNote
                .split(/\r?\n/)
                .map((x) => x.trim())
                .filter(Boolean)
              const last = paras[paras.length - 1]
              const inlineSig = paras.length > 1 && /^[-–—]\s*\S/.test(last || '')
              const body = inlineSig ? paras.slice(0, -1) : paras
              const sigText = inlineSig
                ? (last || '').replace(/^[-–—]\s*/, '')
                : signature || null
              return (
                <>
                  {body.map((para, pi) => (
                    <Text key={pi} style={[s.thanksText, pi > 0 ? { marginTop: mm(10) } : {}]}>
                      {pdfText(para)}
                    </Text>
                  ))}
                  {sigText ? <Text style={s.sig}>{pdfText(`— ${sigText}`)}</Text> : null}
                </>
              )
            })()}
            {cleanStats.length > 0 && (
              <View style={s.ministats}>
                {cleanStats.map((st, i) => (
                  <View key={i} style={s.ministat}>
                    <Text style={s.ministatV}>{pdfText(st.value)}</Text>
                    <Text style={s.ministatL}>{pdfText(st.label)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : cleanStats.length > 0 ? (
          <View style={s.ministats}>
            {cleanStats.map((st, i) => (
              <View key={i} style={s.ministat}>
                <Text style={s.ministatV}>{pdfText(st.value)}</Text>
                <Text style={s.ministatL}>{pdfText(st.label)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* ⛔ NO flexGrow spacer here. Pushing the acceptance block to the
            bottom overflowed the page and left the signature lines alone on a
            final sheet — a floating signature page on a document whose whole
            job is to look considered. It flows after the content instead. */}
        <View style={s.accept}>
          <Text style={s.acceptBox}>Accepted · Client</Text>
          <Text style={[s.acceptBox, { marginRight: 0 }]}>{pdfText(`Authorized · ${org.name}`)}</Text>
        </View>

        <RunFoot left={addressLine} right={footRight} />
      </Page>
    </Document>
  )
}

export default EstimatePresentationPdf
