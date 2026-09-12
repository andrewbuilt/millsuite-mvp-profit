'use client'

// ============================================================================
// AiShopReport — the "Generate Report" card.
// ============================================================================
// Moved here from /dashboard 2026-09-12 (home-consolidation item 1): it's a
// report, and it now sits with the other reports instead of on a page that is
// about to stop existing.
//
// ⛔ THE REQUEST MUST CARRY THE ACCESS TOKEN. /api/shop-report used to take
// `org_id` from the body with no auth whatsoever; it now derives the org from
// the Bearer token and ignores the body. A fetch without this header gets a
// 401, which is the point — see the header of the route.
// ============================================================================

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function AiShopReport() {
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)

  async function generate() {
    setLoading(true)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch('/api/shop-report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        // No org_id: the route reads it off the token. Sending one would be
        // ignored, and pretending otherwise invites someone to "fix" it.
        body: JSON.stringify({}),
      })
      const data = await res.json()
      setReport(data.report || data.error || 'Failed to generate report')
    } catch {
      setReport('Failed to generate report')
    }
    setLoading(false)
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-[#E5E7EB] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#D97706]" />
          <h2 className="text-base font-semibold">AI Shop Report</h2>
        </div>
        <button
          onClick={generate}
          disabled={loading}
          className="px-4 py-1.5 bg-[#2563EB] text-white text-xs font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
        >
          {loading ? 'Analyzing...' : 'Generate Report'}
        </button>
      </div>
      {report ? (
        <div className="px-6 py-4 text-sm text-[#374151] leading-relaxed whitespace-pre-wrap prose prose-sm max-w-none">
          {report.split('\n').map((line, i) => {
            if (line.startsWith('**') && line.endsWith('**')) {
              return (
                <p key={i} className="font-semibold text-[#111] mt-3 mb-1">
                  {line.replace(/\*\*/g, '')}
                </p>
              )
            }
            if (line.match(/^\d+\.\s\*\*/)) {
              return (
                <p key={i} className="font-semibold text-[#111] mt-4 mb-1">
                  {line.replace(/\*\*/g, '')}
                </p>
              )
            }
            if (line.startsWith('- ') || line.startsWith('• ')) {
              return (
                <p key={i} className="ml-4 text-[#4B5563]">
                  {line}
                </p>
              )
            }
            if (line.trim()) {
              return (
                <p key={i} className="text-[#4B5563]">
                  {line}
                </p>
              )
            }
            return null
          })}
        </div>
      ) : (
        <div className="px-6 py-8 text-center text-sm text-[#9CA3AF]">
          Click &ldquo;Generate Report&rdquo; for an AI-powered analysis of your shop health,
          project status, and actionable insights.
        </div>
      )}
    </div>
  )
}
