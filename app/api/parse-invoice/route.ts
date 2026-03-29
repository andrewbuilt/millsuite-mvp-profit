import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { file_url, base64_content, mime_type } = await req.json()

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const prompt =
      'Extract invoice data from this image/document. Return JSON with: vendor_name, invoice_number, invoice_date (YYYY-MM-DD), line_items (array of {description, quantity, unit_price, total}), total_amount. Only return the JSON, no markdown.'

    // Build the content array for Claude
    const content: any[] = []

    if (!base64_content) {
      return NextResponse.json({ error: 'No file content provided' }, { status: 400 })
    }

    const isPdf = mime_type === 'application/pdf'
    content.push({
      type: isPdf ? 'document' : 'image',
      source: {
        type: 'base64',
        media_type: mime_type || 'image/png',
        data: base64_content,
      },
    })

    content.push({ type: 'text', text: prompt })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'pdfs-2024-09-25',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('Anthropic API error:', response.status, errText)
      return NextResponse.json({ error: `AI extraction failed: ${response.status}` }, { status: 502 })
    }

    const result = await response.json()
    const text = result.content?.[0]?.text || ''

    // Parse the JSON from the response (handle possible markdown wrapping)
    let parsed
    try {
      const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      console.error('Failed to parse AI response:', text)
      return NextResponse.json({ error: 'Failed to parse invoice data', raw: text }, { status: 422 })
    }

    return NextResponse.json(parsed)
  } catch (err: any) {
    console.error('parse-invoice error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
