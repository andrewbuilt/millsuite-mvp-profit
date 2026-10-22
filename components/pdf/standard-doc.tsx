// ============================================================================
// components/pdf/standard-doc.tsx — the STANDARD document system
// ============================================================================
// One palette, one type scale, one org header, shared by the standard
// estimate (EstimatePdf) and the change order (CoDocPdf) — "fix once, verify
// both" (Andrew's EST-0036 look, 2026-10-22). The invoice uses the org header.
//
// The rules, so the next edit keeps them:
//   · THREE grays, each with one job: INK for titles and every number, FG for
//     body copy and contact lines, DIM for small-caps labels. No fourth gray.
//   · ONE label style (LABEL) for every small-caps label — column headers,
//     PREPARED FOR, DESCRIPTION / DETAILS / EXCLUSIONS, PAYMENT SCHEDULE.
//   · Numbers in Helvetica, not Courier. Helvetica's digits are all one width,
//     so right-aligned columns still line up — without the typewriter look.
//   · Space BETWEEN items is larger than space WITHIN one, so the eye groups
//     each line item as a unit.
//   · A logo IS the org's name: with a logo, the name heading isn't printed
//     under it; without one, the name heading is the wordmark.
//
// Courier stays out on purpose, and so do glyphs outside WinAnsi — see
// lib/pdf-text (≈ printed as "H").
// ============================================================================

import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'
import { pdfText } from '@/lib/pdf-text'

/** react-pdf <Image> renders raster only (no SVG) — show the logo when it's a
 *  PNG/JPG/etc., otherwise fall back to the org name text. (Moved here from
 *  EstimatePdf, which re-exports it for the existing importers.) */
export function pdfLogoOk(url: string | null | undefined): url is string {
  return !!url && !/\.svg(\?|$)/i.test(url)
}

export const DOC = {
  ink: '#111111',
  fg: '#374151',
  dim: '#9CA3AF',
  hairline: '#E5E7EB',
  rule: '#111111',
} as const

/** The type scale. Everything on a standard document is one of these. */
export const TYPE = {
  docLabel: 22, // ESTIMATE / CHANGE ORDER
  orgName: 16, // only when there's no logo
  itemTitle: 10.5,
  body: 9.5,
  number: 10, // table numerals
  label: 7.5, // small caps
} as const

export const docStyles = StyleSheet.create({
  label: {
    fontSize: TYPE.label,
    fontFamily: 'Helvetica-Bold',
    color: DOC.dim,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  body: { fontSize: TYPE.body, color: DOC.fg, lineHeight: 1.45 },
  orgLogo: { height: 26, marginBottom: 10, alignSelf: 'flex-start' },
  orgName: { fontSize: TYPE.orgName, fontFamily: 'Helvetica-Bold', color: DOC.ink, marginBottom: 4 },
  orgLine: { fontSize: TYPE.body, color: DOC.fg, lineHeight: 1.45 },
})

export interface OrgHeaderOrg {
  name?: string | null
  logo_url?: string | null
  business_address?: string | null
  business_phone?: string | null
  business_email?: string | null
}

/**
 * The org block, top-left of every standard document. `addressLines` are
 * pre-formatted by the caller (each doc words its city line its own way).
 */
export function OrgHeader({ org, addressLines }: { org: OrgHeaderOrg; addressLines: Array<string | null | undefined> }) {
  const hasLogo = pdfLogoOk(org.logo_url)
  return (
    <View>
      {hasLogo ? <Image src={org.logo_url as string} style={docStyles.orgLogo} /> : null}
      {/* ⛔ The logo IS the name — printing both read "built / Built". */}
      {!hasLogo ? <Text style={docStyles.orgName}>{pdfText(org.name) || 'Your Company'}</Text> : null}
      {addressLines.filter(Boolean).map((l, i) => (
        <Text key={i} style={docStyles.orgLine}>
          {pdfText(l as string)}
        </Text>
      ))}
    </View>
  )
}
