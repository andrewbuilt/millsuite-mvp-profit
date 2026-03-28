'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderKanban, Clock, Settings, LogOut } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { MLogo } from '@/components/logo'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/time', label: 'Time', icon: Clock },
]

export default function Nav() {
  const pathname = usePathname()
  const { org, signOut } = useAuth()

  return (
    <nav className="bg-white border-b border-[#E5E7EB] sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="flex items-center gap-2 text-base font-semibold tracking-tight text-[#111]">
              <MLogo size={20} color="#111" />
              MillSuite
            </Link>
            {org && (
              <span className="text-xs text-[#9CA3AF] hidden sm:inline">· {org.name}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map(item => {
              const isActive = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#F3F4F6] text-[#111]'
                      : 'text-[#6B7280] hover:text-[#111] hover:bg-[#F9FAFB]'
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
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
