// ============================================================================
// /api/parse-drawings — Claude-backed architectural-drawing parser
// ============================================================================
// The browser uploads the PDF to the `parse-drawings` Supabase bucket first,
// then POSTs the storage path here. We read the bytes back with the service
// role (bypassing Vercel's 4.5 MB request-body ceiling), base64 them, and
// send them to Claude as a document block. The parsed JSON shape is normalized
// into the envelope the sales dashboard expects.
//
// We also accept the old shape — `{ base64_content }` — as a fallback so
// small PDFs (invoices, one-page proposals) keep working if the bucket path
// is missing.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const maxDuration = 300 // large drawing sets can take a while
export const runtime = 'nodejs'

const BUCKET = 'parse-drawings'

const SYSTEM_PROMPT = `You are a millwork takeoff specialist analyzing an architectural or interior-design drawing set for a custom cabinet / millwork shop. You pull BOTH the intake metadata AND the full shop scope (every distinct millwork item with specs) out of the drawings.

## WHAT TO PULL FOR THE PROJECT HEADER

- project_name: the project title from the title block (or null)
- client_name: the end client / homeowner / building name
- client_company: the client's company if it's a commercial job (else null)
- designer_name: interior designer or design firm (from title block / "Designed by")
- gc_name: general contractor (from title block / "GC" / "Contractor")
- address: the job-site street address (street, city, state, zip when present)
- email, phone: any contacts in the title block
- estimated_price: a single scope dollar amount if the drawings include a contract or quote total (else null)
- date: the drawing set date / issue date (else null)

## SCOPE — GROUPING RULES (think like a shop, not a drafter)

- Group items by INSTALLATION ZONE. A continuous wall run of base + uppers + pantry in the same room = ONE item, not three.
- Split when items are in different rooms, different floors, or truly independent freestanding pieces.
- A typical room yields 1–3 items, not 5–10. Do NOT split into left tower / center / right tower.
- For a mixed wall run (base + uppers together), use category "base_cabinet" and mention the uppers in features.notes.

## CATEGORIES — use one of these exact strings:
- base_cabinet     — floor-mounted base cabinets (perimeter runs, vanities with no uppers)
- upper_cabinet    — wall-hung uppers only (pulled out when there's no base on the same wall)
- full_height      — pantries, floor-to-ceiling towers, tall built-ins
- vanity           — bathroom vanities
- drawer_box       — standalone drawer boxes (rare, usually covered under a cabinet)
- countertop       — wood countertops / bench tops / table tops the shop fabricates (NOT stone)
- panel            — end panels, appliance panels, refrigerator panels, decorative skins
- scribe           — scribe strips
- led              — integrated LED lighting
- hardware         — specialty hardware line items
- custom           — one-off pieces that don't fit
- other            — catch-all

## QUALITY — use one of: standard, premium, custom, unspecified

## FIELDS PER SCOPE ITEM

- name              — descriptive, e.g. "Perimeter cabinets", "Master closet built-in" (do NOT repeat the room in the name)
- room              — the room / zone this item lives in. Use the SAME exact string for all items in the same room so they group. "Other" if truly unknown.
- category          — from list above
- item_type         — e.g. "frameless", "face_frame", "floating shelves" (null if unclear)
- quality           — from list above
- linear_feet       — numeric LF from elevation dimensions, rounded to 0.25. null if unknown.
- quantity          — integer, usually 1
- features          — object (ALL fields — use defaults when unknown, drawer_count is REQUIRED):
    - drawer_count         (integer, REQUIRED, count every drawer visible, 0 if none, NEVER null)
    - door_style           (e.g. "slab", "shaker", or null)
    - soft_close           (boolean, null if unspecified)
    - hinge_type           (e.g. "concealed_110", or null)
    - slide_type           (e.g. "undermount_soft_close", or null)
    - adjustable_shelves   (integer, 0 if none, null if unknown)
    - rollout_trays        (integer, 0 if none)
    - lazy_susan           (boolean)
    - trash_pullout        (boolean)
    - has_led              (boolean)
    - notes                (string — mention sections included, mixed heights, scribe conditions)
- material_specs — object (null fields OK when genuinely not in drawings):
    - exterior_species     (e.g. "white_oak", "walnut", "painted_mdf")
    - exterior_thickness   (e.g. "3/4")
    - interior_material    (e.g. "prefinished_maple", "white_melamine")
    - interior_thickness   (e.g. "1/2")
    - back_material        (e.g. "melamine")
    - back_thickness       (e.g. "1/4")
    - edgeband             (e.g. "matching", "pvc")
- hardware_specs — object:
    - hinges   { type, count }     — count is total hinges for this item
    - slides   { type, count, length }  — count is total drawers on this item
    - pulls    { type, count, size }    — count is total door+drawer pulls
    - specialty []                  — array of { type, count } for lazy susans, trash pullouts, LED strips, etc.
- finish_specs — object:
    - finish_type     (e.g. "stain_and_lacquer", "paint", "clear_lacquer")
    - stain_color     (e.g. "natural", "walnut")
    - sheen           (e.g. "satin", "matte", "semi-gloss")
    - sides_to_finish ("exterior_only" | "all_sides")
    - notes           (string)
- parser_confidence — 0.0 to 1.0 — your confidence that this item's fields are correct
- needs_review      — true if ANY field is uncertain (missing dimensions, ambiguous finish, inferred drawer count, mixed heights where you guessed the category, site-dependent conditions)
- source_sheet      — the sheet number / name this item came from (e.g. "A-3", "Sheet 5")

## PRICING GUIDANCE

Do NOT populate a price on items. The MVP's rate book handles pricing downstream — your job is to extract specs accurately so the rate book can match.

## WHAT TO FLAG AS needs_review=true

- Missing or illegible linear_feet
- Finish not specified or ambiguous
- Drawer count inferred rather than counted
- Mixed heights in one run where you had to pick between base_cabinet and full_height
- Site-dependent conditions (sloped ceilings, scribe conditions)

## WHAT "BY OTHERS" LOOKS LIKE — DO NOT extract these:

- Stone, quartz, marble countertops (NOT shop scope)
- Appliances
- Plumbing fixtures
- Lighting fixtures (unless integrated LED on a cabinet)
- Crown molding (unless explicitly called out as millwork scope)

## RESPONSE FORMAT

Return ONLY a valid JSON object — no markdown, no preamble. Start with { and end with }.

{
  "project_name": "string or null",
  "scope_summary": "2-3 sentence overview of the full millwork scope",
  "header": {
    "client_name": "... or null",
    "client_company": "... or null",
    "designer_name": "... or null",
    "gc_name": "... or null",
    "address": "... or null",
    "email": "... or null",
    "phone": "... or null",
    "estimated_price": number or null,
    "date": "... or null"
  },
  "rooms": ["Kitchen", "Master Bath", ...],
  "items": [
    {
      "name": "Perimeter cabinets",
      "room": "Kitchen",
      "category": "base_cabinet",
      "item_type": "frameless",
      "quality": "standard",
      "linear_feet": 18.5,
      "quantity": 1,
      "features": {
        "drawer_count": 6,
        "door_style": "shaker",
        "soft_close": true,
        "hinge_type": "concealed_110",
        "slide_type": "undermount_soft_close",
        "adjustable_shelves": 4,
        "rollout_trays": 0,
        "lazy_susan": false,
        "trash_pullout": true,
        "has_led": false,
        "notes": "Includes uppers above sink wall"
      },
      "material_specs": {
        "exterior_species": "white_oak",
        "exterior_thickness": "3/4",
        "interior_material": "prefinished_maple",
        "interior_thickness": "1/2",
        "back_material": "white_melamine",
        "back_thickness": "1/4",
        "edgeband": "matching"
      },
      "hardware_specs": {
        "hinges": { "type": "concealed_110", "count": 14 },
        "slides": { "type": "undermount_soft_close", "count": 6, "length": "21\\"" },
        "pulls": { "type": "bar", "count": 20, "size": "6\\"" },
        "specialty": [{ "type": "trash_pullout", "count": 1 }]
      },
      "finish_specs": {
        "finish_type": "stain_and_lacquer",
        "stain_color": "natural",
        "sheen": "satin",
        "sides_to_finish": "exterior_only",
        "notes": ""
      },
      "parser_confidence": 0.85,
      "needs_review": false,
      "source_sheet": "A-3"
    }
  ]
}

If a field is unknown, use null — NEVER fabricate. drawer_count and needs_review are REQUIRED on every item. "rooms" is the de-duplicated list of rooms across all items, preserving drawing order.`

const USER_PROMPT = `Analyze this drawing set and return the JSON described in the system prompt.

Remember:
- Group by installation zone (one wall run = one item).
- drawer_count is REQUIRED — count every drawer visible, use 0 if none, NEVER null.
- Set needs_review: true if you're uncertain about any field.
- Return ONLY valid JSON. No markdown. Start with { and end with }.`

function extractJSON(raw: string): any {
  let text = raw.trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) text = fence[1].trim()
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || first >= last) {
    throw new Error('No JSON object in response')
  }
  text = text.substring(first, last + 1)
  // Strip trailing commas which the model occasionally leaves in.
  text = text.replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(text)
}

async function callClaude(base64: string, apiKey: string, retries = 1): Promise<any> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 12000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64,
              },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    if ((resp.status === 429 || resp.status === 529) && retries > 0) {
      await new Promise((r) => setTimeout(r, 2000))
      return callClaude(base64, apiKey, retries - 1)
    }
    throw new Error(`Anthropic ${resp.status}: ${body.slice(0, 300)}`)
  }

  const json = await resp.json()
  const text = json.content?.[0]?.text || ''
  try {
    return extractJSON(text)
  } catch (err) {
    if (retries > 0) {
      console.warn('parse-drawings: JSON parse failed, retrying once')
      return callClaude(base64, apiKey, retries - 1)
    }
    console.error('parse-drawings: parse failed, first 400 chars:', text.slice(0, 400))
    throw err
  }
}

/** Fetch the PDF from Supabase storage and return it as base64. */
async function fetchFromStorage(storagePath: string): Promise<string> {
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(storagePath)
  if (error || !data) {
    throw new Error(`Storage download failed: ${error?.message || 'no data'}`)
  }
  const buf = Buffer.from(await data.arrayBuffer())
  return buf.toString('base64')
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured on the server' },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const { storage_path, base64_content, file_name, mime_type } = body || {}

    if (mime_type && mime_type !== 'application/pdf') {
      return NextResponse.json(
        { error: `unsupported mime type: ${mime_type}` },
        { status: 415 }
      )
    }

    // Resolve the PDF to base64 — either read it from storage (preferred, any
    // size) or accept it inline (legacy small-file path).
    let base64: string
    if (typeof storage_path === 'string' && storage_path.length > 0) {
      try {
        base64 = await fetchFromStorage(storage_path)
      } catch (err: any) {
        return NextResponse.json(
          { error: err?.message || 'storage read failed' },
          { status: 500 }
        )
      }
    } else if (typeof base64_content === 'string' && base64_content.length > 0) {
      const approxBytes = Math.floor((base64_content.length * 3) / 4)
      if (approxBytes > 32 * 1024 * 1024) {
        return NextResponse.json(
          {
            error: `PDF too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Upload via storage_path instead.`,
          },
          { status: 413 }
        )
      }
      base64 = base64_content
    } else {
      return NextResponse.json(
        { error: 'storage_path or base64_content required' },
        { status: 400 }
      )
    }

    const parsed = await callClaude(base64, apiKey)

    // ── Normalize item shape so the client can rely on it ────────────────────
    // We keep this permissive — Claude occasionally omits a nested object or
    // swaps a null for an empty value. Anything missing comes through as null
    // / empty object / sensible default, NEVER undefined, so the DB jsonb
    // columns downstream are predictable.
    const VALID_CATEGORIES = new Set([
      'base_cabinet', 'upper_cabinet', 'full_height', 'vanity',
      'drawer_box', 'countertop', 'panel', 'scribe',
      'led', 'hardware', 'custom', 'other',
    ])
    const VALID_QUALITIES = new Set(['standard', 'premium', 'custom', 'unspecified'])

    const obj = (v: any): Record<string, any> =>
      v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    const arr = (v: any): any[] => (Array.isArray(v) ? v : [])
    const str = (v: any): string | null =>
      typeof v === 'string' && v.trim() ? v.trim() : null
    const num = (v: any): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null
    const int = (v: any, fallback = 0): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback
    const bool = (v: any): boolean | null =>
      typeof v === 'boolean' ? v : null

    const normalizeHardwareSpec = (v: any) => {
      const o = obj(v)
      return {
        type: str(o.type),
        count: num(o.count),
        length: str(o.length),
        size: str(o.size),
      }
    }

    const header = obj(parsed.header)
    const rawItems = arr(parsed.items)
    const items = rawItems.map((it: any) => {
      const f = obj(it.features)
      const m = obj(it.material_specs)
      const hw = obj(it.hardware_specs)
      const fs = obj(it.finish_specs)
      return {
        name: str(it.name) || 'Item',
        room: str(it.room) || 'Other',
        category: VALID_CATEGORIES.has(it.category) ? it.category : 'other',
        item_type: str(it.item_type),
        quality: VALID_QUALITIES.has(it.quality) ? it.quality : 'unspecified',
        linear_feet: num(it.linear_feet),
        quantity: typeof it.quantity === 'number' && it.quantity > 0
          ? Math.round(it.quantity) : 1,
        features: {
          drawer_count: int(f.drawer_count, 0),
          door_style: str(f.door_style),
          soft_close: bool(f.soft_close),
          hinge_type: str(f.hinge_type),
          slide_type: str(f.slide_type),
          adjustable_shelves: num(f.adjustable_shelves),
          rollout_trays: num(f.rollout_trays),
          lazy_susan: bool(f.lazy_susan) ?? false,
          trash_pullout: bool(f.trash_pullout) ?? false,
          has_led: bool(f.has_led) ?? false,
          notes: typeof f.notes === 'string' ? f.notes : '',
        },
        material_specs: {
          exterior_species: str(m.exterior_species),
          exterior_thickness: str(m.exterior_thickness),
          interior_material: str(m.interior_material),
          interior_thickness: str(m.interior_thickness),
          back_material: str(m.back_material),
          back_thickness: str(m.back_thickness),
          edgeband: str(m.edgeband),
        },
        hardware_specs: {
          hinges: normalizeHardwareSpec(hw.hinges),
          slides: normalizeHardwareSpec(hw.slides),
          pulls: normalizeHardwareSpec(hw.pulls),
          specialty: arr(hw.specialty).map(normalizeHardwareSpec),
        },
        finish_specs: {
          finish_type: str(fs.finish_type),
          stain_color: str(fs.stain_color),
          sheen: str(fs.sheen),
          sides_to_finish: fs.sides_to_finish === 'all_sides'
            ? 'all_sides' : 'exterior_only',
          notes: typeof fs.notes === 'string' ? fs.notes : '',
        },
        parser_confidence: num(it.parser_confidence),
        needs_review: it.needs_review === true,
        source_sheet: str(it.source_sheet),
        // Back-compat with the old lightweight shape (sales UI still reads this).
        notes: typeof it.notes === 'string' ? it.notes
          : (typeof f.notes === 'string' ? f.notes : ''),
      }
    })

    // De-dupe rooms off the items list; fall back to parsed.rooms if items empty.
    const roomSet = new Set<string>()
    const rooms: string[] = []
    for (const it of items) {
      if (!roomSet.has(it.room)) {
        roomSet.add(it.room)
        rooms.push(it.room)
      }
    }
    if (rooms.length === 0 && Array.isArray(parsed.rooms)) {
      for (const r of parsed.rooms) {
        if (typeof r === 'string' && r.trim() && !roomSet.has(r)) {
          roomSet.add(r)
          rooms.push(r.trim())
        }
      }
    }

    // Fire-and-forget cleanup of the storage object.
    if (typeof storage_path === 'string' && storage_path.length > 0) {
      supabaseAdmin.storage
        .from(BUCKET)
        .remove([storage_path])
        .catch((err) => console.warn('parse-drawings: cleanup failed', err))
    }

    return NextResponse.json({
      project_name: typeof parsed.project_name === 'string' ? parsed.project_name : null,
      scope_summary: typeof parsed.scope_summary === 'string' ? parsed.scope_summary : null,
      file_name: typeof file_name === 'string' ? file_name : null,
      header: {
        client_name: header.client_name || null,
        client_company: header.client_company || null,
        designer_name: header.designer_name || null,
        gc_name: header.gc_name || null,
        address: header.address || null,
        email: header.email || null,
        phone: header.phone || null,
        estimated_price:
          typeof header.estimated_price === 'number' ? header.estimated_price : null,
        date: header.date || null,
      },
      rooms,
      items,
    })
  } catch (err: any) {
    console.error('parse-drawings error:', err)
    return NextResponse.json(
      { error: err?.message || 'parse failed' },
      { status: 500 }
    )
  }
}
