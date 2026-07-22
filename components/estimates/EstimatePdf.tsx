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

import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

/** react-pdf <Image> renders raster only (no SVG) — show the logo when it's a
 *  PNG/JPG/etc., otherwise fall back to the org name text. */
export function pdfLogoOk(url: string | null | undefined): url is string {
  return !!url && !/\.svg(\?|$)/i.test(url)
}

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
}

const COLORS = {
  ink: '#111111',
  fg: '#374151',
  meta: '#6B7280',
  dim: '#9CA3AF',
  hairline: '#E5E7EB',
  rule: '#111111',
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
  // Logo scaled to roughly the doc-label height; explicit height so react-pdf
  // reserves space (no header overlap). width auto-scales by aspect ratio.
  logo: { height: 26, marginBottom: 10, objectFit: 'contain' },
  orgName: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: COLORS.ink, marginBottom: 4 },
  orgLine: { fontSize: 9.5, color: COLORS.meta, lineHeight: 1.4 },
  docLabel: { fontSize: 22, fontFamily: 'Helvetica-Bold', letterSpacing: 3, textAlign: 'right', marginBottom: 4 },
  docNumber: { fontSize: 11, fontFamily: 'Helvetica', color: COLORS.fg, textAlign: 'right', marginBottom: 8 },
  docMeta: { fontSize: 9.5, color: COLORS.meta, textAlign: 'right' },

  twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  colHalf: { width: '48%' },
  smallLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dim,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  blockBody: { fontSize: 10.5, lineHeight: 1.45, color: COLORS.ink },
  blockMeta: { fontSize: 9.5, lineHeight: 1.4, color: COLORS.meta },
  blockBold: { fontFamily: 'Helvetica-Bold' },

  tableRule: { borderTopWidth: 1, borderTopColor: COLORS.rule, marginBottom: 4 },
  tableHeaderRow: { flexDirection: 'row', paddingTop: 4, paddingBottom: 6 },
  tableRow: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: COLORS.hairline },
  // flexShrink:0 on the numeric cells + flexBasis:0 on desc locks the columns
  // so the header and every row line up even when a description wraps long.
  cellDesc: { flexGrow: 1, flexShrink: 1, flexBasis: 0, paddingRight: 8 },
  cellQty: { width: 48, flexShrink: 0, textAlign: 'right', paddingRight: 6 },
  cellUnit: { width: 48, flexShrink: 0, textAlign: 'right', paddingRight: 6 },
  cellRate: { width: 70, flexShrink: 0, textAlign: 'right', paddingRight: 6 },
  cellAmount: { width: 78, flexShrink: 0, textAlign: 'right' },
  headerText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dim,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  bodyText: { fontSize: 10.5, color: COLORS.ink },
  monoRight: { fontSize: 10.5, fontFamily: 'Courier', color: COLORS.ink, textAlign: 'right' },

  totalsWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totalsCol: { width: 220 },
  totalsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  totalsRowBold: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalsLabel: { fontSize: 10.5, color: COLORS.fg },
  totalsLabelBold: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: COLORS.ink },
  totalsValue: { fontSize: 10.5, fontFamily: 'Courier', color: COLORS.ink },
  totalsValueBold: { fontSize: 11, fontFamily: 'Courier-Bold', color: COLORS.ink },
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
  scheduleLabel: { fontSize: 10, color: COLORS.ink },
  scheduleTrigger: { fontSize: 9, color: COLORS.dim },
  scheduleAmount: { fontSize: 10, fontFamily: 'Courier', color: COLORS.ink, textAlign: 'right' },

  notesBlock: { marginTop: 28, paddingTop: 14, borderTopWidth: 0.5, borderTopColor: COLORS.hairline },
  notesText: { fontSize: 9.5, color: COLORS.fg, lineHeight: 1.5 },
})

function money(n: number): string {
  return '$' + Math.round(n || 0).toLocaleString('en-US')
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
}: EstimatePdfProps) {
  const cityLine = [org.business_city, org.business_state, org.business_zip]
    .filter(Boolean)
    .join(org.business_state ? ', ' : ' ')

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            {pdfLogoOk(org.logo_url) ? (
              <Image src={org.logo_url} style={styles.logo} />
            ) : null}
            <Text style={styles.orgName}>{org.name || 'Your Company'}</Text>
            {org.business_address ? <Text style={styles.orgLine}>{org.business_address}</Text> : null}
            {cityLine ? <Text style={styles.orgLine}>{cityLine}</Text> : null}
            {org.business_phone ? <Text style={styles.orgLine}>{org.business_phone}</Text> : null}
            {org.business_email ? <Text style={styles.orgLine}>{org.business_email}</Text> : null}
          </View>
          <View>
            <Text style={styles.docLabel}>ESTIMATE</Text>
            <Text style={styles.docNumber}>{estimateNumber}</Text>
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
                <Text style={[styles.blockBody, styles.blockBold]}>{client.name}</Text>
                {client.address ? <Text style={styles.blockMeta}>{client.address}</Text> : null}
                {client.email ? <Text style={styles.blockMeta}>{client.email}</Text> : null}
                {client.phone ? <Text style={styles.blockMeta}>{client.phone}</Text> : null}
              </View>
            ) : (
              <Text style={styles.blockMeta}>—</Text>
            )}
          </View>
          <View style={styles.colHalf}>
            <Text style={styles.smallLabel}>Project</Text>
            <Text style={[styles.blockBody, styles.blockBold]}>{project?.name ?? '—'}</Text>
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
          return (
          <View key={i} style={styles.tableRow} wrap={false}>
            {/* Single Text (not a nested View) so react-pdf sizes the row
                height correctly — a View here made rows overlap. Bold title,
                blank line, then the body in a lighter tone. */}
            <Text style={[styles.bodyText, styles.cellDesc]}>
              <Text style={styles.blockBold}>{titleLine}</Text>
              {bodyLines ? <Text style={{ color: COLORS.fg }}>{'\n\n' + bodyLines}</Text> : null}
            </Text>
            <Text style={[styles.monoRight, styles.cellQty]}>{li.quantity}</Text>
            <Text style={[styles.bodyText, styles.cellUnit, { textAlign: 'right' }]}>{li.unit ?? '—'}</Text>
            <Text style={[styles.monoRight, styles.cellRate]}>{money(li.unit_price)}</Text>
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
                    {m.label} ({m.pct.toFixed(0)}%)
                  </Text>
                  {m.trigger ? <Text style={styles.scheduleTrigger}>{m.trigger}</Text> : null}
                </View>
                <Text style={styles.scheduleAmount}>{money(m.amount)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Terms */}
        {terms ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesText}>{terms}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
