// ============================================================================
// /p/{token} — the B2B pre-approval portal (migration 135)
// ============================================================================
// PUBLIC BY LINK: the token is the only credential, there is no login, and a
// token that matches nothing is a plain 404 (never "wrong token" vs "no such
// project" — a stranger must not be able to tell them apart).
//
// A React Server Component reading on the SERVICE ROLE through
// lib/preapproval-portal: the browser holds no Supabase key on this page, the
// anon key has no grant on any table behind it, and there is no public GET
// endpoint to enumerate.
//
// ⛔ Never renders pricing, margins, payments, internal notes, or team data
// beyond the one PM contact — the payload type (lib/preapproval-view) has no
// field for any of them.
// ============================================================================

import { notFound } from 'next/navigation'
import { loadPortalTabTitle, loadPreapprovalPortal } from '@/lib/preapproval-portal'
import { PreapprovalPortalLive } from '@/components/preapproval/PreapprovalPortalLive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const orgName = await loadPortalTabTitle(token)
  return {
    title: orgName ? `${orgName} · Project approvals` : 'Project approvals',
    robots: { index: false, follow: false },
    referrer: 'no-referrer' as const,
  }
}

export default async function PreapprovalPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const p = await loadPreapprovalPortal(token)
  if (!p) notFound()
  return <PreapprovalPortalLive token={token} p={p} />
}
