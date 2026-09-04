// ============================================================================
// scripts/upload-built-footer-mark.mjs — put the footer mark on prod
// ============================================================================
// Round 3 item B. Uploads the tinted footer mark (made by
// scripts/built-footer-mark.tsx) to the public org-logos bucket and points
// orgs.estimate_footer_logo_url at it. Requires migration 096 on prod — the
// script checks and tells you if it isn't.
//
// Preview by default; --apply to write.
//
//   npx tsx scripts/built-footer-mark.tsx
//   npx tsx scripts/upload-built-footer-mark.mjs [--slug built] [--file /tmp/built-footer-mark-1.png] --apply
// ============================================================================
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : process.argv[i + 1] ?? null
}
const slug = (arg('--slug') || 'built').trim().toLowerCase()
const file = arg('--file') || '/tmp/built-footer-mark-1.png'
const apply = process.argv.includes('--apply')

if (!fs.existsSync(file)) {
  console.error(`No file at ${file} — run: npx tsx scripts/built-footer-mark.tsx`)
  process.exit(1)
}

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

const { data: org, error: orgErr } = await sb
  .from('orgs')
  .select('id, name')
  .eq('slug', slug)
  .maybeSingle()
if (orgErr || !org) {
  console.error(`Org with slug "${slug}" not found${orgErr ? `: ${orgErr.message}` : ''}`)
  process.exit(1)
}

// 096 gate — the column read fails loudly here rather than a silent no-op
// update later (PostgREST would reject the update with the same 42703).
const { error: colErr } = await sb
  .from('orgs')
  .select('estimate_footer_logo_url')
  .eq('id', org.id)
  .maybeSingle()
if (colErr) {
  console.error('orgs.estimate_footer_logo_url is missing — run db/migrations/096_estimate_footer_logo.sql on prod first.')
  console.error(`(${colErr.message})`)
  process.exit(1)
}

const storagePath = `${org.id}/estimate-footer-mark.png`
const bytes = fs.readFileSync(file)
console.log(`Org: ${org.name} (${org.id})`)
console.log(`File: ${file} (${bytes.length.toLocaleString()} bytes)`)
console.log(`→ org-logos/${storagePath}`)
if (!apply) {
  console.log('\nPreview only. Re-run with --apply to upload and set the column.')
  process.exit(0)
}

const { error: upErr } = await sb.storage
  .from('org-logos')
  .upload(storagePath, bytes, { contentType: 'image/png', upsert: true })
if (upErr) {
  console.error(`Upload failed: ${upErr.message}`)
  process.exit(1)
}
const {
  data: { publicUrl },
} = sb.storage.from('org-logos').getPublicUrl(storagePath)
// Cache-bust the URL: the bucket path is stable across re-uploads (upsert), so
// a re-tinted mark would otherwise serve stale from the CDN inside PDFs.
const url = `${publicUrl}?v=${Date.now()}`

const { error: updErr } = await sb
  .from('orgs')
  .update({ estimate_footer_logo_url: url })
  .eq('id', org.id)
if (updErr) {
  console.error(`Column update failed: ${updErr.message}`)
  process.exit(1)
}
console.log(`\nDone. orgs.estimate_footer_logo_url = ${url}`)
