'use client'

// ============================================================================
// /dev/pnl-panel — fixture harness for the project P&L panel (2026-10-29)
// ============================================================================
// The panel lives on a sold project page behind a login. This mounts the real
// ProjectPnlPanel on two fixture jobs (Murtagh-shaped on budget, and one over
// on both lines) and the real MaterialModal on fixture bills, so the layout,
// the over states and the modal can be LOOKED at. The modal's writes would hit
// the database, so the fixture's onChanged is a no-op and nobody's logged in.
//
// Dev-only: production builds 404 it.
// ============================================================================

import { useState } from 'react'
import { notFound } from 'next/navigation'
import ProjectPnlPanel from '@/components/project/ProjectPnlPanel'
import MaterialModal from '@/components/project/MaterialModal'
import { ConfirmProvider } from '@/components/confirm-dialog'
import { computeProjectPnl } from '@/lib/project-pnl'
import type { ProjectExpense } from '@/lib/project-expenses'

const bill = (id: string, vendor: string, amount: number, date: string, source: 'parsed' | 'manual', note: string | null = null): ProjectExpense => ({
  id,
  project_id: 'p',
  subproject_id: null,
  vendor_name: vendor,
  invoice_number: source === 'parsed' ? `INV-${id}` : null,
  invoice_date: date,
  amount,
  source,
  note,
  file_url: null,
  entered_by: 'u1',
  edited_by: null,
  edited_at: null,
  created_at: date,
})
const BILLS = [
  bill('1043', 'Rugby Architectural', 1240.5, '2026-10-20', 'parsed'),
  bill('2', 'Hafele', 410, '2026-10-12', 'manual', 'Hinges + slides'),
  bill('988', 'Walnut Hollow Lumber', 800, '2026-10-02', 'parsed'),
]

export default function PnlFixture() {
  const [open, setOpen] = useState(false)
  if (process.env.NODE_ENV === 'production') notFound()
  const onBudget = computeProjectPnl({ contract: 26227, estHours: 180, trackedHours: 69, rate: 77.98, materialAllowance: 6200, materialSpent: 2450.5, received: 13113 })
  const over = computeProjectPnl({ contract: 10667, estHours: 45, trackedHours: 61, rate: 77.98, materialAllowance: 2100, materialSpent: 2840, received: 3200 })
  // Leonard Lobby Bar Ph 1 from Andrew's screenshot (no bills, nothing in yet).
  const empty = computeProjectPnl({ contract: 172563, estHours: 648, trackedHours: 415.5, rate: 77.98, materialAllowance: 105809, materialSpent: 0, received: 0 })
  return (
    <ConfirmProvider>
      <div className="min-h-screen bg-[#F9FAFB] p-6">
        <h1 className="text-xl font-semibold text-[#111] mb-4">P&amp;L panel — fixture</h1>
        <div className="grid grid-cols-3 gap-4 max-w-5xl">
          {[onBudget, over, empty].map((p, i) => (
            <div key={i} className="bg-white border border-[#E5E7EB] rounded-xl p-5 shadow-sm">
              <ProjectPnlPanel pnl={p} spendCount={i === 2 ? 0 : 3} onOpenTime={() => {}} onOpenMaterial={() => setOpen(true)} />
            </div>
          ))}
        </div>
        {open && (
          <MaterialModal
            orgId="org"
            projectId="p"
            allowance={6200}
            expenses={BILLS}
            userNames={{ u1: 'Kaylin' }}
            onChanged={() => {}}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </ConfirmProvider>
  )
}
