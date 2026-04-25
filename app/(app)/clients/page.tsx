'use client'

// ============================================================================
// /clients — top-level CRM dashboard.
// ============================================================================
// Ports built-os's clients page (app/clients/page.tsx in /Users/codecity/
// code/built-os) into millsuite. Same shape:
//   - Table: name + type icon, type badge, email, phone, projects count,
//     contacts count.
//   - Filters: search (name/email/phone), type (All/B2B/D2C), sort.
//   - "+ New Client" → modal.
//   - Click a row → side pane with editable client + contacts + projects.
// What changes from built-os:
//   - Wraps in millsuite's Nav.
//   - Replaces native alert/confirm with the in-app useConfirm modal.
//   - Org-scoped reads (built-os doesn't multi-tenant; millsuite does).
// ============================================================================

import { useEffect, useState, useRef, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search,
  Plus,
  X,
  Building2,
  User,
  Mail,
  Phone,
  ChevronRight,
  Trash2,
} from 'lucide-react'
import Nav from '@/components/nav'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useConfirm } from '@/components/confirm-dialog'
import {
  createNewClient,
  createNewContact,
  getContacts,
  type Client,
  type Contact,
} from '@/lib/clients'

// ── Types ──

interface ClientWithCounts extends Client {
  project_count: number
  contact_count: number
}

interface ProjectSummary {
  id: string
  name: string
  stage: string
  bid_total: number | null
  created_at: string
}

// ── New Client modal ──

function NewClientModal({
  orgId,
  onClose,
  onSave,
}: {
  orgId: string
  onClose: () => void
  onSave: (client: Client) => void
}) {
  const { alert } = useConfirm()
  const [formData, setFormData] = useState<{
    name: string
    type: 'B2B' | 'D2C'
    phone: string
    email: string
    address: string
    notes: string
  }>({
    name: '',
    type: 'D2C',
    phone: '',
    email: '',
    address: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!formData.name.trim()) return
    try {
      setSaving(true)
      const newClient = await createNewClient({ ...formData, org_id: orgId })
      onSave(newClient)
      onClose()
    } catch (err) {
      console.error('Error creating client:', err)
      await alert({
        title: 'Couldn’t create client',
        message:
          'Something went wrong saving the client. Open the browser console for the full error and try again.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white rounded-xl border border-[#E5E7EB] p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-semibold tracking-tight text-[#111]">New Client</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1.5">
              Client Name *
            </label>
            <input
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              placeholder="e.g., Acme Corporation"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1.5">
              Type
            </label>
            <select
              value={formData.type}
              onChange={(e) => setFormData({ ...formData, type: e.target.value as 'B2B' | 'D2C' })}
              className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
            >
              <option value="D2C">D2C (homeowner)</option>
              <option value="B2B">B2B (designer / GC / architect)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                placeholder="email@company.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1.5">
                Phone
              </label>
              <input
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                placeholder="555-0123"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-1.5">
              Address
            </label>
            <textarea
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              rows={2}
              className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors resize-none"
              placeholder="123 Main St, Tampa, FL"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 px-5 py-2.5 bg-white text-[#111] border border-[#E5E7EB] rounded-xl text-sm font-medium hover:bg-[#F9FAFB] hover:border-[#D1D5DB] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-5 py-2.5 bg-[#2563EB] text-white rounded-xl text-sm font-medium hover:bg-[#1D4ED8] transition-colors disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── New contact inline form ──

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

// ── Side pane (rendered from list page when a row is clicked) ──

function ClientSidePane({
  client,
  contacts,
  projects,
  orgId,
  onClose,
  onUpdateClient,
  onDeleteClient,
  onContactAdded,
  onNavigateProject,
}: {
  client: ClientWithCounts
  contacts: Contact[]
  projects: ProjectSummary[]
  orgId: string
  onClose: () => void
  onUpdateClient: (id: string, updates: Partial<Client>) => Promise<void>
  onDeleteClient: (id: string) => void
  onContactAdded: () => void
  onNavigateProject: (id: string) => void
}) {
  const [showNewContact, setShowNewContact] = useState(false)
  const paneRef = useRef<HTMLDivElement>(null)

  function handleFieldBlur(field: keyof Client, value: string) {
    if (value !== (client[field] || '')) {
      onUpdateClient(client.id, { [field]: value })
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={paneRef}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg bg-white border-l border-[#E5E7EB] overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-white border-b border-[#F3F4F6] px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-lg ${
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
                <h2 className="text-lg font-semibold tracking-tight text-[#111]">
                  {client.name}
                </h2>
                <span className="text-xs text-[#9CA3AF]">{client.type ?? 'D2C'}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => onDeleteClient(client.id)}
                className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] transition-colors"
                title="Delete client"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-8">
          <section>
            <h3 className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-4">
              Client Information
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Name</label>
                <input
                  type="text"
                  defaultValue={client.name}
                  onBlur={(e) => handleFieldBlur('name', e.target.value)}
                  className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Type</label>
                <select
                  defaultValue={client.type ?? 'D2C'}
                  onChange={(e) =>
                    onUpdateClient(client.id, { type: e.target.value as 'B2B' | 'D2C' })
                  }
                  className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                >
                  <option value="D2C">D2C (homeowner)</option>
                  <option value="B2B">B2B (designer / GC / architect)</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Email</label>
                  <input
                    type="email"
                    defaultValue={client.email || ''}
                    onBlur={(e) => handleFieldBlur('email', e.target.value)}
                    className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                    placeholder="email@company.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Phone</label>
                  <input
                    type="tel"
                    defaultValue={client.phone || ''}
                    onBlur={(e) => handleFieldBlur('phone', e.target.value)}
                    className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                    placeholder="555-0123"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Address</label>
                <textarea
                  defaultValue={client.address || ''}
                  rows={2}
                  onBlur={(e) => handleFieldBlur('address', e.target.value)}
                  className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors resize-none"
                  placeholder="Street address, city, state"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#6B7280] mb-1.5">Notes</label>
                <textarea
                  defaultValue={client.notes || ''}
                  rows={3}
                  onBlur={(e) => handleFieldBlur('notes', e.target.value)}
                  className="w-full px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors resize-none"
                  placeholder="Internal notes about this client…"
                />
              </div>
            </div>
          </section>

          <div className="border-t border-[#E5E7EB]" />

          <section>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
                Contacts ({contacts.length})
              </h3>
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
              {showNewContact && (
                <NewContactForm
                  clientId={client.id}
                  orgId={orgId}
                  onSave={() => {
                    setShowNewContact(false)
                    onContactAdded()
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
                    onUpdate={onContactAdded}
                  />
                ))
              )}
            </div>
          </section>

          <div className="border-t border-[#E5E7EB]" />

          <section>
            <h3 className="text-xs font-medium text-[#6B7280] uppercase tracking-wide mb-4">
              Projects ({projects.length})
            </h3>
            {projects.length === 0 ? (
              <p className="text-sm text-[#9CA3AF] py-4 text-center">No projects yet</p>
            ) : (
              <div className="space-y-2">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    onClick={() => onNavigateProject(project.id)}
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
          </section>
        </div>
      </div>
    </>
  )
}

// ── Page ──

export default function ClientsPage() {
  const router = useRouter()
  const { org } = useAuth()
  const { confirm, alert } = useConfirm()
  const [clients, setClients] = useState<ClientWithCounts[]>([])
  const [filteredClients, setFilteredClients] = useState<ClientWithCounts[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | 'B2B' | 'D2C'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'type' | 'date'>('name')
  const [showNewClientModal, setShowNewClientModal] = useState(false)

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [paneContacts, setPaneContacts] = useState<Contact[]>([])
  const [paneProjects, setPaneProjects] = useState<ProjectSummary[]>([])
  const [paneLoading, setPaneLoading] = useState(false)

  const selectedClient = clients.find((c) => c.id === selectedClientId) || null

  async function loadClientsList() {
    if (!org?.id) return
    setLoading(true)
    try {
      const { data: clientsData, error } = await supabase
        .from('clients')
        .select('*')
        .eq('org_id', org.id)
        .order('name')
      if (error) throw error

      // Single pass: pull all counts at once instead of N+1.
      const ids = (clientsData || []).map((c: any) => c.id)
      let contactCounts = new Map<string, number>()
      let projectCounts = new Map<string, number>()
      if (ids.length > 0) {
        const [{ data: contactRows }, { data: projectRows }] = await Promise.all([
          supabase.from('contacts').select('client_id').in('client_id', ids),
          supabase.from('projects').select('client_id').in('client_id', ids),
        ])
        for (const r of (contactRows || []) as Array<{ client_id: string | null }>) {
          if (!r.client_id) continue
          contactCounts.set(r.client_id, (contactCounts.get(r.client_id) || 0) + 1)
        }
        for (const r of (projectRows || []) as Array<{ client_id: string | null }>) {
          if (!r.client_id) continue
          projectCounts.set(r.client_id, (projectCounts.get(r.client_id) || 0) + 1)
        }
      }

      const clientsWithCounts: ClientWithCounts[] = (clientsData || []).map((c: any) => ({
        ...(c as Client),
        contact_count: contactCounts.get(c.id) || 0,
        project_count: projectCounts.get(c.id) || 0,
      }))
      setClients(clientsWithCounts)
    } catch (err) {
      console.error('Error loading clients:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadClientsList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org?.id])

  useEffect(() => {
    let filtered = [...clients]
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q),
      )
    }
    if (typeFilter !== 'all') {
      filtered = filtered.filter((c) => c.type === typeFilter)
    }
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '')
        case 'type':
          return (a.type || '').localeCompare(b.type || '')
        case 'date':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        default:
          return 0
      }
    })
    setFilteredClients(filtered)
  }, [clients, searchQuery, typeFilter, sortBy])

  async function openClientPane(clientId: string) {
    setSelectedClientId(clientId)
    setPaneLoading(true)
    try {
      const contactsData = await getContacts(clientId)
      setPaneContacts(contactsData)
      const { data: projectsData } = await supabase
        .from('projects')
        .select('id, name, stage, bid_total, created_at')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false })
      setPaneProjects((projectsData || []) as ProjectSummary[])
    } catch (err) {
      console.error('Error loading client details:', err)
    } finally {
      setPaneLoading(false)
    }
  }

  function closePane() {
    setSelectedClientId(null)
    setPaneContacts([])
    setPaneProjects([])
  }

  async function handleUpdateClient(id: string, updates: Partial<Client>) {
    try {
      const { error } = await supabase.from('clients').update({
        ...updates,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw error
      setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)))
      // Propagate name to projects.client_name (denorm cache documented
      // in SYSTEM-MAP.md "Denormalized columns").
      if (typeof updates.name === 'string') {
        await supabase
          .from('projects')
          .update({
            client_name: updates.name,
            updated_at: new Date().toISOString(),
          })
          .eq('client_id', id)
      }
    } catch (err) {
      console.error('Error updating client:', err)
      await alert({
        title: 'Couldn’t update client',
        message: 'Something went wrong saving the change. See console for the full error.',
      })
    }
  }

  async function handleDeleteClient(id: string) {
    const client = clients.find((c) => c.id === id)
    if (!client) return
    const ok = await confirm({
      title: 'Delete client?',
      message: `Delete "${client.name}"? This detaches every project from this client and removes its contacts. Project data stays. The cached client name on those projects also stays so cards keep reading sensibly.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    })
    if (!ok) return
    try {
      // Detach projects.client_id first (no FK constraint in migration 001).
      await supabase
        .from('projects')
        .update({ client_id: null, updated_at: new Date().toISOString() })
        .eq('client_id', id)
      const { error } = await supabase.from('clients').delete().eq('id', id)
      if (error) throw error
      closePane()
      setClients((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      console.error('Error deleting client:', err)
      await alert({
        title: 'Couldn’t delete client',
        message: 'Something went wrong deleting the client. See console for the full error.',
      })
    }
  }

  return (
    <>
      <Nav />
      <div className="min-h-screen bg-[#F9FAFB]">
        <div className="bg-white border-b border-[#E5E7EB] sticky top-14 z-30">
          <div className="max-w-6xl mx-auto px-6 py-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-[#111]">Clients</h1>
                <p className="text-sm text-[#9CA3AF] mt-0.5">
                  {filteredClients.length} of {clients.length} clients
                </p>
              </div>
              <button
                onClick={() => setShowNewClientModal(true)}
                className="flex items-center gap-2 px-5 py-2.5 bg-[#2563EB] text-white rounded-xl text-sm font-medium hover:bg-[#1D4ED8] transition-colors"
              >
                <Plus className="w-4 h-4" /> New Client
              </button>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, or phone…"
                  className="w-full pl-10 pr-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl placeholder:text-[#9CA3AF] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as 'all' | 'B2B' | 'D2C')}
                className="px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              >
                <option value="all">All Types</option>
                <option value="B2B">B2B</option>
                <option value="D2C">D2C</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'type' | 'date')}
                className="px-4 py-2.5 text-sm text-[#111] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              >
                <option value="name">Sort: A–Z</option>
                <option value="type">Sort: Type</option>
                <option value="date">Sort: Newest</option>
              </select>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-6 py-6">
          {loading ? (
            <div className="text-sm text-[#9CA3AF]">Loading clients…</div>
          ) : filteredClients.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm text-[#9CA3AF]">
                {searchQuery || typeFilter !== 'all'
                  ? 'No clients match your filters'
                  : 'No clients yet. Click "+ New Client" to create your first.'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
              <div className="grid grid-cols-[1fr_100px_160px_160px_80px_80px] gap-4 px-5 py-3 border-b border-[#F3F4F6] bg-[#F9FAFB]">
                <span className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
                  Client
                </span>
                <span className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
                  Type
                </span>
                <span className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
                  Email
                </span>
                <span className="text-xs font-medium text-[#6B7280] uppercase tracking-wide">
                  Phone
                </span>
                <span className="text-xs font-medium text-[#6B7280] uppercase tracking-wide text-center">
                  Projects
                </span>
                <span className="text-xs font-medium text-[#6B7280] uppercase tracking-wide text-center">
                  Contacts
                </span>
              </div>
              {filteredClients.map((client, idx) => (
                <div
                  key={client.id}
                  onClick={() => openClientPane(client.id)}
                  className={`grid grid-cols-[1fr_100px_160px_160px_80px_80px] gap-4 px-5 py-3.5 cursor-pointer transition-colors hover:bg-[#F9FAFB] ${
                    selectedClientId === client.id
                      ? 'bg-[#EFF6FF] border-l-2 border-l-[#2563EB]'
                      : ''
                  } ${idx < filteredClients.length - 1 ? 'border-b border-[#F3F4F6]' : ''}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`p-1.5 rounded-lg flex-shrink-0 ${
                        client.type === 'B2B'
                          ? 'bg-[#EFF6FF] text-[#2563EB]'
                          : 'bg-[#ECFDF5] text-[#059669]'
                      }`}
                    >
                      {client.type === 'B2B' ? (
                        <Building2 className="w-4 h-4" />
                      ) : (
                        <User className="w-4 h-4" />
                      )}
                    </div>
                    <span className="text-sm font-medium text-[#111] truncate">
                      {client.name}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        client.type === 'B2B'
                          ? 'bg-[#EFF6FF] text-[#2563EB]'
                          : 'bg-[#ECFDF5] text-[#059669]'
                      }`}
                    >
                      {client.type ?? 'D2C'}
                    </span>
                  </div>
                  <div className="flex items-center min-w-0">
                    <span className="text-sm text-[#6B7280] truncate">
                      {client.email || '—'}
                    </span>
                  </div>
                  <div className="flex items-center">
                    <span className="text-sm text-[#6B7280]">{client.phone || '—'}</span>
                  </div>
                  <div className="flex items-center justify-center">
                    <span className="text-sm font-mono tabular-nums text-[#111]">
                      {client.project_count}
                    </span>
                  </div>
                  <div className="flex items-center justify-center">
                    <span className="text-sm font-mono tabular-nums text-[#111]">
                      {client.contact_count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedClient && !paneLoading && org?.id && (
        <ClientSidePane
          client={selectedClient}
          contacts={paneContacts}
          projects={paneProjects}
          orgId={org.id}
          onClose={closePane}
          onUpdateClient={handleUpdateClient}
          onDeleteClient={handleDeleteClient}
          onContactAdded={async () => {
            const fresh = await getContacts(selectedClient.id)
            setPaneContacts(fresh)
            setClients((prev) =>
              prev.map((c) =>
                c.id === selectedClient.id
                  ? { ...c, contact_count: fresh.length }
                  : c,
              ),
            )
          }}
          onNavigateProject={(id) => router.push(`/projects/${id}`)}
        />
      )}

      {showNewClientModal && org?.id && (
        <NewClientModal
          orgId={org.id}
          onClose={() => setShowNewClientModal(false)}
          onSave={async () => {
            await loadClientsList()
            setShowNewClientModal(false)
          }}
        />
      )}
    </>
  )
}
