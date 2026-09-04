// ============================================================================
// lib/estimate-headline.ts — the presentation cover's editorial sentence
// ============================================================================
// ⛔ THIS LIVES IN ITS OWN MODULE FOR A BUILD REASON, not a tidiness one.
//
// It's needed in two places: the PDF component (as the fallback when no
// headline was saved) and SendEstimateModal (as the editable default). The
// obvious move — export it from EstimatePresentationPdf and import it into the
// modal — BREAKS THE PRODUCTION BUILD. The modal is a client component, so
// that import drags the PDF component into the browser bundle, and with it
// `lib/estimate-fonts`, which reads `node:fs` and `node:path` to find the
// vendored TTFs. Webpack can't resolve those for the browser:
//
//     UnhandledSchemeError: Reading from "node:fs" is not handled by plugins
//     ./lib/estimate-fonts.ts → ./components/estimates/EstimatePresentationPdf.tsx
//       → ./components/estimates/SendEstimateModal.tsx → app/(app)/projects/[id]/page.tsx
//
// ⚠️ `tsc --noEmit` compiles that arrangement perfectly happily — the
// server/client boundary is a BUNDLER concern, not a type one. Only
// `npx next build` catches it. Run a production build before deploying
// anything that touches a PDF component.
//
// So: zero imports here, deliberately. Keep it that way.
// ============================================================================

/**
 * "A custom millwork package for the Kennedy Residence."
 *
 * The article is conditional on purpose. A household reads wrong without it
 * ("for Kennedy Residence") and a person reads wrong WITH it ("for the Patrick
 * Kennedy"), and Built's client records hold both. So it's added only for
 * names that are plainly a place or household, and never when the name already
 * starts with "The".
 *
 * This is only ever a DEFAULT — the send modal lets the sender edit it, and
 * what they send is persisted, so a bad guess is one keystroke from fixed.
 */
export function estimateHeadlineFor(name: string): string {
  const n = (name || '').trim()
  if (!n) return 'A custom millwork package.'
  const needsArticle =
    !/^the\s/i.test(n) && /\b(residence|household|family|house|estate|home)\s*$/i.test(n)
  return `A custom millwork package for ${needsArticle ? 'the ' : ''}${n}.`
}
