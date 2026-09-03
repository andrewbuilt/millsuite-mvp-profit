// ============================================================================
// scripts/fetch-presentation-fonts.mjs — vendor the presentation-estimate fonts
// ============================================================================
//   node scripts/fetch-presentation-fonts.mjs [--force]
//
// Downloads STATIC TTFs into assets/fonts/. react-pdf cannot use woff2, and it
// won't instantiate a variable font's named instances — it needs plain TTFs.
//
// ⛔ TWO FAILED APPROACHES ARE BAKED INTO THIS FILE. Don't retry them.
//   1. Guessing paths under google/fonts `ofl/<family>/static/…`. Space Mono
//      worked (a genuinely static family); Newsreader and Instrument Sans
//      404'd everywhere, because they're VARIABLE families and that repo has
//      no static folder for them.
//   2. Asking the CSS API with an ancient user-agent, which used to make
//      Google serve TTF. It now returns woff2 regardless.
//
// So this DISCOVERS rather than guesses: it lists the family directory through
// the GitHub contents API and matches what's really there. If a family only
// ships a variable file, it takes that — a variable TTF still renders in
// react-pdf, it just pins to the file's default instance, so weights collapse.
// That's a real downgrade and it says so out loud rather than silently
// shipping the wrong weight.
//
// And when it can't match, it PRINTS THE DIRECTORY LISTING. Two rounds were
// lost to guessing filenames; the next person gets the actual contents.
//
// Every file is checked for a TrueType/OpenType magic number before writing —
// a 404 page saved as a .ttf fails deep inside react-pdf, far from the cause.
// ============================================================================

import { mkdir, writeFile, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(ROOT, 'assets/fonts')
const FORCE = process.argv.includes('--force')
const API = 'https://api.github.com/repos/google/fonts/contents'

/** file → family dir + the static face to look for + variable fallback. */
const WANTED = [
  {
    file: 'Newsreader-Light.ttf',
    dir: 'ofl/newsreader',
    match: /Newsreader(_\d+pt)?-Light\.ttf$/i,
    variable: /^Newsreader\[.*\]\.ttf$/i,
  },
  {
    file: 'Newsreader-LightItalic.ttf',
    dir: 'ofl/newsreader',
    match: /Newsreader(_\d+pt)?-LightItalic\.ttf$/i,
    variable: /^Newsreader-Italic\[.*\]\.ttf$/i,
  },
  {
    file: 'Newsreader-Regular.ttf',
    dir: 'ofl/newsreader',
    match: /Newsreader(_\d+pt)?-Regular\.ttf$/i,
    variable: /^Newsreader\[.*\]\.ttf$/i,
  },
  {
    file: 'InstrumentSans-Regular.ttf',
    dir: 'ofl/instrumentsans',
    match: /InstrumentSans(_\d+pt)?-Regular\.ttf$/i,
    variable: /^InstrumentSans\[.*\]\.ttf$/i,
  },
  {
    file: 'InstrumentSans-Medium.ttf',
    dir: 'ofl/instrumentsans',
    match: /InstrumentSans(_\d+pt)?-Medium\.ttf$/i,
    variable: /^InstrumentSans\[.*\]\.ttf$/i,
  },
  {
    file: 'InstrumentSans-SemiBold.ttf',
    dir: 'ofl/instrumentsans',
    match: /InstrumentSans(_\d+pt)?-SemiBold\.ttf$/i,
    variable: /^InstrumentSans\[.*\]\.ttf$/i,
  },
  {
    file: 'SpaceMono-Regular.ttf',
    dir: 'ofl/spacemono',
    match: /SpaceMono-Regular\.ttf$/i,
    variable: null,
  },
]

function looksLikeFont(buf) {
  if (buf.length < 4) return false
  const tag = buf.subarray(0, 4)
  return (
    tag.toString('hex') === '00010000' ||
    ['true', 'ttcf', 'OTTO'].includes(tag.toString('ascii'))
  )
}

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

const dirCache = new Map()

/** Every .ttf in a family dir, including its static/ subdir if present. */
async function listFamily(dir) {
  if (dirCache.has(dir)) return dirCache.get(dir)
  const out = []
  const get = async (path) => {
    const r = await fetch(`${API}/${path}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'millsuite-font-vendor' },
    })
    if (!r.ok) {
      if (r.status === 403) {
        console.error(
          `  ! GitHub API rate limit hit (60/hr unauthenticated). Wait an hour, or download ` +
            `the families by hand — see the note at the end.`,
        )
      }
      return []
    }
    return await r.json()
  }
  const top = await get(dir)
  if (!Array.isArray(top)) {
    dirCache.set(dir, out)
    return out
  }
  for (const e of top) {
    if (e.type === 'file' && /\.ttf$/i.test(e.name)) out.push(e)
    if (e.type === 'dir' && e.name === 'static') {
      const statics = await get(`${dir}/static`)
      if (Array.isArray(statics)) {
        for (const s of statics) if (s.type === 'file' && /\.ttf$/i.test(s.name)) out.push(s)
      }
    }
  }
  dirCache.set(dir, out)
  return out
}

async function download(entry, dest) {
  const r = await fetch(entry.download_url)
  if (!r.ok) return { ok: false, why: `${r.status}` }
  const buf = Buffer.from(await r.arrayBuffer())
  if (!looksLikeFont(buf)) return { ok: false, why: `200 but not a font (${buf.length}b)` }
  await writeFile(dest, buf)
  return { ok: true, kb: (buf.length / 1024).toFixed(0) }
}

async function main() {
  await mkdir(OUT, { recursive: true })
  console.log('Vendoring presentation-estimate fonts → assets/fonts/\n')

  let failed = 0
  let usedVariable = false
  const unmatchedDirs = new Set()

  for (const w of WANTED) {
    const dest = resolve(OUT, w.file)
    if (!FORCE && (await exists(dest))) {
      console.log(`  skip    ${w.file} (already vendored — --force to replace)`)
      continue
    }
    const files = await listFamily(w.dir)
    if (files.length === 0) {
      console.error(`  FAILED  ${w.file} — couldn't list ${w.dir}`)
      failed++
      continue
    }

    let entry = files.find((e) => w.match.test(e.name))
    let viaVariable = false
    if (!entry && w.variable) {
      entry = files.find((e) => w.variable.test(e.name))
      viaVariable = !!entry
    }
    if (!entry) {
      console.error(`  FAILED  ${w.file} — nothing in ${w.dir} matched`)
      unmatchedDirs.add(w.dir)
      failed++
      continue
    }

    const res = await download(entry, dest)
    if (!res.ok) {
      console.error(`  FAILED  ${w.file} — ${res.why}`)
      failed++
      continue
    }
    if (viaVariable) {
      usedVariable = true
      console.log(`  ok*     ${w.file}  ${res.kb}kb  ← VARIABLE ${entry.name} (weight collapses)`)
    } else {
      console.log(`  ok      ${w.file}  ${res.kb}kb  (${entry.name})`)
    }
  }

  // The listing is the thing that ends the guessing.
  for (const dir of unmatchedDirs) {
    const files = await listFamily(dir)
    console.error(`\n  ${dir} actually contains:`)
    for (const e of files) console.error(`      ${e.name}`)
  }

  console.log('')
  if (usedVariable) {
    console.log(
      '⚠️  One or more faces came from a VARIABLE file. They render, but every weight pins to\n' +
        '    the file\'s default instance — so Light/Medium/SemiBold will all look Regular and\n' +
        '    the design will read flatter than the mockup. For the real thing, download the\n' +
        '    family from fonts.google.com and use the static/ TTFs from the zip.\n',
    )
  }
  if (failed) {
    console.error(
      `${failed} font(s) missing. The estimate still renders — it falls back to Helvetica — but\n` +
        `it will NOT look like the approved mockup. Download the families from fonts.google.com\n` +
        `and drop the static TTFs into assets/fonts/ using exactly these names:\n` +
        WANTED.map((w) => `    ${w.file}`).join('\n'),
    )
    process.exit(1)
  }
  console.log('Fonts vendored. See the template as designed:')
  console.log('  npx tsx scripts/preview-presentation-estimate.tsx')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
