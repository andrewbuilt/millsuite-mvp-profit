'use client'

// ============================================================================
// /clients — list of every client in the org.
// ============================================================================
// Mirrors the project-detail Client picker but as a top-level page. Each
// row shows: client name + type, primary contact (name · email),
// active project count, last activity (max projects.updated_at across the
// client's projects). Click a row → /clients/[id] detail.
//
// Add-client lives inline at the bottom of the table — same one-name-line
// quick-add the picker uses, so the operator doesn't have to leave the
// page to capture a new lead's contact info.
// ============================================================================

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, User } from 'lucide-react'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import {
  createClient,
  loadClientsWithMeta,
  type ClientWithMeta,
} from '@/lib/clients'

function fmtRelative(iso: string | null): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  const ms = Date.now() - then
  const days = Math.floor(ms / (1000 * 60 * 60 * 24))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 60) return `${Math.floor(days / 7)}w ago`
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ClientsListPage() {
  const router = useRouter()
  const { org } = useAuth()
  const { alert } = useConfirm()
  const [clients, setClients] = useState<ClientWithMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  async function reload() {
    if (!org?.id) return
    setLoading(true)
    setClients(await loadClientsWithMeta(org.id))
    setLoading(false)
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id])

  async function handleQuickAdd() {
    if (!org?.id) return
    const name = newName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const created = await createClient({ org_id: org.id, name })
      if (!created) {
        await alert({
          title: 'Couldn’t create client',
          message: 'Save returned no row. See console for details.',
        })
        return
      }
      setNewName('')
      router.push(`/clients/${created.id}`)
    } catch {
      await alert({
        title: 'Couldn’t create client',
        message:
          'Something went wrong inserting the client row. Open the browser console for the full error and try again.',
      })
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      <Nav />
      <div className="max-w-[1200px] mx-auto px-6 py-6">
        <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-[#111]">Clients</h1>
            <p className="text-sm text-[#6B7280] mt-1">
              Every household and business this shop is working with. Click
              any row to see contacts and projects.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-[#9CA3AF]">Loading clients…</div>
        ) : (
          <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
            <div className="grid grid-cols-[1.5fr_1.5fr_120px_140px] px-4 py-2.5 bg-[#F9FAFB] border-b border-[#E5E7EB] text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
              <div>Client</div>
              <div>Primary contact</div>
              <div className="text-right">Active projects</div>
              <div className="text-right">Last activity</div>
            </div>

            {clients.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[#9CA3AF] italic">
                No clients yet. Add your first one below — or pick a client on
                a project's Client section to create one inline.
              </div>
            ) : (
              clients.map((c) => (
                <Link
                  key={c.id}
                  href={`/clients/${c.id}`}
                  className="grid grid-cols-[1.5fr_1.5fr_120px_140px] px-4 py-3 border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] transition-colors items-center"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[#111] truncate">
                      {c.name}
                    </div>
                    <div className="text-[11px] text-[#9CA3AF] truncate">
                      {[c.type, c.email, c.phone].filter(Boolean).join(' · ') ||
                        'No contact info on file'}
                    </div>
                  </div>
                  <div className="min-w-0 text-xs text-[#374151]">
                    {c.primary_contact ? (
                      <>
                        <span className="font-medium text-[#111] truncate block">
                          {c.primary_contact.name}
                          {c.primary_contact.role && (
                            <span className="text-[#9CA3AF] font-normal">
                              {' · '}
                              {c.primary_contact.role}
                            </span>
                          )}
                        </span>
                        <span className="text-[11px] text-[#9CA3AF] truncate block">
                          {[c.primary_contact.email, c.primary_contact.phone]
                            .filter(Boolean)
                            .join(' · ') || '—'}
                        </span>
                      </>
                    ) : (
                      <span className="italic text-[#9CA3AF]">No contacts</span>
                    )}
                  </div>
                  <div className="text-right text-sm font-mono tabular-nums text-[#111]">
                    {c.active_project_count}
                  </div>
                  <div className="text-right text-xs text-[#6B7280]">
                    {fmtRelative(c.last_activity_at)}
                  </div>
                </Link>
              ))
            )}

            {/* Inline quick-add — name only; the rest is captured on the
                detail page. Same shape the project picker uses. */}
            <div className="px-4 py-3 border-t border-[#E5E7EB] bg-[#FAFAFA] flex items-center gap-2">
              <User className="w-4 h-4 text-[#9CA3AF]" />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleQuickAdd()
                }}
                placeholder="Add a client — type a name and press ⏎"
                className="flex-1 bg-transparent border-none outline-none text-sm placeholder:text-[#9CA3AF]"
                disabled={creating}
              />
              <button
                onClick={handleQuickAdd}
                disabled={creating || !newName.trim()}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] disabled:opacity-50"
              >
                <Plus className="w-3 h-3" />
                {creating ? 'Adding…' : 'Add client'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
