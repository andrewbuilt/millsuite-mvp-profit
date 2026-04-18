// lib/portal.ts
// Client Portal — slug generation, password hashing, JWT auth, data fetching.
// Adapted from Built OS for MVP's `name` column (not project_name) and no
// portal_enabled/portal_created_at columns. Portal is "enabled" when portal_slug IS NOT NULL.

import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import type { PortalStep } from '@/lib/types'
import { PORTAL_STEPS } from '@/lib/types'
import { upsertProfile, trackEvent, extractFirstName } from '@/lib/klaviyo'

// Re-export for callers that only need portal types
export { PORTAL_STEPS }
export type { PortalStep }

export const PORTAL_STEP_LABELS: Record<string, string> = {
  down_payment: 'Down Payment',
  deposit_due: 'Down Payment',
  deposit_received: 'Down Payment',
  approvals: 'Pre-Production Approvals',
  scheduling: 'Scheduling',
  in_production: 'In Production',
  assembly: 'Assembly',
  ready_for_install: 'Ready for Install',
  complete: 'Complete',
}

export const PORTAL_STEP_ORDER: Record<string, number> = {
  down_payment: 0,
  deposit_due: 0,
  deposit_received: 0,
  approvals: 1,
  scheduling: 2,
  in_production: 3,
  assembly: 4,
  ready_for_install: 5,
  complete: 6,
}

// ── Slug generation ──

export function generatePortalSlug(projectName: string, projectId: string): string {
  const base = projectName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
  const suffix = projectId.replace(/-/g, '').slice(-4)
  return `${base}-${suffix}`
}

// ── Password generation ──

export function generatePortalPassword(): string {
  // 6 chars, no I/O/0/1 — easy to read over the phone
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let pw = ''
  for (let i = 0; i < 6; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)]
  }
  return pw
}

// ── Password hashing (Web Crypto — no bcrypt dep) ──

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password.toUpperCase()) // case-insensitive
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const inputHash = await hashPassword(password)
  return inputHash === hash
}

// ── JWT (simple HMAC-signed, no lib needed) ──

const JWT_SECRET =
  process.env.PORTAL_JWT_SECRET || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'portal-dev-secret'

export async function createPortalToken(projectId: string, slug: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = btoa(
    JSON.stringify({
      sub: projectId,
      slug,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    })
  )

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${header}.${payload}`)
  )

  const sig = btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(signature))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return `${header}.${payload}.${sig}`
}

export async function verifyPortalToken(
  token: string
): Promise<{ sub: string; slug: string } | null> {
  try {
    const [header, payload, sig] = token.split('.')
    if (!header || !payload || !sig) return null

    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const sigB64 =
      sig.replace(/-/g, '+').replace(/_/g, '/') +
      '=='.slice(0, (4 - (sig.length % 4)) % 4)
    const sigBytes = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0))

    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      encoder.encode(`${header}.${payload}`)
    )

    if (!valid) return null

    const data = JSON.parse(atob(payload))
    if (data.exp < Math.floor(Date.now() / 1000)) return null

    return { sub: data.sub, slug: data.slug }
  } catch {
    return null
  }
}

// ── Klaviyo email helpers ──
//
// Two — and only two — events fire from the MillSuite portal:
//   1. "Portal Created"        → on setupPortal + on password reset (re-sends creds)
//   2. "Project Status Changed" → on transitions to scheduling, in_production,
//                                  or ready_for_install (the 3 step changes the
//                                  homeowner actually cares about). Other step
//                                  changes are noise — they don't email.
//
// All multi-tenant context (shop name + reply email) rides on the event
// properties so a single Klaviyo flow template can render any shop's branding.
// "Source: 'millsuite'" is added by trackEvent() so flows can filter origin.

const STEPS_THAT_EMAIL: PortalStep[] = ['scheduling', 'in_production', 'ready_for_install']

function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_URL ||
    'https://app.millsuite.com'
  ).replace(/\/+$/, '')
}

interface PortalEmailContext {
  email: string
  firstName: string
  projectName: string
  shopName: string
  shopReplyEmail: string
  portalUrl: string
}

// Pull everything Klaviyo needs in one query. Returns null if the homeowner
// has no email on file — without an address there's nothing to send to and we
// silently skip rather than blowing up the caller.
async function loadPortalEmailContext(
  projectId: string
): Promise<PortalEmailContext | null> {
  const { data: project, error } = await supabase
    .from('projects')
    .select(
      `
      id,
      name,
      portal_slug,
      org:orgs(name, business_email),
      client:clients(name, email),
      contact:contacts(name, email)
    `
    )
    .eq('id', projectId)
    .single()

  if (error || !project) return null

  const contact = (project.contact as any) || {}
  const client = (project.client as any) || {}
  const org = (project.org as any) || {}

  const email = String(contact.email || client.email || '').trim().toLowerCase()
  if (!email) return null

  return {
    email,
    firstName: extractFirstName(contact.name || client.name),
    projectName: project.name || 'your project',
    shopName: org.name || 'your shop',
    shopReplyEmail: org.business_email || '',
    portalUrl: project.portal_slug
      ? `${getAppUrl()}/portal/${project.portal_slug}`
      : '',
  }
}

// Fire "Portal Created" — used for both initial setup and password rotation.
// Always includes the current plaintext password so the email itself is
// self-contained: clients never need to look it up elsewhere.
export async function firePortalCreatedEvent(
  projectId: string,
  plaintextPassword: string
): Promise<void> {
  const ctx = await loadPortalEmailContext(projectId)
  if (!ctx) return

  await upsertProfile({
    email: ctx.email,
    firstName: ctx.firstName,
    properties: {
      shop_name: ctx.shopName,
      latest_project_name: ctx.projectName,
    },
  })

  await trackEvent(ctx.email, 'Portal Created', {
    project_name: ctx.projectName,
    shop_name: ctx.shopName,
    portal_url: ctx.portalUrl,
    portal_password: plaintextPassword,
    client_first_name: ctx.firstName,
    shop_reply_email: ctx.shopReplyEmail,
  })
}

// Fire "Project Status Changed" — only for the 3 transitions the homeowner
// cares about. Other portal_step writes are silent. Exported so the
// auto-advance engine in lib/leads.ts can call it directly when it bypasses
// updatePortalStep().
export async function firePortalStepEmail(
  projectId: string,
  newStep: PortalStep
): Promise<void> {
  if (!STEPS_THAT_EMAIL.includes(newStep)) return

  const ctx = await loadPortalEmailContext(projectId)
  if (!ctx) return

  await upsertProfile({
    email: ctx.email,
    firstName: ctx.firstName,
    properties: {
      shop_name: ctx.shopName,
      latest_project_name: ctx.projectName,
    },
  })

  await trackEvent(ctx.email, 'Project Status Changed', {
    project_name: ctx.projectName,
    shop_name: ctx.shopName,
    portal_url: ctx.portalUrl,
    new_step: newStep,
    new_step_label: PORTAL_STEP_LABELS[newStep] || newStep,
    client_first_name: ctx.firstName,
    shop_reply_email: ctx.shopReplyEmail,
  })
}

// ── Setup ──

export async function setupPortal(
  projectId: string,
  projectName: string
): Promise<{ slug: string; password: string } | null> {
  const slug = generatePortalSlug(projectName, projectId)
  const password = generatePortalPassword()
  const passwordHash = await hashPassword(password)

  const { error } = await supabase
    .from('projects')
    .update({
      portal_slug: slug,
      portal_password_hash: passwordHash,
      portal_step: 'down_payment',
    })
    .eq('id', projectId)

  if (error) {
    console.error('Error setting up portal:', error)
    return null
  }

  // Log creation to timeline
  await supabase.from('portal_timeline').insert({
    project_id: projectId,
    event_type: 'portal_created',
    event_label: 'Client Portal Created',
    event_detail: 'Portal access enabled',
    portal_step: 'down_payment',
    actor_type: 'system',
    triggered_by: 'system',
  })

  // Fire Klaviyo "Portal Created" event so the homeowner gets their access
  // email. Failures here are swallowed inside firePortalCreatedEvent — the
  // portal itself was created successfully and we'd rather log a Klaviyo
  // error than fail the whole setup call.
  await firePortalCreatedEvent(projectId, password)

  return { slug, password }
}

// ── Step updates ──

export async function updatePortalStep(
  projectId: string,
  newStep: PortalStep,
  triggeredBy: string = 'system'
): Promise<boolean> {
  const { data: project } = await supabase
    .from('projects')
    .select('portal_step')
    .eq('id', projectId)
    .single()

  if (!project) return false

  const { error } = await supabase
    .from('projects')
    .update({ portal_step: newStep })
    .eq('id', projectId)

  if (error) {
    console.error('Error updating portal step:', error)
    return false
  }

  await supabase.from('portal_timeline').insert({
    project_id: projectId,
    event_type: 'step_change',
    event_label: PORTAL_STEP_LABELS[newStep],
    event_detail: `Status updated from ${
      PORTAL_STEP_LABELS[project.portal_step as PortalStep] || project.portal_step
    }`,
    portal_step: newStep,
    actor_type: triggeredBy === 'system' ? 'system' : 'shop',
    triggered_by: triggeredBy,
  })

  // Fire the Klaviyo email (no-ops for steps that aren't in
  // STEPS_THAT_EMAIL — see firePortalStepEmail).
  if (project.portal_step !== newStep) {
    await firePortalStepEmail(projectId, newStep)
  }

  return true
}

// ── Portal data fetch (everything the client portal page needs) ──

export async function getPortalData(slug: string) {
  const { data: project, error } = await supabase
    .from('projects')
    .select(
      `
      id,
      name,
      portal_step,
      status,
      production_phase,
      estimated_price,
      drive_folder_url,
      client:clients(name, email),
      contact:contacts(name, email)
    `
    )
    .eq('portal_slug', slug)
    .single()

  if (error || !project) return null

  const [selectionsResult, timelineResult, drawingsResult] = await Promise.all([
    supabase
      .from('selections')
      .select(
        'id, category, label, spec_value, status, confirmed_date, subproject_id'
      )
      .eq('project_id', project.id)
      .neq('status', 'voided')
      .order('display_order'),
    supabase
      .from('portal_timeline')
      .select('*')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('drawing_revisions')
      .select(
        'id, revision_number, status, drive_file_url, created_at, subproject_id'
      )
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return {
    project: {
      id: project.id,
      name: project.name,
      portalStep: project.portal_step as PortalStep,
      status: project.status,
      productionPhase: project.production_phase,
      estimatedPrice: project.estimated_price,
      driveFolderUrl: project.drive_folder_url,
      clientName: (project.client as any)?.name,
      contactName: (project.contact as any)?.name,
    },
    selections: selectionsResult.data || [],
    timeline: timelineResult.data || [],
    drawings: drawingsResult.data || [],
  }
}
