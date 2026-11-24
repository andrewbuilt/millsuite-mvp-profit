// ============================================================================
// /api/preapproval/{projectId} — the SHOP's side of the B2B approval portal
// ============================================================================
// Bearer-authenticated; the project is re-checked against the caller's org on
// every call (404 either way — never reveal another shop's project id).
//
//   GET  → the portal link (if one exists), and the notify-first queue: what
//          changed since the last "updates sent" stamp, plus the prefilled
//          email. ⛔ NOTHING IS SENT FROM HERE. There is no SMTP in v1 — a
//          human clicks a mailto: and this route only stamps that they did.
//   POST → { action: 'link' }      mint a link if there isn't one
//          { action: 'reissue' }   new token; every link already sent dies
//          { action: 'notified' }  stamp projects.portal_last_notified_at
//
// The token is a bearer credential for the client's view of the project, so it
// is minted here on the service role, never in the browser.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveApiCaller, unauthorized } from '@/lib/api-auth'
import { publicBaseUrl } from '@/lib/public-base-url'
import { loadPortalRaw, mintProjectPortalToken } from '@/lib/preapproval-portal'
import { buildNotifyEmail, buildPortalView, notifyQueue } from '@/lib/preapproval-view'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProjectRow {
  id: string
  name: string
  portal_token: string | null
  portal_token_issued_at: string | null
  portal_last_notified_at: string | null
}

async function ownedProject(projectId: string, orgId: string): Promise<ProjectRow | null> {
  const { data } = await supabaseAdmin
    .from('projects')
    .select('id, name, portal_token, portal_token_issued_at, portal_last_notified_at')
    .eq('id', projectId)
    .eq('org_id', orgId)
    .maybeSingle()
  return (data as ProjectRow | null) ?? null
}

async function state(req: NextRequest, project: ProjectRow, orgId: string) {
  const url = project.portal_token ? `${publicBaseUrl(req)}/p/${project.portal_token}` : null
  const raw = await loadPortalRaw({ projectId: project.id, orgId, projectName: project.name })
  const view = raw ? buildPortalView(raw) : null
  const queue = view ? notifyQueue(view.activity, project.portal_last_notified_at, project.portal_token_issued_at) : []
  return {
    link: url ? { url, issuedAt: project.portal_token_issued_at } : null,
    lastNotifiedAt: project.portal_last_notified_at,
    pocEmail: view?.you.pocEmail ?? null,
    queue,
    email:
      view && url
        ? buildNotifyEmail({
            orgName: view.orgName,
            projectName: view.projectName,
            pocName: view.you.pocName,
            portalUrl: url,
            queue,
            waitingOnYou: view.status.waitingOnYou,
          })
        : null,
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()
  const project = await ownedProject(projectId, caller.orgId)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(await state(req, project, caller.orgId))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const caller = await resolveApiCaller(req)
  if (!caller?.orgId) return unauthorized()
  const project = await ownedProject(projectId, caller.orgId)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => null)) as { action?: string } | null
  const now = new Date().toISOString()
  let patch: Record<string, string> | null = null

  if (body?.action === 'link') {
    // Idempotent: asking for the link never rotates an existing one.
    if (!project.portal_token) patch = { portal_token: mintProjectPortalToken(), portal_token_issued_at: now }
  } else if (body?.action === 'reissue') {
    patch = { portal_token: mintProjectPortalToken(), portal_token_issued_at: now }
  } else if (body?.action === 'notified') {
    patch = { portal_last_notified_at: now }
  } else {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  if (patch) {
    // .select() back: a zero-row update must not read as success.
    const { data: updated, error } = await supabaseAdmin
      .from('projects')
      .update(patch)
      .eq('id', projectId)
      .eq('org_id', caller.orgId)
      .select('id')
    if (error) {
      return NextResponse.json(
        { error: /portal_/.test(error.message) ? 'Run migration 135 first.' : error.message },
        { status: 500 },
      )
    }
    if (!updated || updated.length === 0) return NextResponse.json({ error: 'Nothing was updated' }, { status: 500 })
    Object.assign(project, patch)
  }
  return NextResponse.json(await state(req, project, caller.orgId))
}
