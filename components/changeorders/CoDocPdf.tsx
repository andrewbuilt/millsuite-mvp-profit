// ============================================================================
// CoDocPdf — the client-facing change order DOCUMENT (v2, migration 107)
// ============================================================================
// ⛔ A DOC IS NOT A CO. The v1 PDF (ChangeOrderPdf) renders ONE change: a
// before chip, an after chip, one price. A v2 doc is the whole conversation —
// Andrew's Pajot case is one change order containing three edits to the same
// island (remove the rounded end panel, add a finish panel, add a waterfall
// top) — so this renders a LIST of items with one net total and one signature.
// Rendering three separate v1 PDFs is exactly the "three guessed COs" the v2
// model exists to replace.
//
// Per the spec: each item gets a description and its delta, **credits appear
// as negative lines**, and new scope gets its own section listing the priced
// lines that justify the number.
//
// ⚠️ SAME TEMPLATE LANGUAGE AS ChangeOrderPdf on purpose — the client has seen
// that letterhead. Styles are duplicated rather than shared because the two
// documents have genuinely different bodies and a shared stylesheet would have
// to grow options for both; the header/footer conventions are what matter and
// those are copied verbatim.
// ============================================================================

// ⚠️ THE EXPLICIT React IMPORT IS WHAT MAKES THIS TESTABLE. Next compiles JSX
// with the automatic runtime, so the app never needs it — but `tsx` (which
// scripts/verify-co-doc-pdf uses to render this for real) compiles with the
// CLASSIC runtime and throws "React is not defined". Without this line the
// only way to find out the PDF crashes is a client asking for it.
import React from 'react'
import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import { pdfLogoOk } from '@/components/estimates/EstimatePdf'
import { pdfText } from '@/lib/pdf-text'

export interface CoDocPdfItem {
  kind: 'add_sub' | 'edit_sub' | 'remove_sub' | 'adjustment'
  /** What the client reads: the draft name, the sub name, or a typed note. */
  headline: string
  /** Optional longer description typed by the shop. */
  description?: string | null
  /** Negative for a credit. */
  delta: number
  /** For add_sub — the composed lines behind the price. */
  lines?: Array<{ description: string; quantity: number; unit: string | null }>
}

export interface CoDocPdfProps {
  coNumber: string
  coDate: string
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
  title?: string | null
  items: CoDocPdfItem[]
  /** Contract value BEFORE this change order, when known. */
  contractBefore?: number | null
  /** Sum of the item deltas. */
  netChange: number
  /** Set on the countersigned copy taken at acceptance. */
  signature?: { name: string; at: string } | null
}

const C = { ink: '#111', fg: '#374151', meta: '#6B7280', dim: '#9CA3AF', hair: '#E5E7EB' }
const S = StyleSheet.create({
  page: { paddingTop: 48, paddingHorizontal: 48, paddingBottom: 48, fontSize: 10.5, color: C.ink, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
  logo: { height: 26, marginBottom: 10, alignSelf: 'flex-start' },
  orgName: { fontSize: 16, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  orgLine: { fontSize: 9.5, color: C.meta, lineHeight: 1.4 },
  docLabel: { fontSize: 20, fontFamily: 'Helvetica-Bold', letterSpacing: 2, textAlign: 'right', marginBottom: 4 },
  docNumber: { fontSize: 11, color: C.fg, textAlign: 'right', marginBottom: 8 },
  docMeta: { fontSize: 9.5, color: C.meta, textAlign: 'right' },
  twoCol: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 24 },
  colHalf: { width: '48%' },
  smallLabel: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.dim, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 },
  body: { fontSize: 10.5, lineHeight: 1.45 },
  meta: { fontSize: 9.5, color: C.meta, lineHeight: 1.4 },
  rule: { borderTopWidth: 1, borderTopColor: C.ink, marginBottom: 12, marginTop: 4 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 12 },

  item: { marginBottom: 14, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: C.hair },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', flexGrow: 1, paddingRight: 16 },
  itemAmount: { fontSize: 11, fontFamily: 'Courier', width: 90, textAlign: 'right' },
  itemKind: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.dim, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3 },
  itemDesc: { fontSize: 9.5, color: C.fg, marginTop: 4, lineHeight: 1.4 },
  lineRow: { flexDirection: 'row', paddingVertical: 2.5, paddingLeft: 10 },
  lineDesc: { flexGrow: 1, fontSize: 9.5, color: C.meta, paddingRight: 8 },
  lineQty: { width: 70, textAlign: 'right', fontSize: 9.5, color: C.meta, fontFamily: 'Courier' },

  totals: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 14 },
  totalsBox: { minWidth: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totalLabel: { fontSize: 10, color: C.meta },
  totalVal: { fontSize: 10, fontFamily: 'Courier' },
  netRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: 0.75, borderTopColor: C.ink, marginTop: 4 },
  netLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  netVal: { fontSize: 14, fontFamily: 'Courier' },

  acceptWrap: { marginTop: 36, borderTopWidth: 0.5, borderTopColor: C.hair, paddingTop: 16 },
  sigLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  sigCol: { width: '46%' },
  sigRule: { borderTopWidth: 0.75, borderTopColor: C.ink, marginBottom: 4 },
  sigLabel: { fontSize: 8.5, color: C.meta },
  sigTyped: { fontSize: 13, fontFamily: 'Helvetica-Oblique', marginBottom: 3 },
})

function money(n: number): string {
  const v = Math.round(Math.abs(n)).toLocaleString('en-US')
  // ⚠️ ASCII hyphen — Helvetica in @react-pdf has no U+2212 minus glyph, and a
  // missing glyph on a CREDIT line is the one place it would actually cost
  // money to misread.
  return `${n < 0 ? '-' : ''}$${v}`
}

const pdfSafe = pdfText

function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T12:00:00Z' : ''))
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

const KIND_LABEL: Record<CoDocPdfItem['kind'], string> = {
  // A flat amount has no scope model behind it — the description IS the item.
  adjustment: 'Adjustment',
  add_sub: 'Added scope',
  edit_sub: 'Revised scope',
  remove_sub: 'Removed scope',
}

export function CoDocPdf({
  coNumber,
  coDate,
  org,
  project,
  client,
  title,
  items,
  contractBefore,
  netChange,
  signature,
}: CoDocPdfProps) {
  const orgAddr = [org.business_address, [org.business_city, org.business_state].filter(Boolean).join(', '), org.business_zip]
    .filter(Boolean)
    .join(' · ')
  const additions = items.filter((i) => i.delta >= 0).reduce((s, i) => s + i.delta, 0)
  const credits = items.filter((i) => i.delta < 0).reduce((s, i) => s + i.delta, 0)
  const showSplit = additions > 0 && credits < 0

  return (
    <Document>
      <Page size="LETTER" style={S.page}>
        <View style={S.headerRow}>
          <View>
            {pdfLogoOk(org.logo_url) ? <Image src={org.logo_url} style={S.logo} /> : null}
            <Text style={S.orgName}>{pdfSafe(org.name)}</Text>
            {orgAddr ? <Text style={S.orgLine}>{pdfSafe(orgAddr)}</Text> : null}
            {org.business_phone ? <Text style={S.orgLine}>{pdfSafe(org.business_phone)}</Text> : null}
            {org.business_email ? <Text style={S.orgLine}>{pdfSafe(org.business_email)}</Text> : null}
          </View>
          <View>
            <Text style={S.docLabel}>CHANGE ORDER</Text>
            <Text style={S.docNumber}>{pdfSafe(coNumber)}</Text>
            <Text style={S.docMeta}>{fmtDate(coDate)}</Text>
          </View>
        </View>

        <View style={S.twoCol}>
          <View style={S.colHalf}>
            <Text style={S.smallLabel}>For</Text>
            <Text style={[S.body, { fontFamily: 'Helvetica-Bold' }]}>{pdfSafe(client?.name) || '-'}</Text>
            {client?.address ? <Text style={S.meta}>{pdfSafe(client.address)}</Text> : null}
            {client?.email ? <Text style={S.meta}>{pdfSafe(client.email)}</Text> : null}
          </View>
          <View style={S.colHalf}>
            <Text style={S.smallLabel}>Project</Text>
            <Text style={S.body}>{pdfSafe(project?.name) || '-'}</Text>
          </View>
        </View>

        <View style={S.rule} />
        <Text style={S.title}>{pdfSafe(title || 'Changes to the contracted scope')}</Text>

        {/* ⛔ ONE SECTION PER ITEM. A credit is a NEGATIVE LINE, not a line
            hidden inside a smaller total — the client has to be able to see
            what they were given back and what they were charged for. */}
        {items.map((item, i) => (
          <View key={i} style={S.item} wrap={false}>
            <Text style={S.itemKind}>{KIND_LABEL[item.kind]}</Text>
            <View style={S.itemHead}>
              <Text style={S.itemTitle}>{pdfSafe(item.headline)}</Text>
              <Text style={S.itemAmount}>{money(item.delta)}</Text>
            </View>
            {item.description ? <Text style={S.itemDesc}>{pdfSafe(item.description)}</Text> : null}
            {/* New scope lists what it's made of. A number with nothing behind
                it is what the v1 modal produced, and what Andrew called
                guessing. */}
            {item.lines && item.lines.length > 0
              ? item.lines.map((l, j) => (
                  <View key={j} style={S.lineRow}>
                    <Text style={S.lineDesc}>{pdfSafe(l.description)}</Text>
                    <Text style={S.lineQty}>
                      {l.quantity} {pdfSafe(l.unit || '')}
                    </Text>
                  </View>
                ))
              : null}
            {item.kind === 'remove_sub' ? (
              <Text style={S.itemDesc}>Credited at the value in the original contract.</Text>
            ) : null}
          </View>
        ))}

        <View style={S.totals}>
          <View style={S.totalsBox}>
            {showSplit ? (
              <>
                <View style={S.totalRow}>
                  <Text style={S.totalLabel}>Additions</Text>
                  <Text style={S.totalVal}>{money(additions)}</Text>
                </View>
                <View style={S.totalRow}>
                  <Text style={S.totalLabel}>Credits</Text>
                  <Text style={S.totalVal}>{money(credits)}</Text>
                </View>
              </>
            ) : null}
            {typeof contractBefore === 'number' && contractBefore > 0 ? (
              <>
                <View style={S.totalRow}>
                  <Text style={S.totalLabel}>Contract before this change order</Text>
                  <Text style={S.totalVal}>{money(contractBefore)}</Text>
                </View>
                <View style={S.totalRow}>
                  <Text style={S.totalLabel}>Revised contract</Text>
                  <Text style={S.totalVal}>{money(contractBefore + netChange)}</Text>
                </View>
              </>
            ) : null}
            <View style={S.netRow}>
              <Text style={S.netLabel}>{netChange < 0 ? 'Net credit' : 'Net change'}</Text>
              <Text style={S.netVal}>{money(netChange)}</Text>
            </View>
          </View>
        </View>

        <View style={S.acceptWrap}>
          <Text style={S.smallLabel}>Acceptance</Text>
          {signature ? (
            <>
              <Text style={S.meta}>
                The client approved the changes described above and the resulting change in contract
                value. A typed name was accepted as an electronic signature. Approved changes may
                affect the project timeline.
              </Text>
              <View style={S.sigLine}>
                <View style={S.sigCol}>
                  <Text style={S.sigTyped}>{pdfSafe(signature.name)}</Text>
                  <View style={S.sigRule} />
                  <Text style={S.sigLabel}>Client signature (electronic)</Text>
                </View>
                <View style={S.sigCol}>
                  <Text style={S.sigTyped}>{pdfSafe(fmtDate(signature.at))}</Text>
                  <View style={S.sigRule} />
                  <Text style={S.sigLabel}>Date</Text>
                </View>
              </View>
            </>
          ) : (
            <>
              <Text style={S.meta}>
                By signing below, the client approves the changes described above and the resulting
                change in contract value. Approved changes may affect the project timeline.
              </Text>
              <View style={S.sigLine}>
                <View style={S.sigCol}>
                  <View style={S.sigRule} />
                  <Text style={S.sigLabel}>Client signature</Text>
                </View>
                <View style={S.sigCol}>
                  <View style={S.sigRule} />
                  <Text style={S.sigLabel}>Date</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </Page>
    </Document>
  )
}
