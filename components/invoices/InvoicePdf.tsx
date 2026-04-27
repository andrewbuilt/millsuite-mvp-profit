// ============================================================================
// InvoicePdf — react-pdf rendering for client invoices
// ============================================================================
// Pure presentational component. Renders both server-side via
// @react-pdf/renderer's renderToBuffer (used by /api/invoices/[id]/pdf
// to cache a PDF in Supabase Storage) and client-side via <PDFViewer>
// (used by the detail page Preview tab).
//
// The visual structure mirrors PR-1's HTML preview so operators see
// the same shape on screen and on the rendered PDF. Styling is explicit
// (no Tailwind — react-pdf has its own StyleSheet).
// ============================================================================

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { Invoice, InvoiceLineItem, InvoicePayment } from '@/lib/invoices'

export interface InvoicePdfProps {
  invoice: Invoice
  lineItems: InvoiceLineItem[]
  payments: InvoicePayment[]
  org: {
    name: string
    business_address?: string | null
    business_city?: string | null
    business_state?: string | null
    business_zip?: string | null
    business_phone?: string | null
    business_email?: string | null
  }
  project: {
    name: string
  } | null
  client: {
    name: string
    address?: string | null
    email?: string | null
    phone?: string | null
  } | null
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

  // Header band — org block left, big INVOICE label right.
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  orgName: {
    fontSize: 16,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
    marginBottom: 4,
  },
  orgLine: {
    fontSize: 9.5,
    color: COLORS.meta,
    lineHeight: 1.4,
  },
  invoiceLabel: {
    fontSize: 22,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 3,
    textAlign: 'right',
    marginBottom: 4,
  },
  invoiceNumber: {
    fontSize: 11,
    fontFamily: 'Helvetica',
    color: COLORS.fg,
    textAlign: 'right',
    marginBottom: 8,
  },
  invoiceMeta: {
    fontSize: 9.5,
    color: COLORS.meta,
    textAlign: 'right',
  },

  // Bill-to / Project two-column band.
  twoCol: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  colHalf: { width: '48%' },
  smallLabel: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dim,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  blockBody: {
    fontSize: 10.5,
    lineHeight: 1.45,
    color: COLORS.ink,
  },
  blockMeta: {
    fontSize: 9.5,
    lineHeight: 1.4,
    color: COLORS.meta,
  },
  blockBold: {
    fontFamily: 'Helvetica-Bold',
  },

  // Line items.
  tableRule: {
    borderTopWidth: 1,
    borderTopColor: COLORS.rule,
    marginBottom: 4,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingTop: 4,
    paddingBottom: 6,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 5,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.hairline,
  },
  cellDesc: { flexGrow: 1, paddingRight: 8 },
  cellQty: { width: 48, textAlign: 'right', paddingRight: 6 },
  cellUnit: { width: 48, textAlign: 'right', paddingRight: 6 },
  cellRate: { width: 70, textAlign: 'right', paddingRight: 6 },
  cellAmount: { width: 78, textAlign: 'right' },

  headerText: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.dim,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  bodyText: {
    fontSize: 10.5,
    color: COLORS.ink,
  },
  monoRight: {
    fontSize: 10.5,
    fontFamily: 'Courier',
    color: COLORS.ink,
    textAlign: 'right',
  },

  // Totals block — right-aligned, narrow column.
  totalsWrap: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  totalsCol: { width: 220 },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  totalsRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  totalsLabel: {
    fontSize: 10.5,
    color: COLORS.fg,
  },
  totalsLabelBold: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: COLORS.ink,
  },
  totalsLabelDim: {
    fontSize: 10.5,
    color: COLORS.dim,
  },
  totalsValue: {
    fontSize: 10.5,
    fontFamily: 'Courier',
    color: COLORS.ink,
  },
  totalsValueBold: {
    fontSize: 11,
    fontFamily: 'Courier-Bold',
    color: COLORS.ink,
  },
  totalsValueDim: {
    fontSize: 10.5,
    fontFamily: 'Courier',
    color: COLORS.dim,
  },
  totalsRule: {
    borderTopWidth: 1,
    borderTopColor: COLORS.rule,
    marginVertical: 3,
  },

  // Notes / footer.
  notesBlock: {
    marginTop: 36,
    paddingTop: 14,
    borderTopWidth: 0.5,
    borderTopColor: COLORS.hairline,
  },
  notesText: {
    fontSize: 9.5,
    color: COLORS.fg,
    lineHeight: 1.5,
  },
})

function fmt$(n: number): string {
  return `$${(n || 0).toFixed(2)}`
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00Z')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function InvoicePdf({
  invoice,
  lineItems,
  payments,
  org,
  project,
  client,
}: InvoicePdfProps) {
  // Suppress unused-warning for payments — PR-3 will surface a payment
  // history block in the PDF; the prop ships now to avoid churn later.
  void payments

  const cityLine = [org.business_city, org.business_state, org.business_zip]
    .filter(Boolean)
    .join(org.business_state ? ', ' : ' ')

  const balance = Math.max(0, invoice.total - invoice.amount_received)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.orgName}>{org.name || 'Your Company'}</Text>
            {org.business_address ? (
              <Text style={styles.orgLine}>{org.business_address}</Text>
            ) : null}
            {cityLine ? <Text style={styles.orgLine}>{cityLine}</Text> : null}
            {org.business_phone ? (
              <Text style={styles.orgLine}>{org.business_phone}</Text>
            ) : null}
            {org.business_email ? (
              <Text style={styles.orgLine}>{org.business_email}</Text>
            ) : null}
          </View>
          <View>
            <Text style={styles.invoiceLabel}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
            <Text style={styles.invoiceMeta}>Date: {fmtDate(invoice.invoice_date)}</Text>
            <Text style={styles.invoiceMeta}>Due: {fmtDate(invoice.due_date)}</Text>
          </View>
        </View>

        {/* Bill to / Project */}
        <View style={styles.twoCol}>
          <View style={styles.colHalf}>
            <Text style={styles.smallLabel}>Bill to</Text>
            {client ? (
              <View>
                <Text style={[styles.blockBody, styles.blockBold]}>{client.name}</Text>
                {client.address ? (
                  <Text style={styles.blockMeta}>{client.address}</Text>
                ) : null}
                {client.email ? (
                  <Text style={styles.blockMeta}>{client.email}</Text>
                ) : null}
                {client.phone ? (
                  <Text style={styles.blockMeta}>{client.phone}</Text>
                ) : null}
              </View>
            ) : (
              <Text style={styles.blockMeta}>—</Text>
            )}
          </View>
          <View style={styles.colHalf}>
            <Text style={styles.smallLabel}>Project</Text>
            <Text style={[styles.blockBody, styles.blockBold]}>
              {project?.name ?? '—'}
            </Text>
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
        {lineItems.map((li) => (
          <View key={li.id} style={styles.tableRow} wrap={false}>
            <Text style={[styles.bodyText, styles.cellDesc]}>{li.description}</Text>
            <Text style={[styles.monoRight, styles.cellQty]}>{li.quantity}</Text>
            <Text style={[styles.bodyText, styles.cellUnit, { textAlign: 'right' }]}>
              {li.unit ?? '—'}
            </Text>
            <Text style={[styles.monoRight, styles.cellRate]}>
              {fmt$(li.unit_price)}
            </Text>
            <Text style={[styles.monoRight, styles.cellAmount]}>
              {fmt$(li.amount > 0 ? li.amount : li.quantity * li.unit_price)}
            </Text>
          </View>
        ))}

        {/* Totals */}
        <View style={styles.totalsWrap}>
          <View style={styles.totalsCol}>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>Subtotal</Text>
              <Text style={styles.totalsValue}>{fmt$(invoice.subtotal)}</Text>
            </View>
            <View style={styles.totalsRow}>
              <Text style={styles.totalsLabel}>
                Tax ({invoice.tax_pct}%)
              </Text>
              <Text style={styles.totalsValue}>{fmt$(invoice.tax_amount)}</Text>
            </View>
            <View style={styles.totalsRule} />
            <View style={styles.totalsRowBold}>
              <Text style={styles.totalsLabelBold}>Total</Text>
              <Text style={styles.totalsValueBold}>{fmt$(invoice.total)}</Text>
            </View>
            {invoice.amount_received > 0 ? (
              <View style={styles.totalsRow}>
                <Text style={styles.totalsLabelDim}>Received</Text>
                <Text style={styles.totalsValueDim}>
                  {fmt$(invoice.amount_received)}
                </Text>
              </View>
            ) : null}
            <View style={styles.totalsRowBold}>
              <Text style={styles.totalsLabelBold}>Balance due</Text>
              <Text style={styles.totalsValueBold}>{fmt$(balance)}</Text>
            </View>
          </View>
        </View>

        {/* Notes / footer */}
        {invoice.notes ? (
          <View style={styles.notesBlock}>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        ) : null}
      </Page>
    </Document>
  )
}
