'use client'

// ============================================================================
// SideNav — left slide-out drawer (replaces the old top bar nav)
// ============================================================================
// Hoisted into app/(app)/layout.tsx so it renders once. A slim top bar holds a
// ☰ toggle + brand; tapping ☰ slides a solid panel in from the left while the
// app behind frosts + dims. Default closed; backdrop / × / ESC close; closes on
// route change. Items are text-only (no icons); groups are plain-text
// collapsible sections. Gating mirrors the old nav (hasAccess + member→Time).
// Style-neutral — the aesthetic pass refines visuals.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, X, Settings, LogOut, ChevronDown } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { MLogo } from '@/components/logo'

interface Leaf {
  href: string
  label: string
  feature?: string
}
interface Group {
  label: string
  children: Leaf[]
}

// Approved 3-group structure. Group headers are plain labels (not links).
// `/invoices` is plan-gated only (always shown in both invoicing modes).
const GROUPS: Group[] = [
  {
    label: 'Sales',
    children: [
      { href: '/sales/kanban', label: 'Kanban', feature: 'sales' },
      { href: '/clients', label: 'Clients', feature: 'sales' },
      { href: '/invoices', label: 'Invoices', feature: 'invoices' },
    ],
  },
  {
    label: 'Projects',
    children: [
      { href: '/projects', label: 'Projects', feature: 'projects' },
      { href: '/schedule', label: 'Schedule', feature: 'schedule' },
      { href: '/capacity', label: 'Capacity', feature: 'capacity' },
    ],
  },
  {
    label: 'Manage',
    children: [
      { href: '/reports', label: 'Reports', feature: 'outcomes' },
      { href: '/suggestions', label: 'Suggestions', feature: 'rate-book' },
      { href: '/rate-book', label: 'Rate book', feature: 'rate-book' },
      { href: '/team', label: 'Team', feature: 'team' },
      { href: '/time', label: 'Time' },
    ],
  },
]

const MEMBER_LEAVES: Leaf[] = [{ href: '/time', label: 'Time' }]

export default function SideNav() {
  const pathname = usePathname()
  const { user, org, signOut } = useAuth()
  const isMember = user?.role === 'member'
  const plan = org?.plan || 'starter'

  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLElement>(null)

  // Close on route change.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // ESC closes; move focus into the panel when it opens.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Gating: filter children by plan; keep groups with ≥1 accessible child.
  // Members get a single flat Time entry.
  const sections: Group[] = isMember
    ? [{ label: '', children: MEMBER_LEAVES }]
    : GROUPS.map((g) => ({
        ...g,
        children: g.children.filter((c) => !c.feature || hasAccess(plan, c.feature)),
      })).filter((g) => g.children.length > 0)

  const homeHref = isMember ? '/time' : '/dashboard'

  return (
    <>
      {/* Slim top bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-[#E5E7EB] h-14 flex items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          className="p-2 -ml-2 rounded-lg text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB] transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        <Link
          href={homeHref}
          className="flex items-center gap-2 text-base font-semibold tracking-tight text-[#111]"
          aria-label="Dashboard"
        >
          <MLogo size={20} color="#111" />
          <span>MillSuite</span>
        </Link>
        {org && (
          <span className="text-xs text-[#9CA3AF] hidden sm:inline truncate max-w-[160px]">
            · {org.name}
          </span>
        )}
      </header>

      {/* Backdrop — frosted + dimmed */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden="true"
        className={`fixed inset-0 z-50 bg-black/30 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Drawer panel */}
      <aside
        ref={panelRef}
        inert={!open}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Main menu"
        className={`fixed inset-y-0 left-0 z-50 w-[min(280px,82%)] bg-white shadow-xl flex flex-col outline-none transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Panel header: brand + close */}
        <div className="h-14 flex items-center justify-between px-4 border-b border-[#E5E7EB]">
          <Link
            href={homeHref}
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 text-base font-semibold tracking-tight text-[#111]"
            aria-label="Dashboard"
          >
            <MLogo size={20} color="#111" />
            <span>MillSuite</span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="p-2 -mr-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F9FAFB]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Groups */}
        <nav className="flex-1 overflow-y-auto py-2">
          {sections.map((g, i) => (
            <NavSection
              key={g.label || `member-${i}`}
              label={g.label}
              leaves={g.children}
              pathname={pathname}
              onNavigate={() => setOpen(false)}
            />
          ))}
        </nav>

        {/* Footer: starter shortcuts + settings + sign out */}
        <div className="border-t border-[#E5E7EB] px-2 py-2 space-y-0.5">
          {plan === 'starter' && !isMember && (
            <>
              <a
                href="https://tools.millsuite.com/dashboard"
                className="block px-3 py-2 rounded-lg text-sm text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]"
              >
                Shop Rate ↗
              </a>
              <a
                href="https://takeoff.millsuite.com"
                className="block px-3 py-2 rounded-lg text-sm text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]"
              >
                Takeoff ↗
              </a>
            </>
          )}
          {!isMember && (
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                pathname.startsWith('/settings')
                  ? 'bg-[#F3F4F6] text-[#111] font-medium'
                  : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
              }`}
            >
              <Settings className="w-4 h-4" /> Settings
            </Link>
          )}
          <button
            onClick={signOut}
            className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-sm text-[#6B7280] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>
    </>
  )
}

function NavSection({
  label,
  leaves,
  pathname,
  onNavigate,
}: {
  label: string
  leaves: Leaf[]
  pathname: string
  onNavigate: () => void
}) {
  const [collapsed, setCollapsed] = useState(false)

  // Member view: no group label — render leaves flat.
  if (!label) {
    return (
      <div className="px-2">
        {leaves.map((l) => (
          <LeafLink key={l.href} leaf={l} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </div>
    )
  }

  return (
    <div className="px-2 pb-1">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        className="flex items-center justify-between w-full px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF] hover:text-[#6B7280]"
      >
        {label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
      {!collapsed &&
        leaves.map((l) => (
          <LeafLink key={l.href} leaf={l} pathname={pathname} onNavigate={onNavigate} />
        ))}
    </div>
  )
}

function LeafLink({
  leaf,
  pathname,
  onNavigate,
}: {
  leaf: Leaf
  pathname: string
  onNavigate: () => void
}) {
  const isActive = pathname === leaf.href || pathname.startsWith(leaf.href + '/')
  return (
    <Link
      href={leaf.href}
      onClick={onNavigate}
      className={`block px-3 py-2 rounded-lg text-sm transition-colors ${
        isActive
          ? 'bg-[#F3F4F6] text-[#111] font-medium'
          : 'text-[#374151] hover:text-[#111] hover:bg-[#F9FAFB]'
      }`}
    >
      {leaf.label}
    </Link>
  )
}
