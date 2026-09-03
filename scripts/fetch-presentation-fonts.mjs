// ============================================================================
// scripts/fetch-presentation-fonts.mjs — vendor the presentation-estimate fonts
// ============================================================================
//   node scripts/fetch-presentation-fonts.mjs
//
// Downloads STATIC TTFs into assets/fonts/. react-pdf cannot use variable
// fonts or woff2 — it needs plain static TTF/OTF — so this deliberately pulls
// the `static/` builds rather than the variable files Google serves by default.
//
// The three roles (locked with Andrew):
//   Newsreader 300        headline serif + the italic thank-you
//   Instrument Sans 400/500/600   labels and body
//   Space Mono 400        EVERY numeral (the GT America Mono role)
//
// ⛔ VALIDATES WHAT IT DOWNLOADS. A wrong path on GitHub returns a 404 HTML
// page with status 200 in some proxies; writing that to Product-Regular.ttf
// produces a font file that fails deep inside react-pdf with an unhelpful
// error. Every file is checked for a real TrueType/OpenType magic number
// before it is written, and each font tries several known-good paths.
//
// Re-runnable: existing files are skipped unless --force.
// ============================================================================

import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'assets/fonts')
const FORCE = process.argv.includes('--force')
const GH = 'https://raw.githubusercontent.com/google/fonts/main'

/** Each entry: the file we want, and candidate upstream paths to try in order.
 *  Optical-size families (Newsreader) name their statics inconsistently across
 *  releases, which is exactly why this is a list and not a string. */
const FONTS = [
  {
    file: 'Newsreader-Light.ttf',
    urls: [
      `${GH}/ofl/newsreader/static/Newsreader_9pt-Light.ttf`,
      `${GH}/ofl/newsreader/static/Newsreader-Light.ttf`,
      `${GH}/ofl/newsreader/static/Newsreader_14pt-Light.ttf`,
    ],
  },
  {
    file: 'Newsreader-LightItalic.ttf',
    urls: [
      `${GH}/ofl/newsreader/static/Newsreader_9pt-LightItalic.ttf`,
      `${GH}/ofl/newsreader/static/Newsreader-LightItalic.ttf`,
      `${GH}/ofl/newsreader/static/Newsreader_14pt-LightItalic.ttf`,
    ],
  },
  {
    file: 'Newsreader-Regular.ttf',
    urls: [
      `${GH}/ofl/newsreader/static/Newsreader_9pt-Regular.ttf`,
      `${GH}/ofl/newsreader/static/Newsreader-Regular.ttf`,
      `${GH}/ofl/newsreader/static/Newsreader_14pt-Regular.ttf`,
    ],
  },
  {
    file: 'InstrumentSans-Regular.ttf',
    urls: [`${GH}/ofl/instrumentsans/static/InstrumentSans-Regular.ttf`],
  },
  {
    file: 'InstrumentSans-Medium.ttf',
    urls: [`${GH}/ofl/instrumentsans/static/InstrumentSans-Medium.ttf`],
  },
  {
    file: 'InstrumentSans-SemiBold.ttf',
    urls: [`${GH}/ofl/instrumentsans/static/InstrumentSans-SemiBold.ttf`],
  },
  {
    file: 'SpaceMono-Regular.ttf',
    urls: [`${GH}/ofl/spacemono/SpaceMono-Regular.ttf`],
  },
]

/** TrueType/OpenType magic: 0x00010000, 'true', 'ttcf' or 'OTTO'. Anything
 *  else (an HTML error page, an LFS pointer, a redirect body) is rejected. */
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

async function fetchFont({ file, urls }) {
  const dest = resolve(OUT, file)
  if (!FORCE && (await exists(dest))) {
    console.log(`  skip    ${file} (already vendored — --force to replace)`)
    return true
  }
  for (const url of urls) {
    let res
    try {
      res = await fetch(url)
    } catch (e) {
      console.log(`  ...     ${url} — network error, trying next`)
      continue
    }
    if (!res.ok) {
      console.log(`  ...     ${url} — ${res.status}, trying next`)
      continue
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (!looksLikeFont(buf)) {
      console.log(
        `  ...     ${url} — 200 but NOT a font (${buf.length}b, starts "${buf
          .subarray(0, 16)
          .toString('ascii')
          .replace(/[^\x20-\x7e]/g, '.')}") — trying next`,
      )
      continue
    }
    await writeFile(dest, buf)
    console.log(`  ok      ${file}  ${(buf.length / 1024).toFixed(0)}kb`)
    return true
  }
  console.error(`  FAILED  ${file} — none of ${urls.length} candidate URL(s) returned a valid font`)
  return false
}

async function main() {
  await mkdir(OUT, { recursive: true })
  console.log(`Vendoring presentation-estimate fonts → assets/fonts/\n`)
  const results = []
  for (const f of FONTS) results.push(await fetchFont(f))
  const failed = results.filter((r) => !r).length
  console.log('')
  if (failed) {
    console.error(
      `${failed} font(s) could not be fetched. The presentation estimate still renders — it ` +
        `falls back to Helvetica — but it will NOT look like the approved mockup. Fix the URLs ` +
        `in this script, or drop the TTFs into assets/fonts/ by hand using the exact filenames above.`,
    )
    process.exit(1)
  }
  console.log('All fonts vendored. The presentation estimate will now render with the real faces.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
