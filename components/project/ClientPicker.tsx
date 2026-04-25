'use client'

// ============================================================================
// ClientPicker — pick or create a client on the project detail page.
// ============================================================================
// Renders a small "Client" section in the project header sidebar:
//   - dropdown of existing clients (org-scoped)
//   - "+ Add new client" inline trigger that swaps the dropdown for a
//     compact form (name / email / phone / address)
//   - "Clear" link to detach
// On save: writes projects.client_id AND projects.client_name (denorm)
// via setProjectClient so every existing read surface keeps working.
// ============================================================================

import { useEffect, useState } from 'react'
import { Plus, X, User } from 'lucide-react'
import { useConfirm } from '@/components/confirm-dialog'
import {
  createClient,
  loadClients,
  setProjectClient,
  type Client,
} from '@/lib/clients'

interface Props {
  projectId: string
  orgId: string
  /** Currently linked client_id on projects (nullable). */
  clientId: string | null
  /** Currently denormalized client_name on projects — used only to
   *  show "(unsaved)" text when client_id is null but a fallback name
   *  exists from an old import. */
  clientName: string | null
  /** Fired with the new (id, name) tuple after a successful save so the
   *  parent project page can update its local Project state without a
   *  round-trip refetch. Pass null when the user clears the client. */
  onChange: (next: { id: string; name: string } | null) => void
  /** When true, the picker is read-only — locked-stage projects show
   *  the current client without the dropdown / add form. */
  readOnly?: boolean
}

export default function ClientPicker({
  projectId,
  orgId,
  clientId,
  clientName,
  onChange,
  readOnly,
}: Props) {
  const { alert } = useConfirm()
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  // New-client form state. All optional except name.
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newAddress, setNewAddress] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const next = await loadClients(orgId)
      if (cancelled) return
      setClients(next)
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [orgId])

  const current = clients.find((c) => c.id === clientId) || null

  async function handlePick(id: string) {
    if (saving) return
    if (id === '') {
      setSaving(true)
      try {
        await setProjectClient(projectId, null)
        onChange(null)
      } catch (err) {
        await alert({
          title: 'Couldn’t clear client',
          message:
            'Something went wrong saving the change. Open the browser console for the full error and try again.',
        })
      } finally {
        setSaving(false)
      }
      return
    }
    const picked = clients.find((c) => c.id === id)
    if (!picked) return
    setSaving(true)
    try {
      await setProjectClient(projectId, { id: picked.id, name: picked.name })
      onChange({ id: picked.id, name: picked.name })
    } catch (err) {
      await alert({
        title: 'Couldn’t link client',
        message:
          'Something went wrong saving the change. Open the browser console for the full error and try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleCreate() {
    if (saving) return
    const name = newName.trim()
    if (!name) {
      await alert({
        title: 'Add a name',
        message: 'A client needs a name before it can be saved.',
      })
      return
    }
    setSaving(true)
    try {
      const created = await createClient({
        org_id: orgId,
        name,
        email: newEmail || null,
        phone: newPhone || null,
        address: newAddress || null,
      })
      if (!created) {
        await alert({
          title: 'Couldn’t create client',
          message: 'Save returned no row. See console for details.',
        })
        return
      }
      await setProjectClient(projectId, { id: created.id, name: created.name })
      setClients((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      )
      onChange({ id: created.id, name: created.name })
      setAdding(false)
      setNewName('')
      setNewEmail('')
      setNewPhone('')
      setNewAddress('')
    } catch (err) {
      await alert({
        title: 'Couldn’t create client',
        message:
          'Something went wrong inserting the client row. Open the browser console for the full error and try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <User className="w-4 h-4 text-[#9CA3AF]" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          Client
        </span>
      </div>

      {readOnly ? (
        <div className="text-sm text-[#111]">
          {current?.name || clientName || (
            <span className="italic text-[#9CA3AF]">No client linked</span>
          )}
        </div>
      ) : adding ? (
        <div className="space-y-2">
          <Field
            label="Name"
            value={newName}
            onChange={setNewName}
            placeholder="e.g. Smith family"
            autoFocus
          />
          <Field
            label="Email"
            value={newEmail}
            onChange={setNewEmail}
            placeholder="optional"
            type="email"
          />
          <Field
            label="Phone"
            value={newPhone}
            onChange={setNewPhone}
            placeholder="optional"
            type="tel"
          />
          <Field
            label="Address"
            value={newAddress}
            onChange={setNewAddress}
            placeholder="optional"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setAdding(false)
                setNewName('')
                setNewEmail('')
                setNewPhone('')
                setNewAddress('')
              }}
              className="px-2.5 py-1.5 text-[12px] text-[#6B7280] hover:text-[#111] rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={saving || !newName.trim()}
              className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save client'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <select
            value={clientId || ''}
            onChange={(e) => handlePick(e.target.value)}
            disabled={loading || saving}
            className="w-full text-sm px-2 py-1.5 border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none disabled:opacity-50 bg-white"
          >
            <option value="">— No client linked —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {clientId == null && clientName && (
            <div className="text-[11px] text-[#9CA3AF] italic leading-tight">
              Fallback name from import: <b>{clientName}</b>. Pick or add a
              client above to link it properly.
            </div>
          )}
          <button
            onClick={() => setAdding(true)}
            className="text-[11.5px] inline-flex items-center gap-1 text-[#2563EB] hover:text-[#1D4ED8]"
          >
            <Plus className="w-3 h-3" /> Add new client
          </button>
        </>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type,
  autoFocus,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  autoFocus?: boolean
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
        {label}
      </span>
      <input
        type={type || 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className="mt-1 w-full px-2 py-1.5 text-sm border border-[#E5E7EB] rounded-md focus:border-[#2563EB] focus:outline-none"
      />
    </label>
  )
}
