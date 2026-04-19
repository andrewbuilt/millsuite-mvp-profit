'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderKanban, Clock, Settings, LogOut, Calendar, BarChart3, Users, TrendingUp, BookOpen, Target } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { hasAccess } from '@/lib/feature-flags'
import { MLogo } from '@/components/logo'

interface NavItem {
  href: string
  label: string
  icon: any
  feature?: string // if set, only show when plan has this feature
}

const ALL_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sales', label: 'Sales', icon: Target, feature: 'leads' },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/schedule', label: 'Schedule', icon: Calendar, feature: 'schedule' },
  { href: '/capacity', label: 'Capacity', icon: BarChart3, feature: 'capacity' },
  { href: '/time', label: 'Time', icon: Clock },
  { href: '/team', label: 'Team', icon: Users, feature: 'team' },
  { href: '/settings/rate-book', label: 'Rate Book', icon: BookOpen, feature: 'rate-book' },
  { href: '/reports', label: 'Reports', icon: TrendingUp, feature: 'outcomes' },
]

const MEMBER_NAV: NavItem[] = [
  { href: '/time', label: 'Time', icon: Clock },
]

export default function Nav() {
  const pathname = usePathname()
  const { user, org, signOut } = useAuth()

  const isMember = user?.role === 'member'
  const plan = org?.plan || 'starter'

  const navItems = isMember
    ? MEMBER_NAV
    : ALL_NAV.filter(item => !item.feature || hasAccess(plan, item.feature))

  return (
    <nav className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50">
      <div className="px-4 sm:px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-4 sm:gap-8">
          <div className="flex items-center gap-2">
            <Link href={isMember ? '/time' : '/dashboard'} className="flex items-center gap-2 text-base font-semibold tracking-tight text-[#111]">
              <MLogo size={20} color="#111" />
              <span className="hidden sm:inline">MillSuite</span>
            </Link>
            {org && (
              <span className="text-xs text-[#9CA3AF] hidden sm:inline">· {org.name}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {navItems.map(item => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#F3F4F6] text-[#111]'
                      : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Cross-tool links */}
          <div className="hidden lg:flex items-center gap-3 mr-2 text-xs text-[#9CA3AF]">
            <a href="https://tools.millsuite.com/dashboard" className="hover:text-[#111] transition-colors">Shop Rate</a>
            <a href="https://takeoff.millsuite.com" className="hover:text-[#111] transition-colors">Takeoff</a>
          </div>
          {!isMember && (
            <Link
              href="/settings"
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
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </nav>
  )
}
