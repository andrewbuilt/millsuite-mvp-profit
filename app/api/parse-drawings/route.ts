// ============================================================================
// /api/parse-drawings — Claude-backed architectural-drawing parser
// ============================================================================
// Modeled after the millsuite-takeoff parser: send the PDF as a Claude document
// block, let the model return a structured JSON payload, then normalize into a
// shape the sales dashboard can render as role-tagged candidate chips.
//
// Lives server-side so the ANTHROPIC_API_KEY doesn't leak to the browser. The
// client posts base64-encoded PDF bytes; we return the parsed envelope.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300 // large drawing sets can take a while

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

For each item:
- name: short descriptive label (e.g. "Perimeter cabinets", "Island with seating")
- room: the room / zone (e.g. "Kitchen", "Master Bath", "Mudroom", "Powder Room"). Use the SAME exact string for all items in the same room so they group. "Other" if truly unknown.
- category: one of base_cabinet, upper_cabinet, full_height, vanity, countertop, panel, led, hardware, custom, other
- linear_feet: numeric LF from elevations rounded to 0.25, else null
- quantity: integer, usually 1
- notes: one short sentence of anything the shop needs to know (mixed heights, scribe conditions, integrated LED, appliance panels, etc.). Blank string if nothing.

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
      "linear_feet": 18.5,
      "quantity": 1,
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
    // 429/529 → retry once after a short backoff
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

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured on the server' },
        { status: 500 }
      )
    }

    const body = await req.json()
    const { base64_content, file_name, mime_type } = body || {}
    if (!base64_content || typeof base64_content !== 'string') {
      return NextResponse.json(
        { error: 'base64_content required' },
        { status: 400 }
      )
    }
    if (mime_type && mime_type !== 'application/pdf') {
      return NextResponse.json(
        { error: `unsupported mime type: ${mime_type}` },
        { status: 415 }
      )
    }

    // Rough size guard — base64 expands raw bytes ~1.33x.
    const approxBytes = Math.floor((base64_content.length * 3) / 4)
    if (approxBytes > 32 * 1024 * 1024) {
      return NextResponse.json(
        { error: `PDF too large (${(approxBytes / 1024 / 1024).toFixed(1)} MB). Max 32 MB.` },
        { status: 413 }
      )
    }

    const parsed = await callClaude(base64_content, apiKey)

    // Normalize the shape so the client can rely on it.
    const header = parsed.header || {}
    const rawItems = Array.isArray(parsed.items) ? parsed.items : []
    const items = rawItems.map((it: any) => ({
      name: typeof it.name === 'string' ? it.name : 'Item',
      room: typeof it.room === 'string' && it.room.trim() ? it.room.trim() : 'Other',
      category: typeof it.category === 'string' ? it.category : 'other',
      linear_feet: typeof it.linear_feet === 'number' ? it.linear_feet : null,
      quantity: typeof it.quantity === 'number' ? it.quantity : 1,
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
