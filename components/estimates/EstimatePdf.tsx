// ============================================================================
// EstimatePdf — react-pdf rendering for client-facing project estimates
// ============================================================================
// Cloned from components/invoices/InvoicePdf.tsx and adapted for estimates:
// "ESTIMATE" label, a payment-schedule block (from the project's milestones,
// display-only), and a terms block. No "Received / Balance due" (that's invoice
// only). Pure presentational — renders server-side via renderToBuffer
// (app/api/estimates/[projectId]/pdf) and client-side via <PDFViewer>.
//
// Amounts are whole-dollar (matches the on-screen estimate / project price so
// the PDF total reconciles with what the operator sees).
// ============================================================================

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { parseRichDescription } from '@/lib/subproject-description'
import { pdfText } from '@/lib/pdf-text'
// The standard document system (palette, type scale, org header) lives in one
// place so the estimate and the change order can't drift apart again.
import { DOC, OrgHeader, TYPE, docStyles } from '@/components/pdf/standard-doc'
export { pdfLogoOk } from '@/components/pdf/standard-doc'

export interface EstimatePdfLine {
  description: string
  quantity: number
  unit?: string | null
  unit_price: number
  amount: number
}

export interface EstimateScheduleRow {
  label: string
  pct: number
  trigger?: string | null
  amount: number
}

export interface EstimatePdfProps {
  estimateNumber: string
  estimateDate: string // ISO (yyyy-mm-dd)
  validUntil?: string | null // ISO
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
  client: {
    name: string
    address?: string | null
    email?: string | null
    phone?: string | null
  } | null
  lines: EstimatePdfLine[]
  /** Payment milestones, display-only (the terms block). */
  schedule: EstimateScheduleRow[]
  totals: { subtotal: number; taxPct: number; taxAmount: number; total: number }
  terms?: string | null
  /** Per-org sign-off, rendered as the final "Thank you" section (091).
   *  Deliberately not hardcoded — the copy is the shop's own, and every org
   *  on the platform has its own story to tell. Empty/null → no section. */
  closingNote?: string | null
}

const COLORS = {
  ink: DOC.ink,
  fg: DOC.fg,
  dim: DOC.dim,
  hairline: DOC.hairline,
  rule: DOC.rule,
  bandBg: '#F9FAFB',
}

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 48,
    fontSize: 10.5,
    color: COLORS.ink,
    fontFamily: 'Helvetica',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  // Org block (logo / name / contact lines) is the shared OrgHeader.
  docLabel: { fontSize: TYPE.docLabel, fontFamily: 'Helvetica-Bold', letterSpacing: 3, textAlign: 'right', marginBottom: 4 },
  docNumber: { fontSize: 11, fontFamily: 'Helvetica', color: COLORS.ink, textAlign: 'right', marginBottom: 6 },
  docMeta: { fontSize: TYPE.body, color: COLORS.fg, textAlign: 'right', lineHeight: 1.45 },

  twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  colHalf: { width: '48%' },
  smallLabel: { ...docStyles.label, marginBottom: 5 },
  blockBody: { fontSize: TYPE.itemTitle, lineHeight: 1.45, color: COLORS.ink },
  blockMeta: docStyles.body,
  blockBold: { fontFamily: 'Helvetica-Bold' },

  tableRule: { borderTopWidth: 1, borderTopColor: COLORS.rule, marginBottom: 4 },
  tableHeaderRow: { flexDirection: 'row', paddingTop: 4, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: COLORS.hairline },
  // ⛔ The space BETWEEN items (10 + 10 around the hairline) is deliberately
  // bigger than the gaps WITHIN one (a blank line), so each line item reads as
  // one unit. They used to be the other way round, which is most of why the
  // body read messy.
  tableRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: COLORS.hairline },
  // flexShrink:0 on the numeric cells + flexBasis:0 on desc locks the columns
  // so the header and every row line up even when a description wraps long.
  cellDesc: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
  cellQty: { width: 48, flexShrink: 0, textAlign: 'right', paddingRight: 6 },
  cellUnit: { width: 48, flexShrink: 0, textAlign: 'right', paddingRight: 6 },
  cellRate: { width: 70, flexShrink: 0, textAlign: 'right', paddingRight: 6 },
  cellAmount: { width: 78, flexShrink: 0, textAlign: 'right' },
  headerText: docStyles.label,
  // ⛔ NO lineHeight on the description cell. In react-pdf it applies to EVERY
  // line of the cell — the blank section-break lines too — so it inflated the
  // gaps inside an item until they matched the gaps between items (rendered
  // and measured 2026-10-22). The section rhythm below (label tight to its
  // body, one blank line between sections) was already right.
  bodyText: { fontSize: TYPE.itemTitle, color: COLORS.ink },
  // Scope sections inside the description cell. These are inline styles on
  // nested <Text> runs, not blocks — the cell has to stay ONE <Text> (see the
  // comment at the row), so spacing comes from newlines rather than margins.
  scopeLabel: { ...docStyles.label, textTransform: 'none' },
  scopeBody: { fontSize: TYPE.body, color: COLORS.fg },
  // Numbers: Helvetica (equal-width digits), not Courier — see standard-doc.
  monoRight: { fontSize: TYPE.number, fontFamily: 'Helvetica', color: COLORS.ink, textAlign: 'right' },

  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totalsCol: { width: 220 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalsRowBold: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsLabel: { fontSize: TYPE.body, color: COLORS.fg },
  totalsLabelBold: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  totalsValue: { fontSize: TYPE.number, fontFamily: 'Helvetica', color: COLORS.ink },
  totalsValueBold: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  totalsRule: { borderTopWidth: 1, borderTopColor: COLORS.rule, marginVertical: 3 },

  // Payment schedule block.
  section: { marginTop: 28 },
  scheduleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairline,
  },
  scheduleLabel: { fontSize: TYPE.number, color: COLORS.ink },
  scheduleTrigger: { fontSize: TYPE.body, color: COLORS.fg },
  scheduleAmount: { fontSize: TYPE.number, fontFamily: 'Helvetica', color: COLORS.ink, textAlign: 'right' },

  notesBlock: { marginTop: 28, paddingTop: 14, borderTopWidth: 0.5, borderTopColor: COLORS.hairline },
  notesText: { ...docStyles.body, lineHeight: 1.5 },
})

function money(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('en-US')
}

/**
 * The RATE cell. `amount` is authoritative — it's what keeps the estimate
 * total equal to the project total — and the rate is DERIVED from it
 * (amount ÷ qty), never the other way round. Keep that direction.
 *
 *   Rates print to the cent, always — "$2,524.17", and "$4,200.00" on a
 *   single item — so the Rate column's digits line up (it used to mix "$2,524"
 *   with "$1,293.25").
 *
 *   ⛔ Some divisions can't reconcile exactly: $17,336 over 7 is $2,476.57…,
 *   which multiplies back to $17,335.99. We print the rounded rate PLAIN and
 *   accept the universal invoice convention that unit rates round (Andrew,
 *   2026-10-22). It used to print "—" (read as flaky), then "~$2,476.57" —
 *   which in a table reads as a MINUS sign, and was dropped. If a marker ever
 *   comes back: not "≈", which renders as "H" in these fonts (lib/pdf-text).
 */
function rateCell(unitPrice: number, quantity: number, amount: number): string {
  const q = Number(quantity) || 1
  const a = Number(amount) || 0
  const rate = q > 1 && a > 0 ? a / q : Number(unitPrice) || 0
  const cents = Math.round(rate * 100) / 100
  return '$' + cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00Z')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function EstimatePdf({
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
}: EstimatePdfProps) {
  const cityLine = [org.business_city, org.business_state, org.business_zip]
    .filter(Boolean)
    .join(org.business_state ? ', ' : ' ')

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <OrgHeader
            org={org}
            addressLines={[org.business_address, cityLine, org.business_phone, org.business_email]}
          />
          <View>
            <Text style={styles.docLabel}>ESTIMATE</Text>
            <Text style={styles.docNumber}>{pdfText(estimateNumber)}</Text>
            <Text style={styles.docMeta}>Date: {fmtDate(estimateDate)}</Text>
            {validUntil ? <Text style={styles.docMeta}>Valid until: {fmtDate(validUntil)}</Text> : null}
          </View>
        </View>

        {/* Prepared for / Project */}
        <View style={styles.twoCol}>
          <View style={styles.colHalf}>
            <Text style={styles.smallLabel}>Prepared for</Text>
            {client ? (
              <View>
                <Text style={[styles.blockBody, styles.blockBold]}>{pdfText(client.name)}</Text>
                {client.address ? <Text style={styles.blockMeta}>{pdfText(client.address)}</Text> : null}
                {client.email ? <Text style={styles.blockMeta}>{pdfText(client.email)}</Text> : null}
                {client.phone ? <Text style={styles.blockMeta}>{pdfText(client.phone)}</Text> : null}
              </View>
            ) : (
              <Text style={styles.blockMeta}>—</Text>
            )}
          </View>
          <View style={styles.colHalf}>
            <Text style={styles.smallLabel}>Project</Text>
            <Text style={[styles.blockBody, styles.blockBold]}>{pdfText(project?.name) || '—'}</Text>
          </View>
        </View>

        {/* Line items */}
        <View style={styles.tableRule} />
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.headerText, styles.cellDesc]}>Description</Text>
          <Text style={[styles.headerText, styles.cellQty]}>Qty</Text>
          <Text style={[styles.headerText, styles.cellUnit]}>Unit</Text>
          <Text style={[styles.headerText, styles.cellRate]}>Rate</Text>
          <Text style={[styles.headerText, styles.cellAmount]}>Amount</Text>
        </View>
        {lines.map((li, i) => {
          // Split the first line (subproject name) off so we can bold it and
          // put a gap before the description body — easier to scan.
          const nl = li.description.indexOf('\n')
          const titleLine = nl >= 0 ? li.description.slice(0, nl) : li.description
          const bodyLines = nl >= 0 ? li.description.slice(nl + 1).replace(/^\n+/, '') : ''
          // Re-read the flattened scope as labelled sections. Parsed rather
          // than passed structured, so estimates already sent (which re-render
          // from the stored flat snapshot) get the readable layout too — see
          // parseRichDescription. Unrecognised text comes back as one
          // unlabelled block, i.e. exactly what used to render.
          const sections = bodyLines ? parseRichDescription(bodyLines) : []
          return (
          <View key={i} style={styles.tableRow} wrap={false}>
            {/* Single Text (not a nested View) so react-pdf sizes the row
                height correctly — a View here made rows overlap. Everything
                below is nested <Text> runs for the same reason: section
                spacing is newlines, NOT margins. Don't "improve" this into
                Views without re-checking row overlap on a multi-line item. */}
            <Text style={[styles.bodyText, styles.cellDesc]}>
              <Text style={styles.blockBold}>{pdfText(titleLine)}</Text>
              {sections.map((s, si) => (
                <Text key={si}>
                  {'\n\n'}
                  {s.label ? (
                    <Text style={styles.scopeLabel}>{s.label.toUpperCase() + '\n'}</Text>
                  ) : null}
                  <Text style={styles.scopeBody}>
                    {s.bullets
                      ? s.lines.map((l) => `—  ${pdfText(l)}`).join('\n')
                      : s.lines.map(pdfText).join('\n')}
                  </Text>
                </Text>
              ))}
            </Text>
            <Text style={[styles.monoRight, styles.cellQty]}>{li.quantity}</Text>
            {/* A quantity line is N of something: "ea" unless the line says
                otherwise. Applied here, not in the payload, so re-rendered
                snapshots of already-sent estimates get it too. */}
            <Text style={[styles.bodyText, styles.cellUnit, { textAlign: 'right' }]}>
              {li.unit ?? ((Number(li.quantity) || 1) > 1 ? 'ea' : '—')}
            </Text>
            <Text style={[styles.monoRight, styles.cellRate]}>
              {rateCell(li.unit_price, li.quantity, li.amount)}
            </Text>
            <Text style={[styles.monoRight, styles.cellAmount]}>
              {money(li.amount > 0 ? li.amount : li.quantity * li.unit_price)}
            </Text>
          </View>
          )
        })}

        {/* Totals */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsCol}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{money(totals.subtotal)}</Text>
            </View>
            {totals.taxPct > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabel}>Tax ({totals.taxPct}%)</Text>
                <Text style={styles.totalsValue}>{money(totals.taxAmount)}</Text>
              </View>
            ) : null}
            <View style={styles.totalsRule} />
            <View style={styles.totalsRowBold}>
              <Text style={styles.totalsLabelBold}>Estimate total</Text>
              <Text style={styles.totalsValueBold}>{money(totals.total)}</Text>
            </View>
          </View>
        </View>

        {/* Payment schedule (milestones — display only) */}
        {schedule.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.smallLabel}>Payment schedule</Text>
            {schedule.map((m, i) => (
              <View key={i} style={styles.scheduleRow} wrap={false}>
                <View>
                  <Text style={styles.scheduleLabel}>
                    {pdfText(m.label)} ({m.pct.toFixed(0)}%)
                  </Text>
                  {m.trigger ? <Text style={styles.scheduleTrigger}>{pdfText(m.trigger)}</Text> : null}
                </View>
                <Text style={styles.scheduleAmount}>{money(m.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Terms. Titled to match Payment schedule above — the tail of the
            PDF is three consistently-headed sections, not one headed block
            followed by two anonymous ones. */}
        {terms ? (
          <View style={styles.notesBlock}>
            <Text style={styles.smallLabel}>Terms</Text>
            <Text style={styles.notesText}>{pdfText(terms)}</Text>
          </View>
        ) : null}

        {/* Thank you — the org's own sign-off (091). Last thing on the page. */}
        {closingNote && closingNote.trim() ? (
          <View style={styles.notesBlock}>
            <Text style={styles.smallLabel}>Thank you</Text>
            <Text style={styles.notesText}>{pdfText(closingNote)}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
