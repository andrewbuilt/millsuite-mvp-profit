// ============================================================================
// ChangeOrderPdf — client-facing Change Order PDF (its own template, not a
// restyled estimate). Renders server-side (renderToBuffer) via
// app/api/change-orders/[id]/pdf.
// ============================================================================

import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

export interface ChangeOrderPdfProps {
  coNumber: string // e.g. "CO-03"
  coDate: string // ISO
  org: {
    name: string
    business_address?: string | null
    business_city?: string | null
    business_state?: string | null
    business_zip?: string | null
    business_phone?: string | null
    business_email?: string | null
  }
  project: { name: string } | null
  client: { name: string; address?: string | null; email?: string | null; phone?: string | null } | null
  title: string
  originalLabel?: string | null
  proposedLabel?: string | null
  /** Custom-mode material lines, if any. */
  materials?: { desc: string; qty: number; unit_cost: number; vendor?: boolean }[]
  clientPrice: number
  noCharge: boolean
  drawingRevisionRequired: boolean
}

const C = { ink: '#111', fg: '#374151', meta: '#6B7280', dim: '#9CA3AF', hair: '#E5E7EB' }
const S = StyleSheet.create({
  page: { paddingTop: 48, paddingHorizontal: 48, paddingBottom: 48, fontSize: 10.5, color: C.ink, fontFamily: 'Helvetica' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
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
  rule: { borderTopWidth: 1, borderTopColor: C.ink, marginBottom: 10, marginTop: 4 },
  title: { fontSize: 13, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  changeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  chip: { fontSize: 10.5, backgroundColor: '#F9FAFB', borderWidth: 0.5, borderColor: C.hair, borderRadius: 4, paddingVertical: 4, paddingHorizontal: 8 },
  arrow: { fontSize: 12, color: C.dim, marginHorizontal: 8 },
  matRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: C.hair },
  matDesc: { flexGrow: 1, paddingRight: 8 },
  matNum: { width: 90, textAlign: 'right', fontFamily: 'Courier' },
  priceWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 18 },
  priceBox: { minWidth: 200 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  priceLabel: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  priceVal: { fontSize: 14, fontFamily: 'Courier' },
  note: { fontSize: 9.5, color: C.meta, marginTop: 6 },
  acceptWrap: { marginTop: 40, borderTopWidth: 0.5, borderTopColor: C.hair, paddingTop: 16 },
  sigLine: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 28 },
  sigCol: { width: '46%' },
  sigRule: { borderTopWidth: 0.75, borderTopColor: C.ink, marginBottom: 4 },
  sigLabel: { fontSize: 8.5, color: C.meta },
})

function money(n: number): string {
  const v = Math.round(Math.abs(n)).toLocaleString('en-US')
  return `${n < 0 ? '−' : ''}$${v}`
}
function fmtDate(iso: string): string {
  const d = new Date(iso + (iso.length <= 10 ? 'T12:00:00Z' : ''))
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function ChangeOrderPdf({
  coNumber,
  coDate,
  org,
  project,
  client,
  title,
  originalLabel,
  proposedLabel,
  materials,
  clientPrice,
  noCharge,
  drawingRevisionRequired,
}: ChangeOrderPdfProps) {
  const orgAddr = [org.business_address, [org.business_city, org.business_state].filter(Boolean).join(', '), org.business_zip]
    .filter(Boolean)
    .join(' · ')
  const hasMaterials = materials && materials.length > 0
  return (
    <Document>
      <Page size="LETTER" style={S.page}>
        <View style={S.headerRow}>
          <View>
            <Text style={S.orgName}>{org.name}</Text>
            {orgAddr ? <Text style={S.orgLine}>{orgAddr}</Text> : null}
            {org.business_phone ? <Text style={S.orgLine}>{org.business_phone}</Text> : null}
            {org.business_email ? <Text style={S.orgLine}>{org.business_email}</Text> : null}
          </View>
          <View>
            <Text style={S.docLabel}>CHANGE ORDER</Text>
            <Text style={S.docNumber}>{coNumber}</Text>
            <Text style={S.docMeta}>{fmtDate(coDate)}</Text>
          </View>
        </View>

        <View style={S.twoCol}>
          <View style={S.colHalf}>
            <Text style={S.smallLabel}>For</Text>
            <Text style={[S.body, { fontFamily: 'Helvetica-Bold' }]}>{client?.name ?? '—'}</Text>
            {client?.address ? <Text style={S.meta}>{client.address}</Text> : null}
            {client?.email ? <Text style={S.meta}>{client.email}</Text> : null}
          </View>
          <View style={S.colHalf}>
            <Text style={S.smallLabel}>Project</Text>
            <Text style={S.body}>{project?.name ?? '—'}</Text>
          </View>
        </View>

        <View style={S.rule} />
        <Text style={S.title}>{title}</Text>

        {(originalLabel || proposedLabel) && !hasMaterials ? (
          <View style={S.changeRow}>
            <Text style={S.chip}>{originalLabel || '—'}</Text>
            <Text style={S.arrow}>→</Text>
            <Text style={S.chip}>{proposedLabel || '—'}</Text>
          </View>
        ) : null}

        {hasMaterials ? (
          <View style={{ marginBottom: 8 }}>
            <Text style={S.smallLabel}>Materials</Text>
            {materials!.map((m, i) => (
              <View key={i} style={S.matRow}>
                <Text style={S.matDesc}>
                  {m.desc}
                  {m.vendor ? ' (vendor)' : ''}
                </Text>
                <Text style={S.matNum}>
                  {m.qty} × {money(m.unit_cost)}
                </Text>
                <Text style={S.matNum}>{money(m.qty * m.unit_cost)}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={S.priceWrap}>
          <View style={S.priceBox}>
            <View style={S.priceRow}>
              <Text style={S.priceLabel}>{noCharge ? 'No charge' : 'Change order total'}</Text>
              <Text style={[S.priceVal, { fontFamily: 'Courier' }]}>{noCharge ? '$0' : money(clientPrice)}</Text>
            </View>
          </View>
        </View>

        {drawingRevisionRequired ? (
          <Text style={S.note}>A drawing revision is required for this change.</Text>
        ) : null}

        <View style={S.acceptWrap}>
          <Text style={S.smallLabel}>Acceptance</Text>
          <Text style={S.meta}>
            By signing below, the client approves the change described above{noCharge ? '' : ' and the associated cost'}.
            Approved changes may affect the project timeline.
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
        </View>
      </Page>
    </Document>
  )
}
