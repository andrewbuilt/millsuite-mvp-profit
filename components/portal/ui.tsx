// ============================================================================
// components/portal/ui.tsx — the client portal's design primitives
// ============================================================================
// Every token here comes from prototypes/design/client-portal-final.dc.html
// (Turn 3, the "progress rail" direction). Keep them in one place so the six
// or so surfaces that use them can't drift apart.
//
// Two rules from the design pass that are easy to break by accident:
//   • NO EM DASHES in client-facing copy. Use "·". The shop's voice uses them
//     everywhere internally; the client portal deliberately doesn't.
//   • ONE flat almost-black, #161614. Not #111, not black. It's the app's only
//     surface with this palette, so a stray neutral reads as a bug.
//
// Mono runs through an inline style rather than a Tailwind class because the
// font variable is scoped to the portal layout, not the global theme.
// ============================================================================

import React from 'react'

export const INK = '#161614'
export const BRASS = '#9A7B3F'
/** Brass lightened for legibility on the dark cards. */
export const BRASS_ON_DARK = '#C9A461'
export const MUTED = '#6B675F'
export const FAINT = '#A19C93'
export const PAPER = '#FCFBF8'
export const LINE = '#E4E0D7'

export const mono: React.CSSProperties = { fontFamily: 'var(--font-portal-mono), ui-monospace, monospace' }

/** The small uppercase section label: "WHERE THINGS STAND", "PAYMENTS". */
export function Eyebrow({
  children,
  color = MUTED,
  className = '',
}: {
  children: React.ReactNode
  color?: string
  className?: string
}) {
  return (
    <div
      className={`text-[9.5px] uppercase ${className}`}
      style={{ ...mono, letterSpacing: '0.2em', color }}
    >
      {children}
    </div>
  )
}

/** The standard light card every section sits in. */
export function Card({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-[14px] border p-[22px] ${className}`}
      style={{
        background: PAPER,
        borderColor: LINE,
        boxShadow: '0 1px 2px rgba(22,22,20,.05), 0 20px 34px -24px rgba(22,22,20,.35)',
      }}
    >
      {children}
    </section>
  )
}

/** The inset list container: a hairline-separated stack of pale rows. */
export function RowStack({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-px rounded-[10px] p-1" style={{ background: '#EFEDE7' }}>
      {children}
    </div>
  )
}

export function Row({
  children,
  className = '',
  as = 'div',
  href,
}: {
  children: React.ReactNode
  className?: string
  as?: 'div' | 'a'
  href?: string
}) {
  const style = { background: PAPER } as React.CSSProperties
  const cls = `flex items-center justify-between gap-3 rounded-lg px-3 py-3 ${className}`
  if (as === 'a') {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
        {children}
      </a>
    )
  }
  return (
    <div className={cls} style={style}>
      {children}
    </div>
  )
}

// ── The progress rail ───────────────────────────────────────────────────────

export interface RailPhase {
  index: number
  state: 'done' | 'current' | 'upcoming'
}

/**
 * Seven segments: filled for done, brass for the phase you're in, pale ahead.
 *
 * ⚠️ The design mocks the current segment as a 62% gradient. That number is a
 * mock, not a measurement — nothing in the schema says how far through a phase
 * a project is, and inventing a percentage on a client-facing page is exactly
 * the kind of confident-but-made-up detail this portal exists to avoid. The
 * current segment is a solid brass fill instead. If a real progress signal ever
 * lands (say, allocation hours completed / total), this is where it goes.
 */
export function ProgressRail({ phases }: { phases: RailPhase[] }) {
  return (
    <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${phases.length}, 1fr)` }}>
      {phases.map((p) => (
        <span
          key={p.index}
          className="h-1 rounded-sm"
          style={{ background: p.state === 'done' ? INK : p.state === 'current' ? BRASS : '#DAD6CC' }}
        />
      ))}
    </div>
  )
}

// ── Header ──────────────────────────────────────────────────────────────────

/** The sticky translucent bar carrying the shop's mark. `trail` is the small
 *  right-hand caption (the client's name, or a breadcrumb). */
export function PortalHeader({
  orgName,
  logoUrl,
  crumb,
  trail,
}: {
  orgName: string
  logoUrl: string | null
  crumb?: string | null
  trail?: string | null
}) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center gap-[9px] border-b px-[18px] py-[14px] sm:px-[30px] sm:py-4"
      style={{
        background: 'rgba(22,22,20,.72)',
        backdropFilter: 'blur(26px) saturate(150%)',
        WebkitBackdropFilter: 'blur(26px) saturate(150%)',
        color: '#F2F0EC',
        borderColor: 'rgba(242,240,236,.12)',
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- org logos are
        // arbitrary remote Supabase URLs; next/image would need every shop's
        // storage host in next.config remotePatterns.
        <img src={logoUrl} alt={orgName} className="block h-[22px] w-[22px] rounded-[5px] object-cover" />
      ) : null}
      <span className="text-[12px] font-extrabold uppercase" style={{ letterSpacing: '0.2em' }}>
        {orgName}
      </span>
      {crumb ? (
        <span className="hidden text-[10.5px] sm:inline" style={{ ...mono, letterSpacing: '0.14em', color: '#ADA8A0' }}>
          / {crumb}
        </span>
      ) : null}
      {trail ? (
        <span
          className="ml-auto truncate text-[9.5px] sm:text-[10.5px]"
          style={{ ...mono, letterSpacing: '0.16em', color: '#ADA8A0' }}
        >
          {trail}
        </span>
      ) : null}
    </header>
  )
}

// ── Footer ──────────────────────────────────────────────────────────────────

export function PortalFooter({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) return null
  return (
    <div className="px-[22px] pb-9 pt-6 text-center">
      <div className="text-[11.5px] leading-[1.7]" style={{ ...mono, color: MUTED }}>
        Questions on anything here?
        <br />
        {phone ? <a href={`tel:${phone.replace(/[^\d+]/g, '')}`}>{phone}</a> : null}
        {phone && email ? ' · ' : null}
        {email ? <a href={`mailto:${email}`}>{email}</a> : null}
      </div>
    </div>
  )
}

// ── Money ───────────────────────────────────────────────────────────────────

export function money(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}
