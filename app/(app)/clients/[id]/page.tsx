'use client'

// ============================================================================
// /clients/[id] — client detail page.
// ============================================================================
// Three sections:
//   1. Header — editable client fields (name, type, phone, email, address,
//      notes). Save on blur for individual fields, or via the explicit
//      Save button at the bottom of the editor card.
//   2. Contacts — list with add/edit/remove. is_primary is exclusive
//      (handled by lib/clients).
//   3. Projects — every project with this client_id, newest first.
// Plus a Delete-client button behind a confirm.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
  Save,
  Building2,
  User,
} from 'lucide-react'
import Nav from '@/components/nav'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import {
  createContact,
  deleteClient,
  deleteContact,
  loadClientDetail,
  updateClient,
  updateContact,
  type ClientDetail,
  type Contact,
} from '@/lib/clients'
import { PROJECT_STAGE_LABEL } from '@/lib/types'

function fmtMoney(n: number | null | undefined): string {
  if (!n) return '—'
  const r = Math.round(n)
  return r < 0 ? `-$${Math.abs(r).toLocaleString()}` : `$${r.toLocaleString()}`
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ClientDetailPage() {
  const router = useRouter()
  const { id } = useParams() as { id: string }
  const { org } = useAuth()
  const { confirm, alert } = useConfirm()

  const [data, setData] = useState<ClientDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editingHeader, setEditingHeader] = useState(false)
  const [savingHeader, setSavingHeader] = useState(false)
  const [draft, setDraft] = useState<{
    name: string
    type: 'B2B' | 'D2C' | ''
    email: string
    phone: string
    address: string
    notes: string
  }>({ name: '', type: '', email: '', phone: '', address: '', notes: '' })

  const reload = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const next = await loadClientDetail(id)
    setData(next)
    if (next) {
      setDraft({
        name: next.client.name,
        type: (next.client.type as 'B2B' | 'D2C' | null) || '',
        email: next.client.email || '',
        phone: next.client.phone || '',
        address: next.client.address || '',
        notes: next.client.notes || '',
      })
    }
    setLoading(false)
  }, [id])

  useEffect(() => {
    reload()
  }, [reload])

  if (loading) {
    return (
      <>
        <Nav />
        <div className="max-w-[1100px] mx-auto px-6 py-10 text-sm text-[#9CA3AF]">
          Loading client…
        </div>
      </>
    )
  }
  if (!data) {
    return (
      <>
        <Nav />
        <div className="max-w-[820px] mx-auto px-6 py-16 text-center">
          <h1 className="text-xl font-semibold text-[#111] mb-2">
            Client not found
          </h1>
          <p className="text-sm text-[#6B7280] mb-5">
            This client either doesn't exist on this org or has been deleted.
          </p>
          <Link
            href="/clients"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to clients
          </Link>
        </div>
      </>
    )
  }

  const { client, contacts, projects } = data

  async function handleSaveHeader() {
    if (savingHeader) return
    if (!draft.name.trim()) {
      await alert({
        title: 'Add a name',
        message: 'A client needs a name before it can be saved.',
      })
      return
    }
    setSavingHeader(true)
    try {
      await updateClient(client.id, {
        name: draft.name,
        type: (draft.type || null) as 'B2B' | 'D2C' | null,
        email: draft.email,
        phone: draft.phone,
        address: draft.address,
        notes: draft.notes,
      })
      setEditingHeader(false)
      await reload()
    } catch {
      await alert({
        title: 'Couldn’t save client',
        message:
          'Something went wrong updating the client row. Open the browser console for the full error and try again.',
      })
    } finally {
      setSavingHeader(false)
    }
  }

  async function handleDeleteClient() {
    const ok = await confirm({
      title: 'Delete client?',
      message: `This removes "${client.name}" from your client list and detaches every project from this client. Project data stays. The cached client name on those projects also stays. Contacts on this client are deleted.`,
      confirmLabel: 'Delete client',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteClient(client.id)
      router.push('/clients')
    } catch {
      await alert({
        title: 'Couldn’t delete client',
        message:
          'Something went wrong deleting the row. Open the browser console for the full error and try again.',
      })
    }
  }

  return (
    <>
      <Nav />
      <div className="max-w-[1100px] mx-auto px-6 py-6 space-y-6">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Link
            href="/clients"
            className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#111]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to clients
          </Link>
          <button
            onClick={handleDeleteClient}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /> Delete client
          </button>
        </div>

        {/* Header card */}
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-5">
          {editingHeader ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
              <label className="block">
                <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                  Type
                </span>
                <select
                  value={draft.type}
                  onChange={(e) => setDraft({ ...draft, type: e.target.value as 'B2B' | 'D2C' | '' })}
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-white focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="">— unspecified —</option>
                  <option value="D2C">D2C (homeowner)</option>
                  <option value="B2B">B2B (designer / GC / architect)</option>
                </select>
              </label>
              <Field label="Email" type="email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
              <Field label="Phone" type="tel" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} />
              <Field
                label="Address"
                value={draft.address}
                onChange={(v) => setDraft({ ...draft, address: v })}
                wide
              />
              <label className="block md:col-span-2">
                <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
                  Notes
                </span>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={3}
                  placeholder="Internal notes — not shown to client"
                  className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none resize-vertical"
                />
              </label>
              <div className="md:col-span-2 flex justify-end gap-2 pt-1">
                <button
                  onClick={() => {
                    setEditingHeader(false)
                    reload()
                  }}
                  className="px-3 py-2 text-sm text-[#6B7280] hover:text-[#111] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveHeader}
                  disabled={savingHeader || !draft.name.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#2563EB] text-white text-sm font-medium rounded-lg hover:bg-[#1D4ED8] disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" /> {savingHeader ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-xl font-semibold text-[#111] truncate">
                    {client.name}
                  </h1>
                  {client.type && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#F3F4F6] text-[#6B7280] inline-flex items-center gap-1">
                      {client.type === 'B2B' ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
                      {client.type}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#6B7280]">
                  {client.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {client.email}
                    </span>
                  )}
                  {client.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {client.phone}
                    </span>
                  )}
                  {client.address && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-3 h-3" /> {client.address}
                    </span>
                  )}
                </div>
                {client.notes && (
                  <div className="mt-3 text-[12px] text-[#374151] whitespace-pre-wrap leading-relaxed bg-[#F9FAFB] border border-[#F3F4F6] rounded px-3 py-2 max-w-[640px]">
                    {client.notes}
                  </div>
                )}
              </div>
              <button
                onClick={() => setEditingHeader(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] rounded-md"
              >
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
            </div>
          )}
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <ProjectsPanel projects={projects} />
          <ContactsPanel
            clientId={client.id}
            orgId={org?.id || ''}
            contacts={contacts}
            onChange={reload}
          />
        </div>
      </div>
    </>
  )
}

function Field({
  label,
  value,
  onChange,
  type,
  wide,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  wide?: boolean
}) {
  return (
    <label className={`block ${wide ? 'md:col-span-2' : ''}`}>
      <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">
        {label}
      </span>
      <input
        type={type || 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 text-sm border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
      />
    </label>
  )
}

function ProjectsPanel({
  projects,
}: {
  projects: ClientDetail['projects']
}) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-[#111]">
          Projects
          <span className="ml-2 text-[#9CA3AF] font-normal">{projects.length}</span>
        </h2>
      </div>
      {projects.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-[#9CA3AF] italic">
          No projects on this client yet. Pick this client from the
          project-detail Client section to link one.
        </div>
      ) : (
        <div>
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="grid grid-cols-[1fr_120px_100px] gap-4 items-center px-5 py-3 border-b border-[#F3F4F6] last:border-b-0 hover:bg-[#F9FAFB] transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-[#111] truncate">
                  {p.name}
                </div>
                <div className="text-[11px] text-[#9CA3AF]">
                  Updated {fmtDate(p.updated_at)}
                </div>
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                {PROJECT_STAGE_LABEL[p.stage]}
              </div>
              <div className="text-right text-sm font-mono tabular-nums text-[#111]">
                {fmtMoney(p.bid_total)}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function ContactsPanel({
  clientId,
  orgId,
  contacts,
  onChange,
}: {
  clientId: string
  orgId: string
  contacts: Contact[]
  onChange: () => void | Promise<void>
}) {
  const { confirm, alert } = useConfirm()
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState({
    name: '',
    role: '',
    phone: '',
    email: '',
    is_primary: false,
  })
  const [saving, setSaving] = useState(false)

  function resetDraft() {
    setDraft({ name: '', role: '', phone: '', email: '', is_primary: false })
  }

  async function handleSave() {
    if (saving) return
    if (!draft.name.trim()) {
      await alert({
        title: 'Add a name',
        message: 'A contact needs a name before it can be saved.',
      })
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateContact(editingId, draft)
      } else {
        await createContact({
          client_id: clientId,
          org_id: orgId,
          ...draft,
        })
      }
      setAdding(false)
      setEditingId(null)
      resetDraft()
      await onChange()
    } catch {
      await alert({
        title: 'Couldn’t save contact',
        message:
          'Something went wrong saving the contact. Open the browser console for the full error and try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(contact: Contact) {
    const ok = await confirm({
      title: 'Remove contact?',
      message: `Remove "${contact.name}" from this client? The contact row is deleted; the rest of the client stays.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteContact(contact.id)
      await onChange()
    } catch {
      await alert({
        title: 'Couldn’t remove contact',
        message:
          'Something went wrong deleting the row. Open the browser console for the full error and try again.',
      })
    }
  }

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-[#111]">
          Contacts
          <span className="ml-2 text-[#9CA3AF] font-normal">{contacts.length}</span>
        </h2>
        {!adding && !editingId && (
          <button
            onClick={() => {
              resetDraft()
              setAdding(true)
            }}
            className="inline-flex items-center gap-1 text-[11.5px] text-[#2563EB] hover:text-[#1D4ED8]"
          >
            <Plus className="w-3 h-3" /> Add
          </button>
        )}
      </div>

      {(adding || editingId) && (
        <div className="px-5 py-3 border-b border-[#F3F4F6] space-y-2 bg-[#F9FAFB]">
          <Field label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <Field
            label="Role (optional)"
            value={draft.role}
            onChange={(v) => setDraft({ ...draft, role: v })}
          />
          <Field
            label="Email"
            type="email"
            value={draft.email}
            onChange={(v) => setDraft({ ...draft, email: v })}
          />
          <Field
            label="Phone"
            type="tel"
            value={draft.phone}
            onChange={(v) => setDraft({ ...draft, phone: v })}
          />
          <label className="flex items-center gap-2 text-[12px] text-[#374151] mt-1">
            <input
              type="checkbox"
              checked={draft.is_primary}
              onChange={(e) => setDraft({ ...draft, is_primary: e.target.checked })}
            />
            Primary contact
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => {
                setAdding(false)
                setEditingId(null)
                resetDraft()
              }}
              className="px-2.5 py-1.5 text-[12px] text-[#6B7280] hover:text-[#111] rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !draft.name.trim()}
              className="px-3 py-1.5 text-[12px] font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8] disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save' : 'Add contact'}
            </button>
          </div>
        </div>
      )}

      {contacts.length === 0 && !adding && !editingId ? (
        <div className="px-5 py-8 text-center text-sm text-[#9CA3AF] italic">
          No contacts yet. Click + Add to capture the primary point of
          contact for this client.
        </div>
      ) : (
        contacts.map((c) => (
          <div
            key={c.id}
            className="px-5 py-3 border-b border-[#F3F4F6] last:border-b-0 flex items-start gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-[#111] truncate">
                  {c.name}
                </span>
                {c.is_primary && (
                  <span className="inline-flex items-center gap-0.5 text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#92400E]">
                    <Star className="w-2.5 h-2.5" /> Primary
                  </span>
                )}
                {c.role && (
                  <span className="text-[11px] text-[#9CA3AF]">· {c.role}</span>
                )}
              </div>
              <div className="text-[11.5px] text-[#6B7280] mt-0.5 flex flex-wrap gap-x-3">
                {c.email && (
                  <span className="inline-flex items-center gap-1">
                    <Mail className="w-3 h-3" /> {c.email}
                  </span>
                )}
                {c.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="w-3 h-3" /> {c.phone}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => {
                  setEditingId(c.id)
                  setAdding(false)
                  setDraft({
                    name: c.name,
                    role: c.role || '',
                    email: c.email || '',
                    phone: c.phone || '',
                    is_primary: c.is_primary,
                  })
                }}
                className="p-1 text-[#9CA3AF] hover:text-[#111] rounded"
                aria-label="Edit contact"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleRemove(c)}
                className="p-1 text-[#D1D5DB] hover:text-[#DC2626] rounded"
                aria-label="Remove contact"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
