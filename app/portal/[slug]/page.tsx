// /portal/[slug] — Public client portal. Password-gated, reads data via
// supabaseAdmin, shows project status stepper, selections with client sign-off,
// and a timeline of events. Drawings are NOT surfaced in the portal —
// drawing approvals happen in person or over email, direct from shop to client.

import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyPortalToken, getPortalData, PORTAL_STEPS, PORTAL_STEP_LABELS } from '@/lib/portal'
import PortalLogin from './portal-login'
import PortalView from './portal-view'

export const dynamic = 'force-dynamic'

export default async function PortalPage({
  params,
}: {
  params: Promise<{ slug: string }> | { slug: string }
}) {
  const resolved = await Promise.resolve(params)
  const slug = resolved.slug

  // Does this portal exist?
  const { data: exists } = await supabaseAdmin
    .from('projects')
    .select('id, name, client_name')
    .eq('portal_slug', slug)
    .single()

  if (!exists) {
    notFound()
  }

  // Check auth cookie
  const cookieStore = await cookies()
  const token = cookieStore.get(`portal_${slug}`)?.value
  const claims = token ? await verifyPortalToken(token) : null
  const authed = !!claims && claims.slug === slug && claims.sub === exists.id

  if (!authed) {
    return (
      <PortalLogin
        slug={slug}
        projectName={exists.name}
        clientName={exists.client_name}
      />
    )
  }

  // Authed — fetch full data
  const data = await getPortalData(slug)
  if (!data) notFound()

  return (
    <PortalView
      slug={slug}
      project={data.project}
      selections={data.selections as any[]}
      timeline={data.timeline as any[]}
      portalSteps={[...PORTAL_STEPS]}
      stepLabels={PORTAL_STEP_LABELS}
    />
  )
}
