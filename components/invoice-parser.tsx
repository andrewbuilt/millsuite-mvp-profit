'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { createExpense, listProjectExpenses, findLikelyDuplicates, type ProjectExpense } from '@/lib/project-expenses'
import { Upload, FileText, Loader2, Check, X, AlertCircle } from 'lucide-react'

// ============================================================================
// The vendor-invoice dropzone. Reads a bill (/api/parse-invoice), asks WHICH
// PROJECT, and saves it to the project's material-spend ledger (`invoices`,
// migration 124) through lib/project-expenses — the same ledger the project
// P&L panel's Material line sums. Two mounts:
//   · /pm Quick upload — no project yet, so it asks
//   · the project page's Material modal — `projectId` given, the picker hides
// A likely duplicate (same vendor + amount, dates within a week) WARNS before
// saving; it never blocks.
// ============================================================================

// ── Types ──

interface LineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

interface ParsedInvoice {
  vendor_name: string
  invoice_number: string
  invoice_date: string
  line_items: LineItem[]
  total_amount: number
}

interface Project {
  id: string
  name: string
}

interface Subproject {
  id: string
  name: string
  project_id: string
}

// ── Helpers ──

function fmtMoney(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ── Component ──

export default function InvoiceParser({
  projectId: fixedProjectId,
  onSaved,
}: {
  /** Mounted inside one project's Material modal — no project picker. */
  projectId?: string
  onSaved?: () => void
} = {}) {
  const { user, org } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedInvoice | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const [projects, setProjects] = useState<Project[]>([])
  const [subprojects, setSubprojects] = useState<Subproject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedSubprojectId, setSelectedSubprojectId] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  /** Likely duplicates found on the first Save press; a second press saves. */
  const [dupes, setDupes] = useState<ProjectExpense[] | null>(null)

  useEffect(() => {
    if (fixedProjectId) setSelectedProjectId(fixedProjectId)
  }, [fixedProjectId])

  // Load projects on mount
  useEffect(() => {
    if (!org?.id) return
    supabase
      .from('projects')
      .select('id, name')
      .eq('org_id', org.id)
      .in('stage', ['new_lead', 'fifty_fifty', 'ninety_percent', 'sold', 'production', 'installed'])
      .order('name')
      .then(({ data }) => setProjects(data || []))
  }, [org?.id])

  // Load subprojects when project changes
  useEffect(() => {
    if (!selectedProjectId) {
      setSubprojects([])
      setSelectedSubprojectId('')
      return
    }
    supabase
      .from('subprojects')
      .select('id, name, project_id')
      .eq('project_id', selectedProjectId)
      .order('sort_order')
      .then(({ data }) => setSubprojects(data || []))
  }, [selectedProjectId])

  // ── File Handling ──

  const handleFile = useCallback(async (file: File) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png']
    if (!allowed.includes(file.type)) {
      setError('Please upload a PDF, JPG, or PNG file.')
      return
    }

    setError(null)
    setParsed(null)
    setSaved(false)
    setFileName(file.name)

    // Convert to base64 and send to parse-invoice API
    setParsing(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1]
      try {
        // The route now gates on the caller's session (H1) — ship the access token.
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData.session?.access_token
        const res = await fetch('/api/parse-invoice', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({
            base64_content: base64,
            mime_type: file.type,
          }),
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData.error || 'Failed to parse invoice')
        }

        const data: ParsedInvoice = await res.json()
        setParsed(data)
      } catch (err: any) {
        setError(err.message || 'Failed to parse invoice')
      } finally {
        setParsing(false)
      }
    }
    reader.readAsDataURL(file)
  }, [org?.id])

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function onFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  // ── Save to DB ──

  async function saveInvoice() {
    if (!parsed || !selectedProjectId || !org?.id) return
    setSaving(true)
    setError(null)

    try {
      const toNum = (v: any) => parseFloat(String(v).replace(/,/g, '')) || 0
      const amount = toNum(parsed.total_amount)

      // Duplicate check on the FIRST press only — the warning names what it
      // matched; pressing Save again means "yes, it's a different bill".
      if (dupes === null) {
        const existing = await listProjectExpenses(selectedProjectId)
        const hits = findLikelyDuplicates(existing, {
          vendor_name: parsed.vendor_name || '',
          amount,
          invoice_date: parsed.invoice_date || null,
        })
        if (hits.length > 0) {
          setDupes(hits)
          return
        }
      }

      await createExpense({
        orgId: org.id,
        projectId: selectedProjectId,
        subprojectId: selectedSubprojectId || null,
        vendorName: parsed.vendor_name || 'Unknown vendor',
        invoiceNumber: parsed.invoice_number || null,
        invoiceDate: parsed.invoice_date || null,
        amount,
        source: 'parsed',
        userId: user?.id ?? null,
        lineItems: (parsed.line_items || []).map((li) => ({
          description: li.description,
          quantity: toNum(li.quantity),
          unit_price: toNum(li.unit_price),
          total: toNum(li.total),
        })),
      })

      setSaved(true)
      setDupes(null)
      onSaved?.()
    } catch (err: any) {
      setError(`Save failed: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Reset ──

  function reset() {
    setParsed(null)
    setFileName(null)
    setError(null)
    setSaved(false)
    setDupes(null)
    setSelectedProjectId(fixedProjectId || '')
    setSelectedSubprojectId('')
  }

  // ── Render ──

  const isProcessing = parsing

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      {!parsed && !isProcessing && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-[#2563EB] bg-[#EFF6FF]'
              : 'border-[#D1D5DB] hover:border-[#9CA3AF] hover:bg-[#F9FAFB]'
          }`}
        >
          <Upload className="w-8 h-8 text-[#9CA3AF] mx-auto mb-2" />
          <p className="text-sm font-medium text-[#6B7280]">
            Drop a vendor invoice or click to upload
          </p>
          <p className="text-xs text-[#9CA3AF] mt-1">PDF, JPG, or PNG</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      )}

      {/* Processing State */}
      {isProcessing && (
        <div className="border border-[#E5E7EB] rounded-xl p-8 text-center">
          <Loader2 className="w-8 h-8 text-[#2563EB] mx-auto mb-2 animate-spin" />
          <p className="text-sm font-medium text-[#6B7280]">
            Extracting invoice data with AI...
          </p>
          {fileName && <p className="text-xs text-[#9CA3AF] mt-1">{fileName}</p>}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-xl">
          <AlertCircle className="w-4 h-4 text-[#DC2626] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-[#DC2626]">{error}</p>
        </div>
      )}

      {/* Parsed Results */}
      {parsed && !saved && (
        <div className="space-y-4">
          {/* Header Info */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Vendor</label>
              <div className="text-sm font-medium mt-0.5">{parsed.vendor_name || '—'}</div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Invoice #</label>
              <div className="text-sm font-mono mt-0.5">{parsed.invoice_number || '—'}</div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Date</label>
              <div className="text-sm font-mono mt-0.5">{parsed.invoice_date || '—'}</div>
            </div>
          </div>

          {/* Line Items Table */}
          {parsed.line_items?.length > 0 && (
            <div className="overflow-hidden border border-[#E5E7EB] rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                    <th className="text-left px-4 py-2 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Description</th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Qty</th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Unit Price</th>
                    <th className="text-right px-4 py-2 text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {parsed.line_items.map((li, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2 text-[#111]">{li.description}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-[#6B7280]">{li.quantity}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-[#6B7280]">{fmtMoney(li.unit_price)}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums font-medium">{fmtMoney(li.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[#E5E7EB] bg-[#F9FAFB]">
                    <td colSpan={3} className="px-4 py-2 text-right text-xs font-semibold text-[#6B7280] uppercase">Grand Total</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-[#111]">{fmtMoney(parsed.total_amount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Assign to Project — hidden when mounted inside one project. */}
          <div className="grid grid-cols-2 gap-3">
            {!fixedProjectId && (
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Assign to Project *</label>
              <select
                value={selectedProjectId}
                onChange={e => { setSelectedProjectId(e.target.value); setDupes(null) }}
                className="mt-1 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB]"
              >
                <option value="">Select project...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            )}
            <div>
              <label className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-wider">Subproject (optional)</label>
              <select
                value={selectedSubprojectId}
                onChange={e => setSelectedSubprojectId(e.target.value)}
                disabled={!selectedProjectId || subprojects.length === 0}
                className="mt-1 w-full text-sm bg-white border border-[#E5E7EB] rounded-lg px-3 py-2 outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] disabled:opacity-50 disabled:bg-[#F9FAFB]"
              >
                <option value="">None</option>
                {subprojects.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {dupes && dupes.length > 0 && (
            <div className="flex items-start gap-2 p-3 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl text-[12.5px] text-[#92400E]">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                This looks like a bill already on this project:{' '}
                {dupes
                  .slice(0, 2)
                  .map((d) => `${d.vendor_name} ${fmtMoney(d.amount)}${d.invoice_date ? ` (${d.invoice_date})` : ''}`)
                  .join(' · ')}
                . Save again if it’s a different bill.
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={saveInvoice}
              disabled={!selectedProjectId || saving}
              className="px-5 py-2.5 bg-[#2563EB] text-white text-sm font-medium rounded-xl hover:bg-[#1D4ED8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : dupes && dupes.length > 0 ? 'Save anyway' : 'Save Invoice'}
            </button>
            <button
              onClick={reset}
              className="px-4 py-2.5 text-sm text-[#6B7280] hover:text-[#111] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Success */}
      {saved && (
        <div className="border border-[#BBF7D0] bg-[#F0FDF4] rounded-xl p-6 text-center">
          <Check className="w-8 h-8 text-[#059669] mx-auto mb-2" />
          <p className="text-sm font-medium text-[#059669]">Invoice saved successfully</p>
          <p className="text-xs text-[#6B7280] mt-1">
            {parsed?.vendor_name} — {fmtMoney(parsed?.total_amount || 0)}
          </p>
          <button
            onClick={reset}
            className="mt-3 text-sm text-[#2563EB] hover:underline"
          >
            Upload another
          </button>
        </div>
      )}
    </div>
  )
}
