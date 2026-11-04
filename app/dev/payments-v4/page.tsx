'use client'

// ============================================================================
// /dev/payments-v4 — fixture harness for the Payments v4 board (2026-11-05)
// ============================================================================
// Mounts the REAL components/payments/PaymentsBoard on the data the v4
// conversion leaves behind (scripts/payments-v4-convert.mjs listing, prod,
// 2026-11-04) — Leonard, Oliveira, Chancey, Kinser — with an in-memory api:
// log / edit / delete payments, drag forecast cards, edit + Redivide all work,
// nothing touches the database. Dates are pinned to the real ones, and
// "today" is November 2026, so the months read as they will live.
// Dev-only: production builds 404 it.
// ============================================================================

import { useCallback, useState } from 'react'
import { notFound } from 'next/navigation'
import PaymentsBoard, { type PaymentsBoardApi, type PaymentsBoardData } from '@/components/payments/PaymentsBoard'
import type { PaymentRow } from '@/lib/payment-schedule'
import type { LedgerEntry } from '@/lib/payment-forecast'

const TODAY = { year: 2026, month: 10 }

let n = 0
const row = (projectId: string, projectName: string, label: string, amount: number, expectedDate: string | null, sortOrder: number): PaymentRow => ({
  id: `r${++n}`,
  projectId,
  projectName,
  clientName: null,
  stage: 'production',
  label,
  amount,
  status: 'projected',
  expectedDate,
  receivedDate: null,
  sortOrder,
  createdAt: '2026-09-15',
})
const pay = (projectId: string, amount: number, paymentDate: string, label: string | null): LedgerEntry => ({
  id: `p${++n}`,
  projectId,
  amount,
  paymentDate,
  label,
  method: 'ach',
  reference: null,
  notes: null,
})

function fixture(): PaymentsBoardData {
  const L = 'leonard'
  const O = 'oliveira'
  const C = 'chancey'
  const K = 'kinser'
  return {
    rows: [
      row(L, 'Leonard - JW Marriott - Lobby Bar Phase 1', 'App 4 - Draw', 31061.37, '2026-11-15', 3),
      row(L, 'Leonard - JW Marriott - Lobby Bar Phase 1', 'App 7 - Retainage', 18549.32, '2026-12-01', 6),
      row(O, 'Oliveira Residence', 'Production kickoff', 15319, '2026-11-01', 1),
      row(O, 'Oliveira Residence', 'Final', 15210, '2026-12-01', 2),
      row(C, 'Chancey - Stone dining table', 'Production kickoff', 2667, '2026-11-01', 1),
      row(C, 'Chancey - Stone dining table', 'Final', 2667, null, 2),
    ],
    ledger: [
      pay(L, 23296, '2026-08-21', 'App 2 - Draw'),
      pay(L, 32247, '2026-09-11', 'App 3 - Draw'),
      pay(L, 15531, '2026-11-02', 'App 6 - Draw'),
      pay(L, 18217, '2026-11-04', 'App 5 - Draw'),
      pay(L, 33662, '2026-06-30', 'Deposit'),
      pay(O, 17000, '2026-09-23', 'Deposit'),
      pay(C, 4833.5, '2026-10-14', 'Deposit'),
      pay(K, 40000, '2026-09-17', null),
    ],
    contractTotals: {},
    soldProjects: [
      { id: L, name: 'Leonard - JW Marriott - Lobby Bar Phase 1', clientName: null, contractTotal: 172563 },
      { id: O, name: 'Oliveira Residence', clientName: null, contractTotal: 47529 },
      { id: C, name: 'Chancey - Stone dining table', clientName: null, contractTotal: 10667 },
      { id: K, name: 'Kinser', clientName: null, contractTotal: 188892 },
    ],
  }
}

export default function PaymentsV4Fixture() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [data, setData] = useState<PaymentsBoardData>(fixture)
  const [log, setLog] = useState<string[]>([])
  const note = (s: string) => setLog((l) => [s, ...l].slice(0, 12))

  const api: PaymentsBoardApi = {
    reschedule: async (id, expectedDate) => {
      setData((d) => ({ ...d, rows: d.rows.map((r) => (r.id === id ? { ...r, expectedDate } : r)) }))
      note(`forecast ${id} → ${expectedDate}`)
    },
    logPayment: async (input) => {
      setData((d) => ({ ...d, ledger: [...d.ledger, { id: `p${++n}`, ...input }] }))
      note(`ledger + ${input.amount} (${input.label ?? 'no label'}) — forecast untouched`)
    },
    updatePayment: async (id, input) => {
      setData((d) => ({ ...d, ledger: d.ledger.map((e) => (e.id === id ? { ...e, ...input } : e)) }))
      note(`ledger ${id} edited`)
    },
    deletePayment: async (id) => {
      setData((d) => ({ ...d, ledger: d.ledger.filter((e) => e.id !== id) }))
      note(`ledger ${id} deleted`)
    },
    saveForecast: async (projectId, rows, via) => {
      setData((d) => {
        const name = d.soldProjects.find((p) => p.id === projectId)?.name || projectId
        const prior = new Map(d.rows.filter((r) => r.projectId === projectId).map((r) => [r.id, r]))
        const next = rows.map((r, i) => {
          const was = r.id ? prior.get(r.id) : null
          return was
            ? { ...was, label: r.label, amount: r.amount, sortOrder: i }
            : row(projectId, name, r.label, r.amount, null, i)
        })
        return { ...d, rows: [...d.rows.filter((r) => r.projectId !== projectId), ...next] }
      })
      note(`forecast saved via ${via}: ${rows.map((r) => `${r.label} ${r.amount}`).join(', ')}`)
    },
  }

  const onChanged = useCallback(async () => {}, [])

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="mb-3 text-[11px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-md px-3 py-1.5">
          /dev fixture — in-memory, today = November 2026. Data = what the v4 conversion leaves on prod.
        </div>
        <PaymentsBoard data={data} api={api} today={TODAY} onChanged={onChanged} />
        <pre data-api-log className="mt-6 text-[10.5px] text-[#6B7280] whitespace-pre-wrap">{log.join('\n')}</pre>
      </div>
    </div>
  )
}
