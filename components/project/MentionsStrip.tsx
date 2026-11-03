'use client'

// ============================================================================
// MentionsStrip + MentionsBadge — "someone @'d you in a project note" (125)
// ============================================================================
// The close-the-loop pattern (114, CompletedForYou): your open mentions, each
// with the note, who wrote it, a link to the project's notes and a Close out.
// Opening the project's notes closes them out too (ProjectNotes). In-app only.
//
// Mounted on /pm for managers AND /me for workers — the @ menu offers anyone
// with a login, and a mention to someone who can't see the strip would be a
// note that silently never arrives. Renders nothing when empty (day-one rule).
//
// The badge sits in the nav beside Tasks, so a mention is visible from any
// page. Both recount on the MENTIONS_CHANGED window event.
// ============================================================================

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AtSign } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/lib/auth-context'
import { loadRosterNamesByUserId, type RosterName } from '@/lib/roster-names'
import { acknowledgeMention, countMyMentions, listMyMentions, type MyMention } from '@/lib/project-comments'
import { MENTIONS_CHANGED } from './ProjectNotes'

export function MentionsStrip() {
  const { user, org } = useAuth()
  const [rows, setRows] = useState<MyMention[]>([])
  const [names, setNames] = useState<Record<string, RosterName>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user?.id) return
    setRows(await listMyMentions(user.id))
  }, [user?.id])

  useEffect(() => {
    void reload()
    const on = () => void reload()
    window.addEventListener(MENTIONS_CHANGED, on)
    return () => window.removeEventListener(MENTIONS_CHANGED, on)
  }, [reload])

  useEffect(() => {
    if (org?.id) void loadRosterNamesByUserId(org.id).then(setNames)
  }, [org?.id])

  if (rows.length === 0) return null

  async function close(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await acknowledgeMention(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      window.dispatchEvent(new Event(MENTIONS_CHANGED))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not close that out.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section id="mentions" className="bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-[#BFDBFE]/60">
        <AtSign className="w-4 h-4 text-[#2563EB] flex-shrink-0" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[#1D4ED8]">Mentions</span>
        <span className="text-[11px] text-[#2563EB]">{rows.length}</span>
      </div>
      {error && (
        <div className="mx-4 mt-2 text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}
      <div className="divide-y divide-[#BFDBFE]/40">
        {rows.map((m) => {
          const who = m.author_id ? names[m.author_id]?.name : null
          return (
            <div key={m.id} className="px-4 py-2.5 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[10.5px] text-[#2563EB]">
                  {who ? who.split(' ')[0] : 'Someone'} ·{' '}
                  {/* Workers are confined to /me (RoleGate) — a link would bounce. */}
                  {user?.role === 'member' ? (
                    <span className="font-semibold">{m.project_name}</span>
                  ) : (
                    <Link href={`/projects/${m.project_id}#notes`} className="font-semibold hover:underline">
                      {m.project_name}
                    </Link>
                  )}
                </div>
                <div className="text-[12.5px] text-[#1E3A8A] leading-snug mt-0.5 line-clamp-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {m.body}
                </div>
              </div>
              <button
                onClick={() => void close(m.id)}
                disabled={busyId === m.id}
                className="flex-shrink-0 px-2.5 py-1 rounded-md border border-[#2563EB] text-[#1D4ED8] bg-white text-[11px] font-medium hover:bg-[#DBEAFE] disabled:opacity-50 transition-colors"
              >
                {busyId === m.id ? 'Closing…' : 'Close out'}
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function MentionsBadge() {
  const { user } = useAuth()
  const pathname = usePathname()
  const [n, setN] = useState(0)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const count = () =>
      void countMyMentions(user.id).then((c) => {
        if (!cancelled) setN(c)
      })
    count()
    window.addEventListener(MENTIONS_CHANGED, count)
    return () => {
      cancelled = true
      window.removeEventListener(MENTIONS_CHANGED, count)
    }
  }, [user?.id, pathname])

  if (n === 0) return null
  const home = user?.role === 'member' ? '/me' : '/pm'
  return (
    <Link
      href={`${home}#mentions`}
      title={`${n} mention${n === 1 ? '' : 's'} waiting`}
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-semibold text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] hover:bg-[#DBEAFE] transition-colors"
    >
      <AtSign className="w-3.5 h-3.5" />
      {n}
    </Link>
  )
}
