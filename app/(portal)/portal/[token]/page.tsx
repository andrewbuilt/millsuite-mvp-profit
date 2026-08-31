// ============================================================================
// /portal/{token} — the client's home screen
// ============================================================================
// A React Server Component that reads through lib/client-portal on the service
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
import Link from 'next/link'
import { loadPortalHome } from '@/lib/client-portal'
import { Eyebrow, PortalHeader, PortalFooter, ProgressRail, mono, MUTED, PAPER, LINE, INK } from '@/components/portal/ui'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

export default async function PortalHomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const home = await loadPortalHome(token)
  if (!home) notFound()

  const { org, clientName, projects } = home
  const count = projects.length

  return (
    <div className="mx-auto min-h-screen max-w-[1180px]">
      <PortalHeader
        orgName={org.name}
        logoUrl={org.logo_url}
        trail={`${clientName.toUpperCase()} · SIGNED IN VIA LINK`}
      />

      <div className="px-[18px] pb-10 pt-9 sm:px-[30px] sm:pt-11">
        <Eyebrow>Your projects</Eyebrow>
        <h1
          className="mt-3 text-[30px] font-extrabold uppercase leading-none sm:text-[40px]"
          style={{ letterSpacing: '-0.035em' }}
        >
          {count === 0
            ? `Nothing open with ${org.name}`
            : count === 1
              ? `One project with ${org.name}`
              : `${count} projects with ${org.name}`}
        </h1>

        {count === 0 ? (
          <p className="mt-5 max-w-[52ch] text-[14px] leading-relaxed" style={{ color: MUTED }}>
            When {org.name} starts a project for you, it will show up here. This link stays good, so you can keep it.
          </p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2">
            {projects.map((p) => (
              <Link
                key={p.id}
                href={`/portal/${token}/${p.id}`}
                className="block rounded-2xl border p-[26px] transition-shadow"
                style={{
                  background: PAPER,
                  borderColor: LINE,
                  boxShadow: '0 1px 2px rgba(22,22,20,.05), 0 26px 44px -30px rgba(22,22,20,.45)',
                }}
              >
                <div
                  className="flex items-center justify-between gap-3 text-[10px] uppercase"
                  style={{ ...mono, letterSpacing: '0.16em', color: MUTED }}
                >
                  {p.needsYouCount > 0 ? (
                    <span
                      className="flex h-6 items-center rounded-full px-[11px] text-[9px]"
                      style={{ background: INK, color: '#F2F0EC', letterSpacing: '0.14em' }}
                    >
                      {p.needsYouCount} {p.needsYouCount === 1 ? 'item' : 'items'} for your review
                    </span>
                  ) : (
                    <span
                      className="flex h-6 items-center rounded-full border px-[11px] text-[9px]"
                      style={{ borderColor: '#E0DCD3', letterSpacing: '0.14em' }}
                    >
                      Nothing needed from you
                    </span>
                  )}
                  <span className="whitespace-nowrap">
                    Phase {p.phaseIndex} / {p.phaseTotal}
                  </span>
                </div>

                <div
                  className="mt-4 text-[26px] font-extrabold uppercase leading-[1.02]"
                  style={{ letterSpacing: '-0.025em' }}
                >
                  {p.name}
                </div>

                <div className="mb-4 mt-[22px]">
                  <ProgressRail
                    phases={Array.from({ length: p.phaseTotal }, (_, i) => ({
                      index: i + 1,
                      state: i + 1 < p.phaseIndex ? 'done' : i + 1 === p.phaseIndex ? 'current' : 'upcoming',
                    }))}
                  />
                </div>

                <div className="text-[11px]" style={{ ...mono, color: MUTED }}>
                  {p.phaseLabel} · {p.statusLine}
                </div>
                {p.paymentLine ? (
                  <div className="mt-1 text-[11px]" style={{ ...mono, color: MUTED }}>
                    {p.paymentLine}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>

      <PortalFooter phone={org.phone} email={org.email} />
    </div>
  )
}
