'use client'

// ============================================================================
// Top nav bar.
// ============================================================================
// Restructure (post-sale dogfood pass):
//   Logo  → Dashboard   (drops the standalone Dashboard nav item)
//   Reports
//   Sales ▾   → /sales (click), dropdown: Kanban, Clients
//   Projects ▾ → /projects (click), dropdown: Schedule, Capacity
//   Team ▾    → /team (click), dropdown: Time
//   Rate Book
//   Suggestions
//   (right) Settings cog
//
// Click-the-parent / hover-the-chevron pattern: the label is a real
// <Link>, and the small chevron next to it is a separate button that
// toggles the dropdown. Hovering the parent group also opens the
// dropdown for desktop pointer users; touch users get the explicit
// chevron-tap escape so the parent link always routes on first tap.
// Keyboard: Enter / Space on the label routes; ArrowDown on the
// chevron opens; Escape closes.
//
// Plan-tier rule: Shop Rate + Takeoff external links visible only to
// starter plans. Pro and Pro-AI users own those tools elsewhere
// (Settings → Shop rate calculator, Takeoff app subscription) and
// don't need top-bar shortcuts.
// ============================================================================

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Clock,
  Settings,
  LogOut,
  Calendar,
  BarChart3,
  Users,
  TrendingUp,
  BookOpen,
  Target,
  Sparkles,
  FolderKanban,
  ChevronDown,
  LayoutGrid,
  UserCircle2,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { MLogo } from '@/components/logo'

interface NavLeaf {
  href: string
  label: string
  icon: any
  feature?: string
}

interface NavGroupSpec {
  href: string
  label: string
  icon: any
  feature?: string
  children: NavLeaf[]
}

// Top-level layout. Each entry is either a leaf (NavLeaf) or a parent
// group (NavGroupSpec). We filter on the org plan via hasAccess on both
// the parent and the children.
const NAV: Array<NavLeaf | NavGroupSpec> = [
  { href: '/reports', label: 'Reports', icon: TrendingUp, feature: 'outcomes' },
  {
    href: '/sales',
    label: 'Sales',
    icon: Target,
    feature: 'sales',
    children: [
      { href: '/sales/kanban', label: 'Kanban', icon: LayoutGrid, feature: 'sales' },
      { href: '/clients', label: 'Clients', icon: UserCircle2, feature: 'sales' },
    ],
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderKanban,
    children: [
      { href: '/schedule', label: 'Schedule', icon: Calendar, feature: 'schedule' },
      { href: '/capacity', label: 'Capacity', icon: BarChart3, feature: 'capacity' },
    ],
  },
  {
    href: '/team',
    label: 'Team',
    icon: Users,
    feature: 'team',
    children: [{ href: '/time', label: 'Time', icon: Clock }],
  },
  { href: '/rate-book', label: 'Rate Book', icon: BookOpen, feature: 'rate-book' },
  { href: '/suggestions', label: 'Suggestions', icon: Sparkles, feature: 'rate-book' },
]

const MEMBER_NAV: NavLeaf[] = [{ href: '/time', label: 'Time', icon: Clock }]

function isGroup(n: NavLeaf | NavGroupSpec): n is NavGroupSpec {
  return Array.isArray((n as NavGroupSpec).children)
}

export default function Nav() {
  const pathname = usePathname()
  const { user, org, signOut } = useAuth()

  const isMember = user?.role === 'member'
  const plan = org?.plan || 'starter'

  const visibleItems: Array<NavLeaf | NavGroupSpec> = isMember
    ? MEMBER_NAV
    : NAV.filter((n) => !n.feature || hasAccess(plan, n.feature)).map((n) => {
        if (!isGroup(n)) return n
        const children = n.children.filter(
          (c) => !c.feature || hasAccess(plan, c.feature),
        )
        return { ...n, children }
      })

  // Starter sees Shop Rate + Takeoff in the right rail; Pro / Pro-AI
  // don't (they own those tools elsewhere).
  const showExternalShortcuts = plan === 'starter'

  return (
    <nav className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50">
      <div className="px-4 sm:px-6 flex items-center gap-4 h-14">
        {/* Brand → Dashboard. Standalone Dashboard nav item is gone;
            the logo carries that route now. */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={isMember ? '/time' : '/dashboard'}
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
            {visibleItems.map((item) =>
              isGroup(item) ? (
                <NavGroup key={item.href} item={item} pathname={pathname} />
              ) : (
                <NavItem key={item.href} item={item} pathname={pathname} />
              ),
            )}
          </div>
        </div>

        {/* Right-side utility cluster */}
        <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
          {showExternalShortcuts && (
            <div className="hidden xl:flex items-center gap-3 mr-2 text-xs text-[#9CA3AF] whitespace-nowrap">
              <a
                href="https://tools.millsuite.com/dashboard"
                className="hover:text-[#111] transition-colors"
              >
                Shop Rate
              </a>
              <a
                href="https://takeoff.millsuite.com"
                className="hover:text-[#111] transition-colors"
              >
                Takeoff
              </a>
            </div>
          )}
          {!isMember && (
            <Link
              href="/settings"
              aria-label="Settings"
              className={`p-2 rounded-lg transition-colors ${
                pathname.startsWith('/settings')
                  ? 'bg-[#F3F4F6] text-[#111]'
                  : 'text-[#9CA3AF] hover:text-[#111] hover:bg-[#F9FAFB]'
              }`}
            >
              <Settings className="w-5 h-5" />
            </Link>
          )}
          <button
            onClick={signOut}
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  )
}

function NavItem({ item, pathname }: { item: NavLeaf; pathname: string }) {
  const isActive = pathname.startsWith(item.href)
  return (
    <Link
      href={item.href}
      className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
        isActive
          ? 'bg-[#F3F4F6] text-[#111]'
          : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
      }`}
    >
      <item.icon className="w-4 h-4 flex-shrink-0" />
      <span className="hidden sm:inline">{item.label}</span>
    </Link>
  )
}

function NavGroup({
  item,
  pathname,
}: {
  item: NavGroupSpec
  pathname: string
}) {
  const [open, setOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)
  // Close-delay timer. The portal places the menu OUTSIDE the wrap, so
  // moving from the parent label to a menu item briefly leaves both
  // hover regions during the gap. Without a delay, mouseleave on the
  // wrap fires before mouseenter on the menu, slamming the menu shut
  // before the cursor reaches it. 200 ms is short enough that intent
  // ("I left the area") still registers and long enough to absorb
  // diagonal mouse motion across the gap.
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
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  // Active when the parent route OR any child route is current.
  const isActive =
    pathname.startsWith(item.href) ||
    item.children.some((c) => pathname.startsWith(c.href))

  // Anchor the portal-rendered menu to the wrap's bounding rect.
  // The inner nav row uses overflow-x-auto to keep things scrollable on
  // narrow viewports — that creates a clipping context, which is why
  // the previous absolute-positioned menu rendered "empty" (it sat
  // outside the visible area). Portal + fixed positioning sidesteps
  // the clip entirely.
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

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      const target = e.target as Node
      if (wrapRef.current?.contains(target)) return
      // Don't close when the click lands inside the portal menu either.
      if ((target as HTMLElement)?.closest?.('[data-nav-menu="true"]')) return
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

  if (item.children.length === 0) {
    // No accessible children for this plan — render as a plain leaf.
    return <NavItem item={item} pathname={pathname} />
  }

  const menu = open && menuPos && mounted
    ? createPortal(
        <div
          data-nav-menu="true"
          role="menu"
          // Cancel the close timer when entering the menu, schedule it
          // again when leaving. Same handler pair the wrap uses, so a
          // cursor moving wrap → menu (or vice versa) never sees a
          // moment where neither is hovered AND the timer has fired.
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
          }}
          className="min-w-[180px] bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1 z-[60]"
        >
          {item.children.map((child) => {
            const childActive = pathname.startsWith(child.href)
            return (
              <Link
                key={child.href}
                href={child.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                  childActive
                    ? 'bg-[#F3F4F6] text-[#111] font-medium'
                    : 'text-[#374151] hover:bg-[#F9FAFB] hover:text-[#111]'
                }`}
              >
                <child.icon className="w-3.5 h-3.5 text-[#9CA3AF]" />
                {child.label}
              </Link>
            )
          })}
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
        <Link
          href={item.href}
          className={`flex items-center gap-1.5 sm:gap-2 pl-2.5 sm:pl-3 pr-1.5 py-1.5 rounded-l-lg text-sm font-medium transition-colors ${
            isActive
              ? 'bg-[#F3F4F6] text-[#111]'
              : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
          }`}
        >
          <item.icon className="w-4 h-4 flex-shrink-0" />
          <span className="hidden sm:inline">{item.label}</span>
        </Link>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Open ${item.label} menu`}
          onClick={() => setOpen((v) => !v)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
            }
          }}
          className={`flex items-center px-1 py-1.5 rounded-r-lg transition-colors ${
            isActive
              ? 'bg-[#F3F4F6] text-[#6B7280]'
              : 'text-[#9CA3AF] hover:text-[#111] hover:bg-[#F9FAFB]'
          }`}
        >
          <ChevronDown
            className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {menu}
    </>
  )
}
