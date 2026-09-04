// ============================================================================
// scripts/built-footer-mark.tsx — Built's logomark, MARK ONLY, tinted to the
// presentation footer gray, exported as a transparent high-res PNG.
// ============================================================================
// KEPT, not throwaway: this is the only reproducible source of the footer-mark
// asset (orgs.estimate_footer_logo_url, migration 096). If the footer color
// ever changes, change FILL here, re-run, re-upload.
//
// Source art: Built_Logomark_Horizontal_Final_Black.ai (Andrew's Drive,
// BRANDING_2024/ART FILES) → `pdftocairo -svg`. The mark is the first three
// paths of that SVG (the wordmark "built" is the rest); path data is verbatim
// below. We draw them via react-pdf's vector <Svg> onto a page sized exactly
// to the mark's bounding box, then rasterize with pdftocairo — crisp at any
// print size, no cropping step.
//
//   npx tsx scripts/built-footer-mark.tsx   →  /tmp/built-footer-mark-1.png
// ============================================================================
import React from 'react'
import { renderToFile, Document, Page, Svg, Path } from '@react-pdf/renderer'
import { execFileSync } from 'node:child_process'

// Presentation run-footer text color (EstimatePresentationPdf s.runfoot).
const FILL = '#B4AFA4'

// Mark bounding box in the source SVG's coordinate space.
const VB = { x: 264.058, y: 460.292, w: 121.032, h: 159.411 }

const PATHS = [
  'M 264.058594 460.292969 L 275.578125 460.292969 C 287.164062 460.292969 296.585938 470.011719 296.605469 481.925781 L 296.714844 557.507812 L 311.074219 554.105469 L 311.074219 598.070312 C 311.074219 609.980469 301.625 619.703125 290.046875 619.703125 L 264.058594 619.703125 Z M 264.058594 460.292969',
  'M 311.070312 460.292969 L 320.667969 460.292969 C 332.25 460.292969 341.695312 470.011719 341.695312 481.925781 L 341.695312 546.671875 L 356.160156 543.421875 L 356.160156 598.070312 C 356.160156 609.980469 346.714844 619.703125 335.128906 619.703125 L 325.535156 619.703125 L 325.535156 550.675781 L 311.070312 554.105469 Z M 311.070312 460.292969',
  'M 370.628906 539.996094 L 370.628906 618.617188 C 379.007812 615.769531 385.089844 607.625 385.089844 598.070312 L 385.089844 552.972656 C 385.089844 545.824219 379.421875 539.992188 372.472656 539.992188 L 370.621094 539.992188 Z M 356.160156 461.378906 C 364.539062 464.226562 370.621094 472.367188 370.621094 481.925781 L 370.621094 539.996094 L 356.160156 543.425781 Z M 356.160156 461.378906',
]

async function main() {
  const el = (
    <Document>
      {/* No backgroundColor — the page stays unpainted so -transp gives real
          transparency around and inside the mark. */}
      <Page size={[VB.w, VB.h]}>
        <Svg width={VB.w} height={VB.h} viewBox={`${VB.x} ${VB.y} ${VB.w} ${VB.h}`}>
          {PATHS.map((d, i) => (
            <Path key={i} d={d} fill={FILL} fillRule="evenodd" />
          ))}
        </Svg>
      </Page>
    </Document>
  )
  await renderToFile(el as any, '/tmp/built-footer-mark.pdf')
  // 300dpi on a 159pt-tall page ≈ 664px tall — far beyond what a ~5pt footer
  // mark needs, so print stays crisp.
  execFileSync('pdftocairo', [
    '-png', '-transp', '-r', '300',
    '/tmp/built-footer-mark.pdf', '/tmp/built-footer-mark',
  ])
  console.log('wrote /tmp/built-footer-mark-1.png')
}
main().catch((e) => { console.error(e); process.exit(1) })
