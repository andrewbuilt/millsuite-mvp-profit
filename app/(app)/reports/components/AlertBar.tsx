'use client'

import type { AlertLevel } from '@/lib/reports/outlookCalculations'

const ALERT_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  danger:  { bg: '#FCEBEB', border: '#F09595', text: '#A32D2D' },
  warning: { bg: '#FAEEDA', border: '#EF9F27', text: '#854F0B' },
  good:    { bg: '#EAF3DE', border: '#97C459', text: '#3B6D11' },
}

export default function AlertBar({
  level,
  message,
}: {
  level: AlertLevel
  message: string
}) {
  if (!level || !message) return null
  const s = ALERT_STYLES[level]

  return (
    <div
      className="rounded-xl px-4 py-3 text-sm flex items-center gap-2"
      style={{ background: s.bg, border: `0.5px solid ${s.border}`, color: s.text }}
    >
      {message}
    </div>
  )
}
