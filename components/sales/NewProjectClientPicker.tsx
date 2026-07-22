'use client'

// ============================================================================
// NewProjectClientPicker — client typeahead + inline create, no project id
// needed. Used by the /sales blank-project form and the kanban New Project
// modal. Extracted from app/(app)/sales/page.tsx so both surfaces share it.
// ============================================================================

import { useState, useEffect, useRef } from 'react'
import { User, X, Plus } from 'lucide-react'
import { useConfirm } from '@/components/confirm-dialog'
import { loadClients, createNewClient, type Client } from '@/lib/clients'

export default function NewProjectClientPicker({
  orgId,
  name,
  clientId,
  onPick,
  onSubmitForm,
}: {
  orgId: string | null
  name: string
  clientId: string | null
  onPick: (next: { id: string; name: string } | null) => void
  /** Enter on the search input submits the parent form when no client
   *  is being added inline. */
  onSubmitForm: () => void
}) {
  const { alert } = useConfirm()
  const [clients, setClients] = useState<Client[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    ;(async () => {
      const next = await loadClients(orgId)
      if (cancelled) return
      setClients(next)
      setLoaded(true)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  // Close the typeahead dropdown on outside click.
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const matches = query.trim()
    ? clients.filter((c) =>
        c.name.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : clients
  const exactMatch = clients.find(
    (c) => c.name.trim().toLowerCase() === query.trim().toLowerCase(),
  )

  async function handleCreate() {
    if (!orgId || saving) return
    const trimmed = newName.trim()
    if (!trimmed) {
      await alert({
        title: 'Add a name',
        message: 'A client needs a name before it can be saved.',
      })
      return
    }
    setSaving(true)
    try {
      const created = await createNewClient({
        org_id: orgId,
        name: trimmed,
        email: newEmail.trim() || undefined,
        phone: newPhone.trim() || undefined,
      })
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      onPick({ id: created.id, name: created.name })
      setAdding(false)
      setNewName('')
      setNewEmail('')
      setNewPhone('')
      setQuery('')
      setOpen(false)
    } catch (err) {
      console.error('createNewClient', err)
      await alert({
        title: 'Couldn’t create client',
        message:
          'Something went wrong inserting the client row. Open the browser console for the full error and try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  // Picked state: read-only chip with × clear. Operator can replace
  // the picked client by clicking ×, which reopens the typeahead.
  if (clientId) {
    return (
      <div className="mt-1 flex items-center gap-2 px-3 py-2 bg-[#EFF6FF] border border-[#BFDBFE] rounded-lg">
        <User className="w-3.5 h-3.5 text-[#2563EB] flex-shrink-0" />
        <span className="text-sm text-[#111] truncate flex-1">{name}</span>
        <button
          type="button"
          onClick={() => onPick(null)}
          aria-label="Clear client"
          className="text-[#9CA3AF] hover:text-[#111] flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  // Inline +Add form mode.
  if (adding) {
    return (
      <div className="mt-1 space-y-1.5 border border-[#2563EB] bg-[#EFF6FF] rounded-lg p-2.5">
        <input
          autoFocus
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleCreate()
            if (e.key === 'Escape') setAdding(false)
          }}
          placeholder="Client name"
          className="w-full text-sm bg-white border border-[#E5E7EB] rounded-md px-2.5 py-1.5 outline-none focus:border-[#2563EB]"
        />
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="Email (optional)"
            className="text-xs bg-white border border-[#E5E7EB] rounded-md px-2 py-1.5 outline-none focus:border-[#2563EB]"
          />
          <input
            type="tel"
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="text-xs bg-white border border-[#E5E7EB] rounded-md px-2 py-1.5 outline-none focus:border-[#2563EB]"
          />
        </div>
        <div className="flex justify-end gap-1.5 pt-0.5">
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="px-2.5 py-1 text-[12px] text-[#6B7280] hover:text-[#111] rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={saving || !newName.trim()}
            className="px-3 py-1 text-[12px] font-medium text-white bg-[#2563EB] rounded hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Add client'}
          </button>
        </div>
      </div>
    )
  }

  // Typeahead mode.
  return (
    <div ref={wrapRef} className="relative mt-1">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            // If typeahead has an exact match, pick it. Otherwise let
            // the parent submit (a clientless project is fine).
            if (exactMatch) {
              e.preventDefault()
              onPick({ id: exactMatch.id, name: exactMatch.name })
              setOpen(false)
            } else {
              onSubmitForm()
            }
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Type a client name…"
        className="w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB]"
      />
      {open && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-[#E5E7EB] rounded-lg shadow-lg">
          {!loaded ? (
            <div className="px-3 py-2 text-xs text-[#9CA3AF] italic">
              Loading clients…
            </div>
          ) : (
            <>
              {matches.length === 0 ? (
                <div className="px-3 py-2 text-xs text-[#9CA3AF] italic">
                  {query.trim() ? 'No matches' : 'No clients yet'}
                </div>
              ) : (
                matches.slice(0, 12).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      onPick({ id: c.id, name: c.name })
                      setOpen(false)
                      setQuery('')
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-[#F9FAFB] flex items-center gap-2"
                  >
                    <span className="flex-1 truncate text-[#111]">{c.name}</span>
                    {c.email && (
                      <span className="text-[11px] text-[#9CA3AF] truncate">
                        {c.email}
                      </span>
                    )}
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  setNewName(query.trim())
                  setAdding(true)
                  setOpen(false)
                }}
                className="w-full text-left px-3 py-2 text-sm border-t border-[#F3F4F6] hover:bg-[#EFF6FF] flex items-center gap-2 text-[#2563EB]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add new client{query.trim() ? `: "${query.trim()}"` : ''}</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
