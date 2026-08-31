// ============================================================================
// /portal/{token}/{projectId} — the project view
// ============================================================================
// Deliberately thin: resolve, load, hand off. All the markup is in
// components/portal/PortalProjectView so it can be rendered against fixture
// data for layout checks (the portal is unreachable locally without a live
// token and a migrated database).
//
// A React Server Component, not a client component talking to an API: the
// browser holds no Supabase key on this page, and there is no public GET
// endpoint to enumerate. loadPortalProject re-scopes the projectId to the
// token's client, so a valid token asking for someone else's project 404s.
// ============================================================================

import { notFound } from 'next/navigation'
import { loadPortalProject, loadPortalOrgName } from '@/lib/client-portal'
import { PortalProjectView } from '@/components/portal/PortalProjectView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const orgName = await loadPortalOrgName(token)
  return {
    title: orgName ? `${orgName} · Your project` : 'Project portal',
    robots: { index: false, follow: false },
  }
}

export default async function PortalProjectPage({
  params,
}: {
  params: Promise<{ token: string; projectId: string }>
}) {
  const { token, projectId } = await params
  const p = await loadPortalProject(token, projectId)
  if (!p) notFound()
  return <PortalProjectView token={token} p={p} />
}
