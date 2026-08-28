// ============================================================================
// lib/pdf-text.ts — make user text safe for the PDF font
// ============================================================================
// Our PDFs use the built-in Helvetica, which react-pdf encodes as WinAnsi. A
// character outside that encoding does NOT fail loudly — it renders as some
// other glyph, or vanishes. In a document that goes to a client, that's worse
// than an error, because nobody notices.
//
// The one that bit us: a shop writing `8′ ceiling height` (prime, U+2032)
// printed as `82 ceiling height`. A silently corrupted NUMBER on an estimate.
//
// The map below is evidence, not guesswork — every entry was rendered through
// the real component and checked:
//
//   BROKEN, replaced here          KNOWN GOOD, deliberately left alone
//   ─────────────────────          ──────────────────────────────────
//   ′  U+2032 → '                  –  U+2013 en dash
//   ″  U+2033 → "                  —  U+2014 em dash
//   ‵  U+2035 → '                  ‘ ’ U+2018/19 curly singles
//   −  U+2212 minus  (vanished)    “ ” U+201C/1D curly doubles
//   ⁄  U+2044 frac slash → /       …  U+2026 ellipsis
//   ‐ ‑ ‒ U+2010/11/12 (vanished)  °  U+00B0 degree
//   → ⇒ U+2192/21D2 → " to "       ×  U+00D7 times
//                                  ½ ¼ ¾, •  U+2022 bullet
//
// Don't add a replacement without rendering it first — several characters that
// look risky are fine, and replacing them needlessly makes the output worse.
// ============================================================================

/** Characters the PDF font can't represent, mapped to an ASCII equivalent that
 *  means the same thing to a reader. */
const REPLACEMENTS: Array<[RegExp, string]> = [
  // Arrows carry meaning in change-order lines ("old → new"), so they become a
  // word rather than a glyph. Spaces are absorbed so we don't double them up.
  [/\s*[→⇒]\s*/g, ' to '],
  [/[′‵]/g, "'"], // prime, reversed prime
  [/″/g, '"'], // double prime
  [/⁄/g, '/'], // fraction slash
  [/[‐‑‒−]/g, '-'], // hyphen, non-breaking hyphen, figure dash, minus
]

/**
 * Sanitize a string for rendering into a PDF. Always run user-supplied text
 * (scope descriptions, terms, org/client names) through this before it reaches
 * a <Text>. Safe on null/undefined — returns ''.
 */
export function pdfText(s: string | null | undefined): string {
  let out = s ?? ''
  for (const [re, to] of REPLACEMENTS) out = out.replace(re, to)
  return out
}
