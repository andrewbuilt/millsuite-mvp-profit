'use client'

// ============================================================================
// TopNav — horizontal top bar, hoisted into app/(app)/layout.tsx (renders once)
// ============================================================================
// Text-only (no icons). Three groups:
//   Sales ▾    → /sales (click), dropdown: Kanban · Invoices · Clients
//   Projects ▾ → /projects (click), dropdown: Schedule · Capacity
//   Manage ▾   → (not a link) dropdown: Reports · Suggestions · Rate book · Team · Time
// Click-the-parent / hover-the-chevron: Sales & Projects labels are real links;
// Manage's label is the dropdown trigger (no parent route). Hover opens the menu
// for pointer users; the chevron is the touch/keyboard escape. Gating mirrors
// the old nav (hasAccess per item; group shows iff parent is reachable or ≥1
// child is accessible; member → Time only). Style-neutral.
// ============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { MLogo } from '@/components/logo'

interface Leaf {
  href: string
  label: string
  feature?: string
}
interface GroupSpec {
  label: string
  href?: string // present → parent label is a link (when the plan allows)
  feature?: string // gates the parent link
  children: Leaf[]
}

const NAV: GroupSpec[] = [
  {
    label: 'Sales',
    href: '/sales',
    feature: 'sales',
    children: [
      { href: '/sales/kanban', label: 'Kanban', feature: 'sales' },
      { href: '/estimates', label: 'Estimates', feature: 'sales' },
      { href: '/change-orders', label: 'Change orders', feature: 'sales' },
      { href: '/invoices', label: 'Invoices', feature: 'invoices' },
      { href: '/clients', label: 'Clients', feature: 'sales' },
    ],
  },
  {
    label: 'Projects',
    href: '/projects',
    feature: 'projects',
    children: [
      { href: '/schedule', label: 'Schedule', feature: 'schedule' },
      { href: '/capacity', label: 'Capacity', feature: 'capacity' },
    ],
  },
  {
    label: 'Manage', // no href → not clickable; the label opens the dropdown
    children: [
      { href: '/reports', label: 'Reports', feature: 'outcomes' },
      { href: '/suggestions', label: 'Suggestions', feature: 'rate-book' },
      { href: '/rate-book', label: 'Rate book', feature: 'rate-book' },
      { href: '/team', label: 'Team', feature: 'team' },
      { href: '/time', label: 'Time' },
    ],
  },
]

const MEMBER_NAV: Leaf[] = [{ href: '/me', label: 'My work' }]

function leafActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/')
}

export default function TopNav() {
  const pathname = usePathname()
  const { user, org, signOut } = useAuth()
  const isMember = user?.role === 'member'
  const plan = org?.plan || 'starter'

  const groups: GroupSpec[] = isMember
    ? []
    : NAV.map((g) => ({
        ...g,
        children: g.children.filter((c) => !c.feature || hasAccess(plan, c.feature)),
      })).filter(
        (g) =>
          g.children.length > 0 ||
          (!!g.href && (!g.feature || hasAccess(plan, g.feature))),
      )

  const showExternalShortcuts = plan === 'starter'

  return (
    <nav className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50">
      <div className="px-4 sm:px-6 flex items-center gap-4 h-14">
        {/* Brand → Dashboard */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={isMember ? '/me' : '/dashboard'}
            className="flex items-center gap-2 text-base font-semibold tracking-tight text-[#111] rounded-lg px-1.5 py-1 hover:bg-[#F9FAFB] transition-colors"
            aria-label="Dashboard"
          >
            <MLogo size={20} color="#111" />
            <span className="hidden sm:inline">MillSuite</span>
          </Link>
          {org && (
            <span className="text-xs text-[#9CA3AF] hidden xl:inline truncate max-w-[140px]">
              · {org.name}
            </span>
          )}
        </div>

        {/* Primary nav */}
        <div className="flex-1 min-w-0 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 whitespace-nowrap">
            {isMember
              ? MEMBER_NAV.map((item) => (
                  <NavItem key={item.href} item={item} pathname={pathname} />
                ))
              : groups.map((g) => (
                  <NavGroup key={g.label} group={g} pathname={pathname} plan={plan} />
                ))}
          </div>
        </div>

        {/* Right utility cluster (text-only) */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {showExternalShortcuts && (
            <div className="hidden xl:flex items-center gap-3 mr-2 text-xs text-[#9CA3AF] whitespace-nowrap">
              <a href="https://takeoff.millsuite.com" className="hover:text-[#111] transition-colors">
                Takeoff
              </a>
            </div>
          )}
          {!isMember && (
            <Link
              href="/settings"
              className={`px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                pathname.startsWith('/settings')
                  ? 'bg-[#F3F4F6] text-[#111]'
                  : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
              }`}
            >
              Settings
            </Link>
          )}
          <button
            onClick={signOut}
            className="px-2.5 py-1.5 rounded-lg text-sm font-medium text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  )
}

function NavItem({ item, pathname }: { item: Leaf; pathname: string }) {
  const isActive = leafActive(pathname, item.href)
  return (
    <Link
      href={item.href}
      className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
        isActive
          ? 'bg-[#F3F4F6] text-[#111]'
          : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
      }`}
    >
      {item.label}
    </Link>
  )
}

function NavGroup({
  group,
  pathname,
  plan,
}: {
  group: GroupSpec
  pathname: string
  plan: string
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      setOpen(false)
      closeTimer.current = null
    }, 200)
  }
  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useEffect(() => { setMounted(true) }, [])

  const parentClickable = !!group.href && (!group.feature || hasAccess(plan, group.feature))
  const isActive =
    (!!group.href && leafActive(pathname, group.href)) ||
    group.children.some((c) => leafActive(pathname, c.href))

  useLayoutEffect(() => {
    if (!open) return
    function recalc() {
      if (!wrapRef.current) return
      const r = wrapRef.current.getBoundingClientRect()
      setMenuPos({ top: r.bottom + 4, left: r.left })
    }
    recalc()
    window.addEventListener('resize', recalc)
    window.addEventListener('scroll', recalc, true)
    return () => {
      window.removeEventListener('resize', recalc)
      window.removeEventListener('scroll', recalc, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const t = e.target as Node
      if (wrapRef.current?.contains(t)) return
      if ((t as HTMLElement)?.closest?.('[data-nav-menu="true"]')) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Parent reachable but no accessible children → plain link (no dropdown).
  if (group.children.length === 0 && parentClickable) {
    return <NavItem item={{ href: group.href!, label: group.label }} pathname={pathname} />
  }

  const triggerClasses = `flex items-center gap-1 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-[#F3F4F6] text-[#111]' : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
  }`

  const menu =
    open && menuPos && mounted
      ? createPortal(
          <div
            data-nav-menu="true"
            role="menu"
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
            className="min-w-[180px] bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1 z-[60]"
          >
            {group.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`block px-3 py-1.5 text-sm transition-colors ${
                  leafActive(pathname, child.href)
                    ? 'bg-[#F3F4F6] text-[#111] font-medium'
                    : 'text-[#374151] hover:bg-[#F9FAFB] hover:text-[#111]'
                }`}
              >
                {child.label}
              </Link>
            ))}
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <div
        ref={wrapRef}
        className="relative flex items-stretch flex-shrink-0"
        onMouseEnter={() => {
          cancelClose()
          setOpen(true)
        }}
        onMouseLeave={scheduleClose}
      >
        {parentClickable ? (
          <>
            <Link href={group.href!} className={`${triggerClasses} pl-2.5 sm:pl-3 pr-1 rounded-l-lg`}>
              {group.label}
            </Link>
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`Open ${group.label} menu`}
              onClick={() => setOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setOpen(true)
                }
              }}
              className={`flex items-center px-1 py-1.5 rounded-r-lg transition-colors ${
                isActive ? 'bg-[#F3F4F6] text-[#6B7280]' : 'text-[#9CA3AF] hover:text-[#111] hover:bg-[#F9FAFB]'
              }`}
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          </>
        ) : (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setOpen(true)
              }
            }}
            className={`${triggerClasses} px-2.5 sm:px-3 rounded-lg`}
          >
            {group.label}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {menu}
    </>
  )
}
