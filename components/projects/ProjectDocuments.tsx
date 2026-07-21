'use client'

// ============================================================================
// ProjectDocuments — CO step 7. One place to reach every document tied to a
// project: the estimate PDF, the contract invoice(s), the CO invoice(s), and
// any manual "+ document link" (Drive folder, signed contract, shop drawings).
// Auto-derived rows are passed in; manual links live in project_documents
// (lib/project-documents) and are added/removed here.
// ============================================================================

import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, Plus, Trash2, X } from 'lucide-react'
import {
  loadProjectDocuments,
  addProjectDocument,
  deleteProjectDocument,
  type ProjectDocument,
} from '@/lib/project-documents'

interface InvoiceRef {
  id: string
  invoice_number: string
}

export default function ProjectDocuments({
  projectId,
  contractInvoices,
  coInvoices,
  onDownloadEstimate,
}: {
  projectId: string
  contractInvoices: InvoiceRef[]
  coInvoices: InvoiceRef[]
  onDownloadEstimate: () => void | Promise<void>
}) {
  const [docs, setDocs] = useState<ProjectDocument[]>([])
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    loadProjectDocuments(projectId).then(setDocs)
  }, [projectId])

  async function handleAdd() {
    if (!url.trim()) return
    setSaving(true)
    const doc = await addProjectDocument({ project_id: projectId, label: label.trim(), url: url.trim() })
    setSaving(false)
    if (doc) {
      setDocs((d) => [...d, doc])
      setLabel('')
      setUrl('')
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    setDocs((d) => d.filter((x) => x.id !== id))
    try {
      await deleteProjectDocument(id)
    } catch {
      // Re-load on failure to resync.
      loadProjectDocuments(projectId).then(setDocs)
    }
  }

  const rowCls =
    'flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#F3F4F6] last:border-b-0'
  const leftCls = 'flex items-center gap-2 min-w-0'
  const iconCls = 'w-3.5 h-3.5 text-[#9CA3AF] flex-shrink-0'
  const linkCls =
    'text-[11px] px-2 py-1 rounded-md border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F9FAFB] inline-flex items-center gap-1 flex-shrink-0'

  return (
    <div className="mt-6">
      <div className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
        Documents
      </div>
      <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
        {/* Estimate */}
        <div className={rowCls}>
          <div className={leftCls}>
            <FileText className={iconCls} />
            <span className="text-[13px] text-[#111] truncate">Estimate</span>
          </div>
          <button
            onClick={async () => {
              setDownloading(true)
              try {
                await onDownloadEstimate()
              } finally {
                setDownloading(false)
              }
            }}
            disabled={downloading}
            className={`${linkCls} disabled:opacity-50`}
          >
            <Download className="w-3 h-3" /> {downloading ? 'Generating…' : 'Download'}
          </button>
        </div>

        {/* Contract invoice(s) */}
        {contractInvoices.map((inv) => (
          <div key={inv.id} className={rowCls}>
            <div className={leftCls}>
              <FileText className={iconCls} />
              <span className="text-[13px] text-[#111] truncate">
                Contract invoice · {inv.invoice_number}
              </span>
            </div>
            <a href={`/invoices/${inv.id}`} className={linkCls}>
              Open →
            </a>
          </div>
        ))}

        {/* CO invoice(s) */}
        {coInvoices.map((inv) => (
          <div key={inv.id} className={rowCls}>
            <div className={leftCls}>
              <FileText className={iconCls} />
              <span className="text-[13px] text-[#111] truncate">
                Change order invoice · {inv.invoice_number}
              </span>
            </div>
            <a href={`/invoices/${inv.id}`} className={linkCls}>
              Open →
            </a>
          </div>
        ))}

        {/* Manual links */}
        {docs.map((d) => (
          <div key={d.id} className={rowCls}>
            <div className={leftCls}>
              <ExternalLink className={iconCls} />
              <span className="text-[13px] text-[#111] truncate">{d.label}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <a href={d.url} target="_blank" rel="noreferrer" className={linkCls}>
                Open ↗
              </a>
              <button
                onClick={() => handleDelete(d.id)}
                title="Remove link"
                className="p-1 text-[#9CA3AF] hover:text-[#DC2626]"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}

        {/* Add link */}
        <div className="px-4 py-2.5">
          {adding ? (
            <div className="flex items-center gap-2">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label (e.g. Drive folder)"
                className="w-[40%] text-[12px] px-2 py-1.5 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="flex-1 text-[12px] px-2 py-1.5 border border-[#E5E7EB] rounded-lg focus:border-[#2563EB] focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAdd()
                }}
              />
              <button
                onClick={handleAdd}
                disabled={saving || !url.trim()}
                className="text-[12px] px-2.5 py-1.5 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1D4ED8] rounded-lg hover:bg-[#DBEAFE] disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add'}
              </button>
              <button
                onClick={() => {
                  setAdding(false)
                  setLabel('')
                  setUrl('')
                }}
                className="p-1 text-[#9CA3AF] hover:text-[#111]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="text-[12px] text-[#2563EB] hover:underline inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Add document link
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
