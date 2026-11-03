'use client'

// ============================================================================
// ProjectNotes — timestamped project notes with @mentions (125)
// ============================================================================
// One component on the pre-production page AND the project page, so the two
// can't drift. Type "@" for the people menu (roster rows with a login); a
// mention lands in that person's Mentions strip until they close it out.
//
// Opening the pane closes out YOUR open mentions on this project — you're
// looking right at them — and pings the nav badge to recount.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Trash2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { loadRosterNamesByUserId, type RosterName } from '@/lib/roster-names'
import {
  acknowledgeMyMentionsOn,
  addProjectComment,
  deleteProjectComment,
  listMentionable,
  listProjectComments,
  mentionsInBody,
  splitMentions,
  type Mentionable,
  type ProjectComment,
} from '@/lib/project-comments'

export const MENTIONS_CHANGED = 'ms:mentions-changed'

function fmtWhen(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (sameDay) return `Today ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })} · ${time}`
}

export default function ProjectNotes({ projectId, className = '' }: { projectId: string; className?: string }) {
  const { user, org } = useAuth()
  const [notes, setNotes] = useState<ProjectComment[]>([])
  const [people, setPeople] = useState<Mentionable[]>([])
  // Author names: the WHOLE roster (keeps people who've left), not just the
  // mention-able — an old note's author shouldn't turn into "Someone".
  const [roster, setRoster] = useState<Record<string, RosterName>>({})
  const [draft, setDraft] = useState('')
  const [picked, setPicked] = useState<Mentionable[]>([])
  const [query, setQuery] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const boxRef = useRef<HTMLTextAreaElement>(null)

  const nameByUserId = useMemo(
    () => new Map([...Object.entries(roster).map(([id, r]) => [id, r.name] as const), ...people.map((p) => [p.userId, p.name] as const)]),
    [people, roster],
  )

  const reload = useCallback(async () => {
    try {
      setNotes(await listProjectComments(projectId))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load notes.')
    }
  }, [projectId])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!org?.id) return
    void listMentionable(org.id).then(setPeople)
    void loadRosterNamesByUserId(org.id).then(setRoster)
  }, [org?.id])

  useEffect(() => {
    if (!user?.id) return
    void acknowledgeMyMentionsOn(user.id, projectId).then((n) => {
      if (n > 0) window.dispatchEvent(new Event(MENTIONS_CHANGED))
    })
  }, [user?.id, projectId])

  /** The "@partial" right before the caret, or null when not mentioning. */
  function readQuery(text: string, caret: number): string | null {
    const before = text.slice(0, caret)
    const m = before.match(/(?:^|\s)@([^\s@]{0,30})$/)
    return m ? m[1] : null
  }

  const matches = useMemo(() => {
    if (query == null) return []
    const q = query.toLowerCase()
    return people.filter((p) => p.userId !== user?.id && p.name.toLowerCase().includes(q)).slice(0, 6)
  }, [query, people, user?.id])

  function pick(p: Mentionable) {
    const el = boxRef.current
    const caret = el?.selectionStart ?? draft.length
    const before = draft.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.name} `)
    const next = before + draft.slice(caret)
    setDraft(next)
    setPicked((prev) => (prev.some((x) => x.userId === p.userId) ? prev : [...prev, p]))
    setQuery(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(before.length, before.length)
    })
  }

  async function post() {
    if (!user?.id || !org?.id || busy) return
    setBusy(true)
    setErr(null)
    try {
      await addProjectComment({
        orgId: org.id,
        projectId,
        authorId: user.id,
        body: draft,
        mentionUserIds: mentionsInBody(draft, picked, user.id),
      })
      setDraft('')
      setPicked([])
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save the note.')
      await reload()
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setErr(null)
    try {
      await deleteProjectComment(id)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not delete the note.')
    }
  }

  const names = useMemo(() => people.map((p) => p.name), [people])

  return (
    <section id="notes" className={'bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden scroll-mt-24 ' + className}>
      <div className="flex items-center gap-2 px-[18px] py-3 border-b border-[#F3F4F6]">
        <MessageSquare className="w-4 h-4 text-[#9CA3AF]" />
        <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-[0.08em]">Notes</span>
        {notes.length > 0 && <span className="text-[11px] text-[#9CA3AF]">{notes.length}</span>}
      </div>

      <div className="px-[18px] pt-3 pb-3 relative">
        <textarea
          ref={boxRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setQuery(readQuery(e.target.value, e.target.selectionStart ?? e.target.value.length))
          }}
          onKeyDown={(e) => {
            if (query != null && matches.length && (e.key === 'Enter' || e.key === 'Tab')) {
              e.preventDefault()
              pick(matches[0])
            } else if (e.key === 'Escape') setQuery(null)
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post()
          }}
          onBlur={() => setTimeout(() => setQuery(null), 150)}
          placeholder="Handoff notes, site notes, sales context… type @ to mention someone"
          rows={3}
          className="w-full px-3 py-2 text-[13px] rounded-lg border border-[#E5E7EB] focus:outline-none focus:border-[#2563EB] resize-y"
        />
        {query != null && matches.length > 0 && (
          <div className="absolute left-[18px] z-20 mt-1 w-64 bg-white border border-[#E5E7EB] rounded-lg shadow-lg overflow-hidden">
            {matches.map((p) => (
              <button
                key={p.userId}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(p)
                }}
                className="w-full text-left px-3 py-1.5 text-[13px] hover:bg-[#EFF6FF]"
              >
                @{p.name}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between mt-2 gap-3">
          <span className="text-[11px] text-[#9CA3AF]">
            {mentionsInBody(draft, picked, user?.id ?? null).length > 0
              ? `Lands in ${mentionsInBody(draft, picked, user?.id ?? null)
                  .map((id) => nameByUserId.get(id)?.split(' ')[0] || 'someone')
                  .join(', ')}’s mentions`
              : 'Never shown to the client.'}
          </span>
          <button
            onClick={() => void post()}
            disabled={busy || !draft.trim()}
            className="px-3 py-1.5 rounded-lg bg-[#111] text-white text-[12px] font-semibold hover:bg-[#333] disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Add note'}
          </button>
        </div>
        {err && (
          <div className="mt-2 text-[11.5px] text-[#B91C1C] bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2.5 py-1.5">
            {err}
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="border-t border-[#F3F4F6] divide-y divide-[#F3F4F6] max-h-[480px] overflow-y-auto">
          {notes.map((n) => (
            <div key={n.id} className="px-[18px] py-2.5 group">
              <div className="flex items-center justify-between gap-2 text-[11px] text-[#9CA3AF]">
                <span>
                  <span className="font-semibold text-[#374151]">
                    {(n.author_id && nameByUserId.get(n.author_id)) || 'Someone'}
                  </span>
                  {' · '}
                  {fmtWhen(n.created_at)}
                </span>
                {n.author_id === user?.id && (
                  <button
                    onClick={() => void remove(n.id)}
                    title="Delete this note"
                    className="opacity-0 group-hover:opacity-100 text-[#9CA3AF] hover:text-[#B91C1C] transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div className="text-[13px] text-[#111] mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">
                {splitMentions(n.body, names).map((part, i) =>
                  part.mention ? (
                    <span key={i} className="text-[#1D4ED8] font-medium">
                      {part.text}
                    </span>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
