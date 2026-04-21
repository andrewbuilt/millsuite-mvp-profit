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

const SYSTEM_PROMPT = `You are a millwork takeoff specialist reviewing an architectural or interior-design drawing set for a custom cabinet / millwork shop. Pull the intake metadata AND the shop scope out of the drawings.

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

## WHAT TO PULL FOR SCOPE (one entry per INSTALLATION ZONE)

Group by installation zone — a continuous wall run of base + upper + pantry in the same room = ONE item, not three. A typical room yields 1–3 items, not 5–10. Split across rooms, floors, and freestanding pieces.

### Categories — use one of these exact strings
- base_cabinet     — floor-mounted base cabinets (perimeter runs, vanities with no uppers)
- upper_cabinet    — wall-hung uppers only (no base on the same wall)
- full_height      — pantries, floor-to-ceiling towers, tall built-ins
- vanity           — bathroom vanities
- drawer_box       — standalone drawer boxes (rare)
- countertop       — wood countertops / bench tops / table tops the shop fabricates (NOT stone)
- panel            — end panels, appliance panels, refrigerator panels, decorative skins
- scribe           — scribe strips
- led              — integrated LED lighting
- hardware         — specialty hardware line items
- custom           — one-off pieces that don't fit
- other            — catch-all

For a mixed wall run (base + uppers together), use "base_cabinet" and mention the uppers in features.notes. Don't split them.

### Fields per item
- name              — short descriptive label, don't repeat the room in the name
- room              — same exact string for all items in the same room
- category          — from list above
- item_type         — e.g. "frameless", "face_frame", "floating shelves" (null if unclear)
- quality           — one of: standard, premium, custom, unspecified
- linear_feet       — numeric LF from elevations rounded to 0.25, else null
- quantity          — integer, usually 1
- features (object — include every key; null for unknown):
    - drawer_count         (integer, REQUIRED — count visible, 0 if none, NEVER null)
    - door_style           (e.g. "slab", "shaker")
    - soft_close           (boolean)
    - hinge_type           (e.g. "concealed_110")
    - slide_type           (e.g. "undermount_soft_close")
    - adjustable_shelves   (integer)
    - rollout_trays        (integer)
    - lazy_susan           (boolean)
    - trash_pullout        (boolean)
    - has_led              (boolean)
    - notes                (string — anything the shop needs to know: mixed heights, scribe conditions, appliance panels, etc.)
- material_specs (object):
    - exterior_species     (e.g. "white_oak", "walnut", "painted_mdf")
    - exterior_thickness   (e.g. "3/4")
    - interior_material    (e.g. "prefinished_maple", "white_melamine")
    - interior_thickness   (e.g. "1/2")
    - back_material        (e.g. "melamine")
    - back_thickness       (e.g. "1/4")
    - edgeband             (e.g. "matching", "pvc")
- finish_specs (object):
    - finish_type     (e.g. "stain_and_lacquer", "paint", "clear_lacquer")
    - stain_color     (e.g. "natural", "walnut")
    - sheen           (e.g. "satin", "matte", "semi-gloss")
    - sides_to_finish ("exterior_only" | "all_sides")
    - notes           (string)
- source_sheet      — sheet number this item came from (e.g. "A-3", "Sheet 5")
- needs_review      — true if ANY field is uncertain (missing dimensions, ambiguous finish, inferred drawer count, mixed heights)
- notes             — one short sentence on top-level (optional — features.notes is primary)

Do NOT extract stone/quartz countertops, appliances, plumbing, lighting fixtures that aren't integrated LED, or trim packages that aren't shop scope.

## RESPONSE FORMAT

Return ONLY a valid JSON object — no markdown, no preamble. Start with { and end with }.

{
  "project_name": "string or null",
  "scope_summary": "2-3 sentence overview",
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
      "features": { "drawer_count": 8, "door_style": "shaker", "soft_close": true, "hinge_type": null, "slide_type": null, "adjustable_shelves": 6, "rollout_trays": 0, "lazy_susan": false, "trash_pullout": true, "has_led": true, "notes": "includes 10 LF of uppers on the same wall" },
      "material_specs": { "exterior_species": "white_oak", "exterior_thickness": "3/4", "interior_material": "prefinished_maple", "interior_thickness": "1/2", "back_material": "melamine", "back_thickness": "1/4", "edgeband": "matching" },
      "finish_specs": { "finish_type": "clear_lacquer", "stain_color": "natural", "sheen": "matte", "sides_to_finish": "all_sides", "notes": "" },
      "source_sheet": "A-3",
      "needs_review": false,
      "notes": ""
    }
  ]
}

If a field is unknown, use null — never fabricate. "rooms" is the de-duplicated list of rooms across all items, preserving drawing order.`

const USER_PROMPT = `Analyze this drawing set and return the JSON described in the system prompt. One item per installation zone. Group by room. Return ONLY the JSON.`

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

    // Normalize the shape so the client can rely on it. Every rich sub-object
    // (features / material_specs / finish_specs) passes through as-is so the
    // sales flow can seed an estimate line per item with real spec payload.
    const header = parsed.header || {}
    const rawItems = Array.isArray(parsed.items) ? parsed.items : []
    const items = rawItems.map((it: any) => ({
      name: typeof it.name === 'string' ? it.name : 'Item',
      room: typeof it.room === 'string' && it.room.trim() ? it.room.trim() : 'Other',
      category: typeof it.category === 'string' ? it.category : 'other',
      item_type: typeof it.item_type === 'string' ? it.item_type : null,
      quality: typeof it.quality === 'string' ? it.quality : 'unspecified',
      linear_feet: typeof it.linear_feet === 'number' ? it.linear_feet : null,
      quantity: typeof it.quantity === 'number' ? it.quantity : 1,
      features: it.features && typeof it.features === 'object' ? it.features : null,
      material_specs: it.material_specs && typeof it.material_specs === 'object' ? it.material_specs : null,
      finish_specs: it.finish_specs && typeof it.finish_specs === 'object' ? it.finish_specs : null,
      source_sheet: typeof it.source_sheet === 'string' ? it.source_sheet : null,
      needs_review: !!it.needs_review,
      notes: typeof it.notes === 'string' ? it.notes : '',
    }))

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
