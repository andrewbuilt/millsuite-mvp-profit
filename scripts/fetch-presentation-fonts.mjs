// ============================================================================
// scripts/fetch-presentation-fonts.mjs — vendor the presentation-estimate fonts
// ============================================================================
//   node scripts/fetch-presentation-fonts.mjs [--force]
//
// Downloads STATIC TTFs into assets/fonts/. react-pdf cannot use variable
// fonts or woff2 — it needs plain static TTF/OTF.
//
// ⛔ WHY THE CSS API AND NOT GITHUB RAW. The first version guessed paths under
// google/fonts `ofl/<family>/static/…`. Space Mono worked (it's a genuinely
// static family) and Newsreader + Instrument Sans 404'd on every candidate —
// both are VARIABLE families, and that repo no longer ships static folders for
// them. There is no static file to link to.
//
// So: ask the Google Fonts CSS API for the exact weights, with an ancient
// user-agent. Old UAs can't do woff2, so Google responds with TTF urls — and
// for a variable family it serves a static INSTANCE at the requested weight,
// which is precisely what react-pdf needs. This also means we never hand-guess
// a filename again; the API tells us where each face lives.
//
// Every download is checked for a real TrueType/OpenType magic number before
// it's written — a 404 page or an LFS pointer saved as Product-Regular.ttf
// fails deep inside react-pdf with an error that points nowhere near the cause.
//
// Re-runnable: existing files are skipped unless --force.
// ============================================================================

import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'assets/fonts')
const FORCE = process.argv.includes('--force')

// Old enough that Google won't offer woff2. This is the whole trick.
const LEGACY_UA = 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)'

/** file → the face to pull out of the CSS response. */
const WANTED = [
  { file: 'Newsreader-Light.ttf', family: 'Newsreader', weight: '300', style: 'normal' },
  { file: 'Newsreader-LightItalic.ttf', family: 'Newsreader', weight: '300', style: 'italic' },
  { file: 'Newsreader-Regular.ttf', family: 'Newsreader', weight: '400', style: 'normal' },
  { file: 'InstrumentSans-Regular.ttf', family: 'Instrument Sans', weight: '400', style: 'normal' },
  { file: 'InstrumentSans-Medium.ttf', family: 'Instrument Sans', weight: '500', style: 'normal' },
  { file: 'InstrumentSans-SemiBold.ttf', family: 'Instrument Sans', weight: '600', style: 'normal' },
  { file: 'SpaceMono-Regular.ttf', family: 'Space Mono', weight: '400', style: 'normal' },
]

const CSS_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=Newsreader:ital,wght@0,300;0,400;1,300' +
  '&family=Instrument+Sans:wght@400;500;600' +
  '&family=Space+Mono:wght@400'

function looksLikeFont(buf) {
  if (buf.length < 4) return false
  const tag = buf.subarray(0, 4)
  const hex = tag.toString('hex')
  const ascii = tag.toString('ascii')
  return hex === '00010000' || ascii === 'true' || ascii === 'ttcf' || ascii === 'OTTO'
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Parse @font-face blocks into {family, style, weight, url}. */
function parseFaces(css) {
  const faces = []
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const block = m[1]
    const family = /font-family:\s*'([^']+)'/.exec(block)?.[1]
    const style = /font-style:\s*(\w+)/.exec(block)?.[1] || 'normal'
    const weight = /font-weight:\s*(\d+)/.exec(block)?.[1] || '400'
    const url = /url\((https:\/\/[^)]+)\)/.exec(block)?.[1]
    if (family && url) faces.push({ family, style, weight, url })
  }
  return faces
}

async function main() {
  await mkdir(OUT, { recursive: true })
  console.log('Vendoring presentation-estimate fonts → assets/fonts/\n')

  const todo = []
  for (const w of WANTED) {
    if (!FORCE && (await exists(resolve(OUT, w.file)))) {
      console.log(`  skip    ${w.file} (already vendored — --force to replace)`)
    } else {
      todo.push(w)
    }
  }
  if (todo.length === 0) {
    console.log('\nNothing to do — every font is already vendored.')
    return
  }

  const res = await fetch(CSS_URL, { headers: { 'User-Agent': LEGACY_UA } })
  if (!res.ok) {
    console.error(`\nGoogle Fonts CSS request failed: ${res.status}`)
    process.exit(1)
  }
  const css = await res.text()
  const faces = parseFaces(css)

  if (faces.length === 0 || !faces.some((f) => /\.ttf($|\?)/i.test(f.url))) {
    console.error(
      '\nThe CSS API returned no TTF faces — Google may have changed what it serves ' +
        'to legacy user-agents. Fall back to downloading the families by hand from ' +
        'fonts.google.com (each zip has a static/ folder) and dropping them in ' +
        'assets/fonts/ under the exact filenames listed above.',
    )
    process.exit(1)
  }

  let failed = 0
  for (const w of todo) {
    // Prefer an exact family/weight/style match; Google returns one block per
    // subset, and any of them is the same instance for our purposes.
    const match = faces.find(
      (f) =>
        f.family.toLowerCase() === w.family.toLowerCase() &&
        f.weight === w.weight &&
        f.style === w.style,
    )
    if (!match) {
      console.error(`  FAILED  ${w.file} — no ${w.family} ${w.weight} ${w.style} face in the CSS`)
      failed++
      continue
    }
    const r = await fetch(match.url, { headers: { 'User-Agent': LEGACY_UA } })
    if (!r.ok) {
      console.error(`  FAILED  ${w.file} — ${r.status} from ${match.url}`)
      failed++
      continue
    }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!looksLikeFont(buf)) {
      console.error(`  FAILED  ${w.file} — 200 but not a font (${buf.length}b)`)
      failed++
      continue
    }
    await writeFile(resolve(OUT, w.file), buf)
    console.log(`  ok      ${w.file}  ${(buf.length / 1024).toFixed(0)}kb`)
  }

  console.log('')
  if (failed) {
    console.error(
      `${failed} font(s) could not be fetched. The presentation estimate still renders — it ` +
        `falls back to Helvetica — but it will NOT look like the approved mockup. Download the ` +
        `families from fonts.google.com and drop the static TTFs into assets/fonts/ using the ` +
        `exact filenames above.`,
    )
    process.exit(1)
  }
  console.log('All fonts vendored. Re-render to see the template as designed:')
  console.log('  npx tsx scripts/preview-presentation-estimate.tsx')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
