'use client'

// ============================================================================
// /clients/[id] — direct-link detail page.
// ============================================================================
// Two-column layout ported from built-os (app/clients/[id]/page.tsx in
// /Users/codecity/code/built-os):
//   - Left (lg:col-span-2): Client Information form (autosave on blur) +
//     Projects list.
//   - Right (lg:col-span-1, sticky): Contacts panel with inline add +
//     click-to-edit cards.
// Header: back button + delete-client.
// The list page (/clients) opens the same data in a side pane — direct
// links land here so a deep-linked URL still works.
// ============================================================================

import { useEffect, useState, FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Trash2,
  Mail,
  Phone,
  User,
  Plus,
  Building2,
  ChevronRight,
} from 'lucide-react'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import { createNewContact, getContacts, type Client, type Contact } from '@/lib/clients'

interface ProjectSummary {
  id: string
  name: string
  stage: string
  bid_total: number | null
  created_at: string
}

// ── Inline contact form ──

function NewContactForm({
  clientId,
  orgId,
  onSave,
  onCancel,
}: {
  clientId: string
  orgId: string
  onSave: (contact: Contact) => void
  onCancel: () => void
}) {
  const { alert } = useConfirm()
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    role: '',
    is_primary: false,
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!formData.name.trim()) return
    try {
      setSaving(true)
      const newContact = await createNewContact({
        ...formData,
        client_id: clientId,
        org_id: orgId,
      })
      onSave(newContact)
    } catch (err) {
      console.error('Error creating contact:', err)
      await alert({
        title: 'Couldn’t add contact',
        message: 'Something went wrong saving the contact. See console for the full error.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border border-[#2563EB] bg-[#EFF6FF] rounded-xl p-4 space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1">
            Name *
          </label>
          <input
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
            placeholder="Contact name"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1">
            Role
          </label>
          <input
            type="text"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
            placeholder="e.g., Project Manager"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1">
            Email
          </label>
          <input
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
            placeholder="email@example.com"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1">
            Phone
          </label>
          <input
            type="tel"
            value={formData.phone}
            onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
            placeholder="555-0123"
          />
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <label className="flex items-center gap-2 text-sm text-[#6B7280] cursor-pointer">
          <input
            type="checkbox"
            checked={formData.is_primary}
            onChange={(e) => setFormData({ ...formData, is_primary: e.target.checked })}
            className="w-4 h-4 text-[#2563EB] border-[#D1D5DB] rounded focus:ring-[#2563EB]"
          />
          Primary contact
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-1.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </form>
  )
}

// ── Editable contact card ──

function ContactCard({
  contact,
  onUpdate,
}: {
  contact: Contact
  onUpdate: () => void
}) {
  const { confirm, alert } = useConfirm()
  const [editing, setEditing] = useState(false)
  const [fields, setFields] = useState({
    name: contact.name || '',
    role: contact.role || '',
    email: contact.email || '',
    phone: contact.phone || '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('contacts')
      .update({
        name: fields.name.trim(),
        role: fields.role.trim() || null,
        email: fields.email.trim() || null,
        phone: fields.phone.trim() || null,
      })
      .eq('id', contact.id)
    setSaving(false)
    if (error) {
      console.error('updateContact', error)
      await alert({
        title: 'Couldn’t save contact',
        message: 'Something went wrong saving the contact. See console for the full error.',
      })
      return
    }
    setEditing(false)
    onUpdate()
  }

  async function handleDelete() {
    const ok = await confirm({
      title: 'Remove contact?',
      message: `Remove "${contact.name}" from this client? The contact row is deleted; the rest of the client stays.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    })
    if (!ok) return
    await supabase.from('contacts').delete().eq('id', contact.id)
    onUpdate()
  }

  if (editing) {
    return (
      <div className="border border-[#2563EB] bg-[#EFF6FF] rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] uppercase tracking-wide mb-1">
              Name
            </label>
            <input
              type="text"
              value={fields.name}
              onChange={(e) => setFields((p) => ({ ...p, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] uppercase tracking-wide mb-1">
              Role
            </label>
            <input
              type="text"
              value={fields.role}
              onChange={(e) => setFields((p) => ({ ...p, role: e.target.value }))}
              className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              placeholder="e.g., Project Manager"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] uppercase tracking-wide mb-1">
              Email
            </label>
            <input
              type="email"
              value={fields.email}
              onChange={(e) => setFields((p) => ({ ...p, email: e.target.value }))}
              className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-[#6B7280] uppercase tracking-wide mb-1">
              Phone
            </label>
            <input
              type="text"
              value={fields.phone}
              onChange={(e) => setFields((p) => ({ ...p, phone: e.target.value }))}
              className="w-full px-3 py-2 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              placeholder="(555) 000-0000"
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <button
            onClick={handleDelete}
            className="text-xs text-[#DC2626] hover:text-[#B91C1C] transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 inline mr-1" />
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !fields.name.trim()}
              className="px-4 py-1.5 bg-[#2563EB] text-white rounded-lg text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      onClick={() => setEditing(true)}
      className="border border-[#E5E7EB] rounded-xl p-4 hover:border-[#2563EB] hover:bg-[#F9FAFB] transition-colors cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-sm font-semibold text-[#111]">{contact.name}</span>
          {contact.role && (
            <span className="text-xs text-[#9CA3AF] ml-2">{contact.role}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {contact.is_primary && (
            <span className="px-2 py-0.5 bg-[#EFF6FF] text-[#2563EB] text-xs font-medium rounded-full">
              Primary
            </span>
          )}
          <span className="text-[10px] text-[#D1D5DB] group-hover:text-[#9CA3AF] transition-colors">
            Edit
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {contact.email && (
          <span className="flex items-center gap-1.5 text-xs text-[#6B7280]">
            <Mail className="w-3 h-3" />
            {contact.email}
          </span>
        )}
        {contact.phone && (
          <span className="flex items-center gap-1.5 text-xs text-[#6B7280]">
            <Phone className="w-3 h-3" />
            {contact.phone}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Page ──

export default function ClientDetailPage() {
  const router = useRouter()
  const { org } = useAuth()
  const { confirm, alert } = useConfirm()
  const { id } = useParams() as { id: string }

  const [client, setClient] = useState<Client | null>(null)
  const [contacts, setContacts] = useState<Contact[]>([])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewContact, setShowNewContact] = useState(false)

  async function loadClient() {
    setLoading(true)
    try {
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('id', id)
        .single()
      if (clientError) throw clientError
      setClient(clientData as Client)

      const contactsData = await getContacts(id)
      setContacts(contactsData)

      const { data: projectsData } = await supabase
        .from('projects')
        .select('id, name, stage, bid_total, created_at')
        .eq('client_id', id)
        .order('created_at', { ascending: false })
      setProjects((projectsData || []) as ProjectSummary[])
    } catch (err) {
      console.error('Error loading client:', err)
      setClient(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClient()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function updateClientField(field: keyof Client, value: string) {
    if (!client) return
    if (value === ((client[field] as string | null | undefined) || '')) return
    try {
      const { error } = await supabase
        .from('clients')
        .update({ [field]: value, updated_at: new Date().toISOString() })
        .eq('id', client.id)
      if (error) throw error
      setClient({ ...client, [field]: value } as Client)
      // Propagate name to projects.client_name (denormalized fallback).
      if (field === 'name') {
        await supabase
          .from('projects')
          .update({ client_name: value, updated_at: new Date().toISOString() })
          .eq('client_id', client.id)
      }
    } catch (err) {
      console.error('Error updating client:', err)
      await alert({
        title: 'Couldn’t save client',
        message: 'Something went wrong updating the client. See console for the full error.',
      })
    }
  }

  async function deleteClientRow() {
    if (!client) return
    const ok = await confirm({
      title: 'Delete client?',
      message: `Delete "${client.name}"? Projects detach (client_id null) but their cached client_name stays. Contacts cascade.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await supabase
        .from('projects')
        .update({ client_id: null, updated_at: new Date().toISOString() })
        .eq('client_id', client.id)
      const { error } = await supabase.from('clients').delete().eq('id', client.id)
      if (error) throw error
      router.push('/clients')
    } catch (err) {
      console.error('Error deleting client:', err)
      await alert({
        title: 'Couldn’t delete client',
        message: 'Something went wrong deleting the client. See console for the full error.',
      })
    }
  }

  if (loading) {
    return (
      <>
        <Nav />
        <div className="max-w-6xl mx-auto px-6 py-10 text-sm text-[#9CA3AF]">
          Loading client…
        </div>
      </>
    )
  }
  if (!client) {
    return (
      <>
        <Nav />
        <div className="max-w-[820px] mx-auto px-6 py-16 text-center">
          <h1 className="text-xl font-semibold text-[#111] mb-2">Client not found</h1>
          <p className="text-sm text-[#6B7280] mb-5">
            This client either doesn't exist on this org or has been deleted.
          </p>
          <button
            onClick={() => router.push('/clients')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-[#2563EB] text-white hover:bg-[#1D4ED8]"
          >
            <ArrowLeft className="w-4 h-4" /> Back to clients
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-[#F9FAFB]">
        <div className="bg-white border-b border-[#E5E7EB] sticky top-14 z-30">
          <div className="max-w-6xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <button
                  onClick={() => router.push('/clients')}
                  className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2.5 rounded-xl ${
                      client.type === 'B2B'
                        ? 'bg-[#EFF6FF] text-[#2563EB]'
                        : 'bg-[#ECFDF5] text-[#059669]'
                    }`}
                  >
                    {client.type === 'B2B' ? (
                      <Building2 className="w-5 h-5" />
                    ) : (
                      <User className="w-5 h-5" />
                    )}
                  </div>
                  <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[#111]">
                      {client.name}
                    </h1>
                    <span className="text-xs text-[#9CA3AF]">{client.type ?? 'D2C'}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={deleteClientRow}
                className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
                title="Delete client"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left — info + projects */}
            <div className="lg:col-span-2 space-y-8">
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
                <h2 className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-5">
                  Client Information
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[#6B7280] mb-1.5">
                      Name
                    </label>
                    <input
                      type="text"
                      defaultValue={client.name}
                      onBlur={(e) => updateClientField('name', e.target.value)}
                      className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#6B7280] mb-1.5">
                      Type
                    </label>
                    <select
                      defaultValue={client.type ?? 'D2C'}
                      onChange={async (e) => {
                        const val = e.target.value as 'B2B' | 'D2C'
                        await supabase
                          .from('clients')
                          .update({ type: val, updated_at: new Date().toISOString() })
                          .eq('id', client.id)
                        setClient({ ...client, type: val })
                      }}
                      className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                    >
                      <option value="D2C">D2C (homeowner)</option>
                      <option value="B2B">B2B (designer / GC / architect)</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[#6B7280] mb-1.5">
                        Email
                      </label>
                      <input
                        type="email"
                        defaultValue={client.email || ''}
                        onBlur={(e) => updateClientField('email', e.target.value)}
                        className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                        placeholder="email@company.com"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#6B7280] mb-1.5">
                        Phone
                      </label>
                      <input
                        type="tel"
                        defaultValue={client.phone || ''}
                        onBlur={(e) => updateClientField('phone', e.target.value)}
                        className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                        placeholder="555-0123"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#6B7280] mb-1.5">
                      Address
                    </label>
                    <textarea
                      defaultValue={client.address || ''}
                      rows={2}
                      onBlur={(e) => updateClientField('address', e.target.value)}
                      className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors resize-none"
                      placeholder="Street address, city, state"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#6B7280] mb-1.5">
                      Notes
                    </label>
                    <textarea
                      defaultValue={client.notes || ''}
                      rows={3}
                      onBlur={(e) => updateClientField('notes', e.target.value)}
                      className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors resize-none"
                      placeholder="Internal notes about this client…"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white border border-[#E5E7EB] rounded-xl p-6">
                <h2 className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-5">
                  Projects ({projects.length})
                </h2>
                {projects.length === 0 ? (
                  <p className="text-sm text-[#9CA3AF] text-center py-6">No projects yet</p>
                ) : (
                  <div className="space-y-2">
                    {projects.map((project) => (
                      <div
                        key={project.id}
                        onClick={() => router.push(`/projects/${project.id}`)}
                        className="flex items-center justify-between border border-[#E5E7EB] rounded-xl px-4 py-3 hover:border-[#D1D5DB] cursor-pointer transition-colors group"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-[#111] group-hover:text-[#2563EB] transition-colors truncate block">
                            {project.name}
                          </span>
                          <span className="text-xs text-[#9CA3AF]">{project.stage}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {project.bid_total != null && (
                            <span className="text-sm font-mono tabular-nums text-[#111]">
                              ${project.bid_total.toLocaleString()}
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-[#D1D5DB] group-hover:text-[#6B7280] transition-colors" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right — sticky contacts */}
            <div className="lg:col-span-1">
              <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 sticky top-32">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
                    Contacts ({contacts.length})
                  </h2>
                  {!showNewContact && (
                    <button
                      onClick={() => setShowNewContact(true)}
                      className="flex items-center gap-1 text-xs font-medium text-[#2563EB] hover:text-[#1D4ED8] transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add
                    </button>
                  )}
                </div>
                <div className="space-y-3">
                  {showNewContact && org?.id && (
                    <NewContactForm
                      clientId={id}
                      orgId={org.id}
                      onSave={() => {
                        setShowNewContact(false)
                        loadClient()
                      }}
                      onCancel={() => setShowNewContact(false)}
                    />
                  )}
                  {contacts.length === 0 && !showNewContact ? (
                    <p className="text-sm text-[#9CA3AF] py-4 text-center">No contacts yet</p>
                  ) : (
                    contacts.map((contact) => (
                      <ContactCard
                        key={contact.id}
                        contact={contact}
                        onUpdate={loadClient}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
