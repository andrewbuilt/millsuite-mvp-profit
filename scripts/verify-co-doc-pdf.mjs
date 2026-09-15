// ============================================================================
// verify-co-doc-pdf.mjs — the change order document actually renders.
// ============================================================================
// Run: npx tsx scripts/verify-co-doc-pdf.mjs
//
// ⛔ WHY RENDER IT FOR REAL. @react-pdf builds its own layout engine: an
// unsupported style prop, a missing font glyph or a bad `wrap` throws at
// RENDER time, not at compile time. `tsc` is perfectly happy with a component
// that explodes the moment a client asks for the PDF — and the moment a client
// asks for it is exactly when you can't afford it to explode.
//
// The case under test is Andrew's real one (Pajot): ONE change order on the
// island with THREE items — remove the rounded end panel (a credit), add a
// finish panel, add a solid-wood waterfall top. That shape is the whole reason
// v2 exists; v1 would have made it three separate guessed COs.
// ============================================================================

import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { CoDocPdf } from '../components/changeorders/CoDocPdf.tsx'

let pass = 0
let fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else {
    fail++
    console.log(`  ✗ ${name}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`)
  }
}

const ORG = {
  name: 'Built Things',
  logo_url: null,
  business_address: '1234 Shop Rd',
  business_city: 'Tampa',
  business_state: 'FL',
  business_zip: '33601',
  business_phone: '(813) 555-0100',
  business_email: 'andrew@builtthings.com',
}

const PAJOT = {
  coNumber: 'CO-01',
  coDate: '2026-09-15',
  org: ORG,
  project: { name: 'Hunt - Pajot Millwork' },
  client: { name: 'Pajot', address: '55 Bayshore Blvd', email: 'client@example.com', phone: null },
  title: 'Island revisions',
  items: [
    {
      kind: 'remove_sub',
      headline: 'Rounded end panel',
      description: null,
      delta: -1850,
    },
    {
      kind: 'add_sub',
      headline: 'Island finish panel',
      description: 'Finish panel to the island end in place of the rounded return.',
      delta: 1420,
      lines: [{ description: 'Base cabinet · White oak, rift', quantity: 3, unit: 'lf' }],
    },
    {
      kind: 'add_sub',
      headline: 'Solid wood waterfall top',
      description: null,
      delta: 6240,
      lines: [
        { description: 'Solid Wood Top · 8/4 white oak', quantity: 1, unit: 'piece' },
        { description: 'Edge profile · eased', quantity: 1, unit: 'piece' },
      ],
    },
  ],
  contractBefore: 168090,
  netChange: 5810,
  signature: null,
}

async function render(props, label) {
  const buf = await renderToBuffer(React.createElement(CoDocPdf, props))
  // %PDF- is the file magic. A buffer that doesn't start with it isn't a PDF,
  // whatever else went right.
  check(`${label}: is a PDF`, buf.subarray(0, 5).toString('latin1'), '%PDF-')
  check(`${label}: has content`, buf.length > 2000, true)
  return buf
}

console.log("\nPajot's real case: one doc, three items, one credit")
await render(PAJOT, 'three items')

console.log('\nthe countersigned copy')
await render(
  { ...PAJOT, signature: { name: 'A. Pajot', at: '2026-09-16' } },
  'signed',
)

console.log('\na credit-only change order')
// ⚠️ Net NEGATIVE. The money formatter uses an ASCII hyphen because Helvetica
// has no U+2212 glyph — a missing glyph on a credit line is the one place it
// would actually cost money to misread.
await render(
  {
    ...PAJOT,
    title: 'Scope removed',
    items: [{ kind: 'remove_sub', headline: 'Pantry', description: null, delta: -4200 }],
    netChange: -4200,
  },
  'credit only',
)

console.log('\nthe thin cases')
// No client, no project name, no contract figure, no lines — every optional
// field absent at once. Each of these is a real state on a young project.
await render(
  {
    coNumber: 'CO-02',
    coDate: '2026-09-15',
    org: { name: 'Built Things' },
    project: null,
    client: null,
    title: null,
    items: [{ kind: 'edit_sub', headline: 'Kitchen', description: null, delta: 0 }],
    contractBefore: null,
    netChange: 0,
    signature: null,
  },
  'everything optional missing',
)

console.log('\na long document')
// 25 items with long names — checks the per-item `wrap={false}` doesn't wedge
// against a page break, which is the classic @react-pdf failure.
await render(
  {
    ...PAJOT,
    items: Array.from({ length: 25 }, (_, i) => ({
      kind: i % 3 === 0 ? 'remove_sub' : 'add_sub',
      headline: `Scope item ${i + 1} with a deliberately long client-facing name that wraps`,
      description: 'A description long enough to push the block toward a page boundary. '.repeat(3),
      delta: i % 3 === 0 ? -500 * (i + 1) : 900 * (i + 1),
      lines: [{ description: `Line for item ${i + 1}`, quantity: i + 1, unit: 'lf' }],
    })),
    netChange: 12345,
  },
  '25 items',
)

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
