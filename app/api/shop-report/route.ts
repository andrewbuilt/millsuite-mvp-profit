import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  try {
    const { org_id } = await req.json()
    if (!org_id) return NextResponse.json({ error: 'org_id required' }, { status: 400 })

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

    // Gather shop data
    const [
      { data: org },
      { data: projects },
      { data: timeEntries },
      { data: invoices },
      { data: settings },
    ] = await Promise.all([
      supabaseAdmin.from('orgs').select('*').eq('id', org_id).single(),
      supabaseAdmin.from('projects').select('id, name, status, bid_total, actual_total, created_at, sold_at, completed_at').eq('org_id', org_id),
      supabaseAdmin.from('time_entries').select('project_id, duration_minutes, created_at').eq('org_id', org_id),
      supabaseAdmin.from('invoices').select('project_id, total_amount, created_at').eq('org_id', org_id),
      supabaseAdmin.from('shop_rate_settings').select('*').eq('org_id', org_id).single(),
    ])

    const activeProjects = (projects || []).filter(p => p.status === 'active')
    const completedProjects = (projects || []).filter(p => p.status === 'complete')
    const biddingProjects = (projects || []).filter(p => p.status === 'bidding')

    // Build context for Claude
    const shopData = {
      shop_name: org?.name || 'Unknown',
      shop_rate: org?.shop_rate || 75,
      profit_margin: org?.profit_margin_pct || 35,
      consumable_markup: org?.consumable_markup_pct || 15,
      location: [org?.business_city, org?.business_state].filter(Boolean).join(', ') || 'Unknown',
      active_projects: activeProjects.map(p => {
        const laborMins = (timeEntries || []).filter(t => t.project_id === p.id).reduce((s, t) => s + t.duration_minutes, 0)
        const materialCost = (invoices || []).filter(i => i.project_id === p.id).reduce((s, i) => s + i.total_amount, 0)
        const actualCost = (laborMins / 60) * (org?.shop_rate || 75) + materialCost
        const margin = p.bid_total > 0 ? ((p.bid_total - actualCost) / p.bid_total) * 100 : 0
        return { name: p.name, bid: p.bid_total, actual: Math.round(actualCost), margin: Math.round(margin) }
      }),
      completed_projects: completedProjects.length,
      bidding_projects: biddingProjects.length,
      total_hours_logged: Math.round((timeEntries || []).reduce((s, t) => s + t.duration_minutes, 0) / 60),
      monthly_overhead: settings ? (
        (settings.monthly_rent || 0) + (settings.monthly_utilities || 0) +
        (settings.monthly_insurance || 0) + (settings.monthly_equipment || 0) +
        (settings.monthly_misc_overhead || 0)
      ) : 0,
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are a shop management consultant for custom millwork and cabinet shops. Give a brief, actionable shop health report based on this data. Be direct and specific — no fluff.

Shop Data:
${JSON.stringify(shopData, null, 2)}

Industry benchmarks:
- Typical shop rate for custom millwork: $65-$120/hr depending on region and quality tier
- Healthy project margin: 25-40%
- Red flag: any active project under 15% margin
- Overhead ratio: monthly overhead should be 30-45% of revenue

Format your response as:
1. **Shop Health** (1-2 sentences — overall assessment)
2. **In Production** (list active projects with status — on track, at risk, or over budget)
3. **Action Items** (2-3 specific things to do this week)
4. **Rate Check** (is their shop rate competitive for their market?)

Keep it under 300 words. Write like you're talking to the shop owner, not writing a report.`
        }],
      }),
    })

    const aiResponse = await response.json()
    const report = aiResponse.content?.[0]?.text || 'Unable to generate report'

    return NextResponse.json({ report })
  } catch (err: any) {
    console.error('Shop report error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
