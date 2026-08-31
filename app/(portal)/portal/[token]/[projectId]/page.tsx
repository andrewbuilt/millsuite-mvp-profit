// ============================================================================
// /portal/{token}/{projectId} — the project view
// ============================================================================
// Server component, same reasoning as the home screen: no Supabase key reaches
// the browser here. loadPortalProject re-scopes the projectId to the token's
// client, so a valid token asking for someone else's project 404s.
//
// LAYOUT NOTE — one deliberate deviation from the design. The design puts the
// "FOR YOUR REVIEW" banner top-right on desktop and second-from-top on mobile.
// Two independent column stacks can't produce both orders, so the banner lives
// in the LEFT column directly under the hero: mobile order matches the design
// exactly, and on desktop the call to action is still the darkest thing on the
// page and still above the fold. If this ever needs to be top-right on desktop
// too, it needs explicit grid placement, not an `order` utility.
// ============================================================================

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { loadPortalProject, portalDate } from '@/lib/client-portal'
import { ApproveItem } from '@/components/portal/ApproveItem'
import { SignChangeOrder } from '@/components/portal/SignChangeOrder'
import {
  Card,
  Eyebrow,
  PortalHeader,
  PortalFooter,
  ProgressRail,
  Row,
  RowStack,
  mono,
  money,
  MUTED,
  FAINT,
  BRASS,
  BRASS_ON_DARK,
  INK,
} from '@/components/portal/ui'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata = { robots: { index: false, follow: false } }

export default async function PortalProjectPage({
  params,
}: {
  params: Promise<{ token: string; projectId: string }>
}) {
  const { token, projectId } = await params
  const p = await loadPortalProject(token, projectId)
  if (!p) notFound()

  const { org } = p
  const withYou = p.approvals.filter((a) => a.waitingOn === 'you' && !a.approved)
  const settled = p.approvals.filter((a) => a.waitingOn !== 'you' || a.approved)
  const unsignedCos = p.changeOrders.filter((c) => c.awaitingSignature)
  const reviewCount = withYou.length + unsignedCos.length

  return (
    <div className="mx-auto min-h-screen max-w-[1180px]">
      <PortalHeader
        orgName={org.name}
        logoUrl={org.logo_url}
        crumb={p.name}
        trail={p.clientName.toUpperCase()}
      />

      <div className="p-3 sm:p-6 lg:grid lg:grid-cols-[392px_1fr] lg:items-start lg:gap-5">
        {/* ── Left column ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:gap-5">
          {/* Hero */}
          <div
            className="rounded-2xl px-[22px] py-6 sm:px-6"
            style={{
              background: INK,
              color: '#F2F0EC',
              boxShadow: '0 2px 3px rgba(22,22,20,.1), 0 24px 44px -26px rgba(22,22,20,.7)',
            }}
          >
            {p.siteLabel ? (
              <div className="text-[9.5px] uppercase" style={{ ...mono, letterSpacing: '0.2em', color: '#9E998F' }}>
                {p.siteLabel}
              </div>
            ) : null}
            <div
              className="mt-3 text-[31px] font-extrabold uppercase leading-[0.98]"
              style={{ letterSpacing: '-0.025em' }}
            >
              {p.name}
            </div>
            <div
              className="mt-5 flex flex-wrap gap-4 border-t pt-4 text-[10.5px] uppercase"
              style={{ ...mono, borderColor: 'rgba(242,240,236,.14)', color: '#ADA8A0' }}
            >
              <span>{p.clientName}</span>
              <span>
                Phase {p.phaseIndex} / {p.phaseTotal}
              </span>
            </div>
          </div>

          {/* For your review */}
          {reviewCount > 0 ? (
            <a
              href={unsignedCos.length > 0 ? '#change-orders' : '#approvals'}
              className="block rounded-[14px] p-5"
              style={{
                background: INK,
                color: '#F2F0EC',
                boxShadow: '0 2px 3px rgba(22,22,20,.1), 0 20px 36px -24px rgba(22,22,20,.75)',
              }}
            >
              <div className="flex items-center gap-[10px]">
                <span className="text-[9.5px] uppercase" style={{ ...mono, letterSpacing: '0.2em', color: BRASS_ON_DARK }}>
                  For your review
                </span>
                <span className="ml-auto text-[14px]" style={{ ...mono, color: BRASS_ON_DARK }}>
                  →
                </span>
              </div>
              <div className="mt-[10px] text-[16px] font-semibold" style={{ letterSpacing: '-0.015em' }}>
                {unsignedCos.length > 0
                  ? unsignedCos[0].title
                  : withYou[0].detail
                    ? `${withYou[0].label} · ${withYou[0].detail}`
                    : withYou[0].label}
              </div>
              {reviewCount > 1 ? (
                <div className="mt-[7px] text-[10.5px]" style={{ ...mono, color: '#ADA8A0' }}>
                  and {reviewCount - 1} more waiting on you
                </div>
              ) : null}
            </a>
          ) : null}

          {/* Where things stand */}
          <Card>
            <Eyebrow>Where things stand</Eyebrow>
            <div className="mb-[18px] mt-5">
              <ProgressRail phases={p.phases} />
            </div>
            <div className="text-[10px] uppercase" style={{ ...mono, letterSpacing: '0.18em', color: BRASS }}>
              Phase {String(p.phaseIndex).padStart(2, '0')} / {String(p.phaseTotal).padStart(2, '0')}
            </div>
            <div
              className="mt-2 text-[25px] font-extrabold uppercase leading-none"
              style={{ letterSpacing: '-0.025em' }}
            >
              {p.phaseLabel}
            </div>
            {p.startedOn ? (
              <div className="mt-[10px] text-[11.5px]" style={{ ...mono, color: MUTED }}>
                Started {portalDate(p.startedOn)}
              </div>
            ) : null}
            <p className="mt-[14px] text-[13.5px] leading-[1.55]" style={{ color: '#3A3833', textWrap: 'pretty' }}>
              {p.phaseBlurb}
            </p>

            {(p.lastEvent || p.installTarget) && (
              <div className="mt-5">
                <RowStack>
                  {p.lastEvent ? (
                    <Row>
                      <span className="text-[10.5px] uppercase" style={{ ...mono, color: MUTED }}>
                        Last · {p.lastEvent.label}
                      </span>
                      <span className="whitespace-nowrap text-[10.5px] uppercase" style={{ ...mono }}>
                        {p.lastEvent.value}
                      </span>
                    </Row>
                  ) : null}
                  {p.installTarget ? (
                    <Row>
                      <span className="text-[10.5px] uppercase" style={{ ...mono, color: MUTED }}>
                        Install target
                      </span>
                      <span className="whitespace-nowrap text-[10.5px] uppercase" style={{ ...mono }}>
                        Week of {portalDate(p.installTarget)}
                      </span>
                    </Row>
                  ) : null}
                </RowStack>
              </div>
            )}

            <div className="mt-5 hidden text-[11.5px] leading-[1.7] lg:block" style={{ ...mono, color: MUTED }}>
              Questions on anything here?
              <br />
              {org.phone ? <a href={`tel:${org.phone.replace(/[^\d+]/g, '')}`}>{org.phone}</a> : null}
              {org.phone && org.email ? ' · ' : null}
              {org.email ? <a href={`mailto:${org.email}`}>{org.email}</a> : null}
            </div>
          </Card>
        </div>

        {/* ── Right column ────────────────────────────────────────────── */}
        <div className="mt-3 flex flex-col gap-3 sm:mt-5 sm:gap-5 lg:mt-0">
          {/* From the shop */}
          {p.photos.length > 0 ? (
            <Card className="!pr-0">
              <div className="flex justify-between pr-[22px]">
                <Eyebrow>From the shop</Eyebrow>
                <Eyebrow className="!tracking-[0.1em]">{portalDate(p.photos[0].takenOn)}</Eyebrow>
              </div>
              <div className="flex gap-[10px] overflow-x-auto pb-1 pr-[22px] pt-[18px] lg:grid lg:grid-cols-3 lg:overflow-visible">
                {p.photos.map((ph) => (
                  <figure key={ph.id} className="w-[205px] flex-none lg:w-auto">
                    {/* eslint-disable-next-line @next/next/no-img-element -- Supabase
                        storage URLs; next/image would need every shop's host allowed. */}
                    <img
                      src={ph.url}
                      alt={ph.caption || 'Shop photo'}
                      loading="lazy"
                      className="h-[150px] w-full rounded-[10px] object-cover lg:h-[170px]"
                      style={{ boxShadow: 'inset 0 0 0 1px rgba(22,22,20,.06)', background: '#EFEDE7' }}
                    />
                    {ph.caption || ph.takenOn ? (
                      <figcaption className="mt-[9px] text-[10.5px]" style={{ ...mono, color: MUTED }}>
                        {[ph.caption, portalDate(ph.takenOn)].filter(Boolean).join(' · ')}
                      </figcaption>
                    ) : null}
                  </figure>
                ))}
              </div>
            </Card>
          ) : null}

          {/* Approvals & selections */}
          {p.approvals.length > 0 ? (
            <Card>
              <div id="approvals" className="scroll-mt-20" />
              <Eyebrow>Approvals &amp; selections</Eyebrow>

              {withYou.map((a) => (
                <ApproveItem
                  key={a.id}
                  token={token}
                  projectId={p.id}
                  itemId={a.id}
                  label={a.label}
                  detail={a.detail}
                  contactEmail={org.email}
                  projectName={p.name}
                />
              ))}

              {settled.map((a, i) => (
                <div key={a.id}>
                  {i > 0 || withYou.length > 0 ? <div className="my-4 h-px" style={{ background: '#EDEAE3' }} /> : <div className="mt-4" />}
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[13.5px] font-semibold">
                        {a.detail ? `${a.label} · ${a.detail}` : a.label}
                      </div>
                    </div>
                    {a.approved ? (
                      <div
                        className="whitespace-nowrap text-[9.5px] uppercase"
                        style={{ ...mono, letterSpacing: '0.14em', color: FAINT }}
                      >
                        {portalDate(a.stampedAt) || 'Approved'}
                      </div>
                    ) : (
                      <div
                        className="flex h-[22px] items-center whitespace-nowrap rounded-full border px-[9px] text-[9px] uppercase"
                        style={{ ...mono, letterSpacing: '0.14em', color: MUTED, borderColor: '#E0DCD3' }}
                      >
                        With {a.waitingOn === 'vendor' ? 'the vendor' : org.name}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </Card>
          ) : null}

          {/* Change orders */}
          {p.changeOrders.length > 0 ? (
            <Card>
              <div id="change-orders" className="scroll-mt-20" />
              {p.changeOrders.map((co, i) => (
                <div key={co.id}>
                  {i > 0 ? <div className="my-6 h-px" style={{ background: '#EDEAE3' }} /> : null}
                  <SignChangeOrder token={token} projectId={p.id} co={co} contractTotal={p.contractTotal} />
                </div>
              ))}
            </Card>
          ) : null}

          {/* Payments + documents */}
          <div className="flex flex-col gap-3 sm:gap-5 lg:grid lg:grid-cols-2 lg:items-start">
            <Card>
              <Eyebrow>Payments</Eyebrow>
              <div className="mt-[18px] flex flex-wrap items-baseline gap-[10px]">
                <span className="text-[30px] font-extrabold" style={{ letterSpacing: '-0.035em' }}>
                  {money(p.payments.paid)}
                </span>
                <span className="text-[11px]" style={{ ...mono, color: MUTED }}>
                  paid of {money(p.payments.total)}
                </span>
              </div>
              <div
                className="my-4 h-[5px] overflow-hidden rounded-[3px]"
                style={{ background: '#E7E3DB', boxShadow: 'inset 0 1px 2px rgba(22,22,20,.08)' }}
              >
                <span
                  className="block h-full rounded-[3px]"
                  style={{
                    background: INK,
                    width: `${p.payments.total > 0 ? Math.min(100, Math.round((p.payments.paid / p.payments.total) * 100)) : 0}%`,
                  }}
                />
              </div>
              {p.payments.rows.length > 0 ? (
                <RowStack>
                  {p.payments.rows.map((r, i) => (
                    <Row key={i}>
                      <span>
                        <b className="block text-[13px] font-semibold">{r.label}</b>
                        {r.sublabel ? (
                          <span className="text-[10.5px]" style={{ ...mono, color: r.paid ? MUTED : BRASS }}>
                            {r.sublabel}
                          </span>
                        ) : null}
                      </span>
                      <span
                        className="whitespace-nowrap text-[12.5px]"
                        style={{ ...mono, color: r.paid ? FAINT : INK, fontWeight: r.paid ? 400 : 700 }}
                      >
                        {money(r.amount)}
                      </span>
                    </Row>
                  ))}
                </RowStack>
              ) : null}
              {/* No "Pay" button in v1 (Andrew's call, 2026-08-31): nothing in
                  this system holds a client-facing payment URL yet, and a
                  button that can't take a payment is worse than no button. */}
              <div className="mt-4 text-[10.5px] leading-[1.6]" style={{ ...mono, color: MUTED }}>
                {org.name} will send an invoice when each payment comes due.
              </div>
            </Card>

            {p.documents.length > 0 ? (
              <Card>
                <Eyebrow>Documents</Eyebrow>
                <div className="mt-4">
                  <RowStack>
                    {p.documents.map((d, i) => (
                      <Row key={i} as="a" href={d.url} className="!gap-3">
                        <span
                          className="w-[38px] shrink-0 text-[9.5px] uppercase"
                          style={{ ...mono, letterSpacing: '0.1em', color: MUTED }}
                        >
                          {d.kind}
                        </span>
                        <span className="flex-1">
                          <b className="block text-[13.5px] font-semibold">{d.label}</b>
                          {d.sublabel ? (
                            <span className="text-[10.5px]" style={{ ...mono, color: MUTED }}>
                              {d.sublabel}
                            </span>
                          ) : null}
                        </span>
                        <span style={{ ...mono, color: FAINT }}>→</span>
                      </Row>
                    ))}
                  </RowStack>
                </div>
              </Card>
            ) : null}
          </div>

          <div className="px-1">
            <Link href={`/portal/${token}`} className="text-[11px] uppercase" style={{ ...mono, letterSpacing: '0.14em', color: MUTED }}>
              ← All your projects
            </Link>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <PortalFooter phone={org.phone} email={org.email} />
      </div>
    </div>
  )
}
