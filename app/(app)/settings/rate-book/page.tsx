'use client'

// ============================================================================
// Rate Book — PLACEHOLDER
// ============================================================================
// The old two-screen rate book (this page + /settings/rate-book/items) was
// killed in Phase 0. The real rate book lives under /rate-book (top-level,
// not in settings) and is built in Phase 1 per BUILD-ORDER.md.
//
// This placeholder exists so any lingering nav link or bookmark doesn't 404
// during the cleanup window. Delete this file once the Phase 1 rate book
// ships and all links are updated.
// ============================================================================

import Link from 'next/link'
import Nav from '@/components/nav'
import { ArrowRight } from 'lucide-react'

export default function RateBookSettingsRedirect() {
  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <Nav />
      <div className="max-w-2xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-semibold text-[#111] mb-3">
          Rate book moved
        </h1>
        <p className="text-sm text-[#6B7280] mb-8">
          The rate book is no longer in settings. It's a first-class tool now.
        </p>
        <Link
          href="/rate-book"
          className="inline-flex items-center gap-2 px-5 py-3 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] transition-colors"
        >
          Go to rate book
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  )
}
