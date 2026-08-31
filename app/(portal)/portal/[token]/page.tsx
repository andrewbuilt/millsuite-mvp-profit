// ============================================================================
// /portal/{token} — the client's home screen
// ============================================================================
// Thin by design: resolve, load, hand off to components/portal/PortalHomeView.
//
// A React Server Component reading through lib/client-portal on the service
// role. Deliberately NOT a client component talking to an API:
//   • the browser never holds a Supabase key on this page, so there is no
//     surface to widen a query from;
//   • there is no public GET endpoint to enumerate — the only public entry
//     point is this page, and it can only ever render one client's data.
//
// The two WRITES (approve, sign) do go through POST routes, because they have
// to; they re-resolve the token server-side exactly like this page does.
// ============================================================================

import { notFound } from 'next/navigation'
import { loadPortalHome, loadPortalOrgName } from '@/lib/client-portal'
import { PortalHomeView } from '@/components/portal/PortalHomeView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const orgName = await loadPortalOrgName(token)
  return {
    // The client's shop, not ours — the root layout's MillSuite title would be
    // meaningless to them at best.
    title: orgName ? `${orgName} · Your projects` : 'Project portal',
    robots: { index: false, follow: false },
  }
}

export default async function PortalHomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const home = await loadPortalHome(token)
  if (!home) notFound()
  return <PortalHomeView token={token} home={home} />
}
