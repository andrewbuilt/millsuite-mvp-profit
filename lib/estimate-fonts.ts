// ============================================================================
// lib/estimate-fonts.ts — font registration for the presentation estimate
// ============================================================================
// The presentation template's whole point is its typography, but the faces are
// vendored files rather than dependencies (`node scripts/fetch-presentation-
// fonts.mjs`). So this has one job: register them IF they're on disk, and
// degrade to the built-ins if they aren't.
//
// ⛔ WHY THE FALLBACK MATTERS. `Font.register` with a missing path doesn't fail
// at registration — it throws later, deep inside the renderer, when a Text
// using that family is laid out. That surfaces as a 500 on the PDF route with
// a stack trace pointing at layout code, nowhere near the actual cause (a file
// that was never downloaded). A fresh clone, or a deploy where the fonts
// weren't committed, would produce exactly that. Checking first turns an
// obscure crash into a plain-looking PDF plus one console line.
//
// The FONT export is what components reference, so a missing face changes one
// value here rather than every style rule.
//
// Static TTFs only — react-pdf supports neither variable fonts nor woff2.
// ============================================================================

import { Font } from '@react-pdf/renderer'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'assets', 'fonts')

const FILES = {
  newsreaderLight: 'Newsreader-Light.ttf',
  newsreaderLightItalic: 'Newsreader-LightItalic.ttf',
  newsreaderRegular: 'Newsreader-Regular.ttf',
  instrumentRegular: 'InstrumentSans-Regular.ttf',
  instrumentMedium: 'InstrumentSans-Medium.ttf',
  instrumentSemiBold: 'InstrumentSans-SemiBold.ttf',
  spaceMono: 'SpaceMono-Regular.ttf',
} as const

let registered = false
let available = false

/**
 * Register once per process. Returns whether the real faces are in play.
 *
 * All-or-nothing on purpose: a half-registered set (serif present, mono
 * missing) would render numerals in Helvetica beside Newsreader headlines,
 * which reads as a bug rather than as a fallback. Better a consistent plain
 * document than a broken-looking mixed one.
 */
export function registerEstimateFonts(): boolean {
  if (registered) return available
  registered = true

  const paths = Object.fromEntries(
    Object.entries(FILES).map(([k, f]) => [k, join(DIR, f)]),
  ) as Record<keyof typeof FILES, string>

  const missing = Object.entries(paths)
    .filter(([, p]) => !existsSync(p))
    .map(([k]) => FILES[k as keyof typeof FILES])

  if (missing.length > 0) {
    console.warn(
      `[estimate-fonts] ${missing.length} font file(s) missing from assets/fonts — the ` +
        `presentation estimate will render in Helvetica and will NOT match the approved ` +
        `mockup. Run: node scripts/fetch-presentation-fonts.mjs  (missing: ${missing.join(', ')})`,
    )
    return false
  }

  try {
    Font.register({
      family: 'Newsreader',
      fonts: [
        { src: paths.newsreaderLight, fontWeight: 300 },
        { src: paths.newsreaderLightItalic, fontWeight: 300, fontStyle: 'italic' },
        { src: paths.newsreaderRegular, fontWeight: 400 },
      ],
    })
    Font.register({
      family: 'InstrumentSans',
      fonts: [
        { src: paths.instrumentRegular, fontWeight: 400 },
        { src: paths.instrumentMedium, fontWeight: 500 },
        { src: paths.instrumentSemiBold, fontWeight: 600 },
      ],
    })
    Font.register({ family: 'SpaceMono', fonts: [{ src: paths.spaceMono, fontWeight: 400 }] })
  } catch (e) {
    console.warn('[estimate-fonts] registration failed, falling back to built-ins:', e)
    return false
  }

  // The serif headline and the long italic note both hyphenate badly at these
  // sizes — react-pdf hyphenates by default and a broken word in a 32pt
  // headline is the first thing you'd notice.
  Font.registerHyphenationCallback((word) => [word])

  available = true
  return true
}

/** Family names for the three roles, resolved against what's actually
 *  registered. Components reference these, never the raw family strings. */
export function estimateFonts(): { serif: string; sans: string; mono: string } {
  const ok = registerEstimateFonts()
  return ok
    ? { serif: 'Newsreader', sans: 'InstrumentSans', mono: 'SpaceMono' }
    : { serif: 'Times-Roman', sans: 'Helvetica', mono: 'Courier' }
}
