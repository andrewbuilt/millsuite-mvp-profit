'use client'

// ============================================================================
// InvoicePdfViewer — client-only wrapper around react-pdf's <PDFViewer>
// ============================================================================
// Imported via next/dynamic with ssr:false from anywhere that wants
// to embed a live preview. Re-renders when pdfProps changes; that's
// expensive, so callers should memoize.
// ============================================================================

import { PDFViewer } from '@react-pdf/renderer'
import { InvoicePdf, type InvoicePdfProps } from './InvoicePdf'

export function InvoicePdfViewer({
  pdfProps,
  height = 800,
}: {
  pdfProps: InvoicePdfProps
  height?: number
}) {
  return (
    <PDFViewer
      style={{ width: '100%', height, border: 'none' }}
      showToolbar={false}
    >
      <InvoicePdf {...pdfProps} />
    </PDFViewer>
  )
}
