// ============================================================================
// scripts/preview-standard-docs.tsx — render the STANDARD estimate + CO PDFs
// ============================================================================
//   npx tsx scripts/preview-standard-docs.tsx <label>
//   → $TMPDIR/stdpdf/<label>/{est-0036,bonzer-co,no-logo-est}.pdf + page PNGs
//
// READ ONLY against prod (.env.local service key): it loads REAL documents and
// renders them through the current components, writing nothing back.
//
//   est-0036     Built's EST-0036 (COS · Systems), from its stored estimate_snapshot_json —
//                exactly what the PDF route would re-render.
//   bonzer-co    the Bonzer change order, items mapped the way
//                app/api/co-docs/[id]/pdf/route.ts maps them (detail off).
//   no-logo-est  EST-0036's content under an org WITHOUT a logo (the first
//                one found, e.g. the Bayside demo) — proves the org-name
//                heading still prints when there's no wordmark.
//
// Run it with a label before and after touching EstimatePdf / CoDocPdf and
// LOOK at both — react-pdf compiles happily while the page reads badly.
// ============================================================================
import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import React from 'react'
;(globalThis as any).React = React
import { renderToFile } from '@react-pdf/renderer'
import { createClient } from '@supabase/supabase-js'

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  if (!line.includes('=')) continue
  const k = line.slice(0, line.indexOf('=')).trim()
  if (!process.env[k]) process.env[k] = line.slice(line.indexOf('=') + 1).trim()
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const label = process.argv[2] || 'preview'
const outDir = path.join(process.env.TMPDIR || os.tmpdir(), 'stdpdf', label)
fs.mkdirSync(outDir, { recursive: true })

const ORG_COLS =
  'id, name, logo_url, business_address, business_city, business_state, business_zip, business_phone, business_email, estimate_footer_text, estimate_closing_note'

async function main() {
  const { EstimatePdf } = await import('../components/estimates/EstimatePdf')
  const { CoDocPdf } = await import('../components/changeorders/CoDocPdf')

  // ── EST-0036 ──
  const { data: est } = await sb
    .from('projects')
    .select('id, name, org_id, client_id, client_name, estimate_snapshot_json')
    .eq('estimate_number', 'EST-0036')
    // Three COS copies share EST-0036 (the copy carried the number); this is
    // the one with the ×5 / ×7 lines from Andrew's screenshots.
    .eq('name', 'COS - Millwork · Systems (Back of House)')
    .single()
  if (!est?.estimate_snapshot_json) throw new Error('EST-0036 has no snapshot')
  const snap: any = est.estimate_snapshot_json
  const { data: org } = await sb.from('orgs').select(ORG_COLS).eq('id', est.org_id).single()
  const { data: cli } = est.client_id
    ? await sb.from('clients').select('name, address, email, phone').eq('id', est.client_id).single()
    : { data: null }
  const client = cli
    ? { name: cli.name, address: cli.address ?? null, email: cli.email ?? null, phone: cli.phone ?? null }
    : est.client_name
      ? { name: est.client_name, address: null, email: null, phone: null }
      : null
  const estProps = (o: any) => ({
    estimateNumber: snap.estimateNumber,
    estimateDate: snap.estimateDate,
    validUntil: null,
    org: o,
    project: { name: est.name },
    client,
    lines: snap.lineItems,
    schedule: snap.schedule || [],
    totals: snap.totals,
    terms: snap.terms ?? o.estimate_footer_text ?? null,
    closingNote: o.estimate_closing_note ?? null,
  })
  await renderToFile(<EstimatePdf {...(estProps(org) as any)} />, path.join(outDir, 'est-0036.pdf'))

  // ── No-logo org, same content ──
  const { data: plain } = await sb.from('orgs').select(ORG_COLS).is('logo_url', null).limit(1)
  if (plain?.[0]) {
    await renderToFile(<EstimatePdf {...(estProps(plain[0]) as any)} />, path.join(outDir, 'no-logo-est.pdf'))
  }

  // ── Bonzer CO ──
  // Several projects match "Bonzer"; take the newest CO doc across all of them.
  const { data: bps } = await sb
    .from('projects')
    .select('id, name, org_id, client_id, client_name, bid_total')
    .ilike('name', '%Bonzer%')
  const { data: docs } = await sb
    .from('co_docs')
    .select('*')
    .in('project_id', (bps || []).map((p: any) => p.id))
    .order('created_at', { ascending: false })
  const doc: any = docs?.[0]
  const bp: any = doc ? (bps || []).find((p: any) => p.id === doc.project_id) : null
  if (!doc) console.warn('no Bonzer CO doc found — skipping bonzer-co')
  if (doc) {
    const { data: rows } = await sb.from('co_doc_items').select('*').eq('doc_id', doc.id).order('sort_order')
    const subIds = (rows || []).map((r: any) => r.subproject_id).filter(Boolean)
    const subNames = new Map<string, string>()
    if (subIds.length) {
      const { data: subs } = await sb.from('subprojects').select('id, name').in('id', subIds)
      for (const s of subs || []) subNames.set((s as any).id, (s as any).name)
    }
    const items = (rows || []).map((r: any) => {
      const draft = r.draft || {}
      let description = r.description || null
      if (r.kind === 'add_sub' && description === `Add ${draft.name}`) description = null
      return {
        kind: r.kind,
        headline: r.kind === 'add_sub' ? draft.name || 'New scope' : subNames.get(r.subproject_id) || 'Scope',
        description,
        delta: Number(r.delta_amount) || 0,
        lines: undefined,
      }
    })
    const netChange = items.reduce((s: number, i: any) => s + i.delta, 0)
    const stored = Number(bp!.bid_total) || 0
    const { data: borg } = await sb.from('orgs').select(ORG_COLS).eq('id', bp!.org_id).single()
    await renderToFile(
      <CoDocPdf
        {...({
          coNumber: `CO-${String(doc.number ?? 0).padStart(2, '0')}`,
          coDate: (doc.accepted_at || new Date().toISOString()).slice(0, 10),
          org: borg,
          project: { name: bp!.name },
          client: bp!.client_name ? { name: bp!.client_name, address: null, email: null, phone: null } : null,
          title: doc.title ?? null,
          items,
          contractBefore: doc.status === 'accepted' ? stored - netChange : stored,
          netChange,
          signature: null,
        } as any)}
      />,
      path.join(outDir, 'bonzer-co.pdf'),
    )
  }

  for (const f of fs.readdirSync(outDir).filter((f) => f.endsWith('.pdf'))) {
    execSync(`pdftoppm -png -r 80 "${path.join(outDir, f)}" "${path.join(outDir, f.replace('.pdf', ''))}"`)
  }
  console.log(outDir)
  for (const f of fs.readdirSync(outDir).sort()) console.log('  ' + f)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
