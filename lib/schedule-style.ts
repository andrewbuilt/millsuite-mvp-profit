// ============================================================================
// lib/schedule-style.ts — the /schedule swimlane's visual tokens, shared
// ============================================================================
// Extracted 2026-11-04 so /engineering reads as the same product as the
// /schedule swimlane (Andrew: aesthetics come from the swimlane, not the
// mockup). Change a token here and both boards move together.
// ============================================================================

export const COLOR_PALETTE = [
  { bg: '#2563EB', light: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
  { bg: '#7C3AED', light: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
  { bg: '#059669', light: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
  { bg: '#DC2626', light: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
  { bg: '#D97706', light: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
  { bg: '#0891B2', light: '#CFFAFE', text: '#155E75', border: '#67E8F9' },
  { bg: '#4F46E5', light: '#E0E7FF', text: '#3730A3', border: '#A5B4FC' },
  { bg: '#BE185D', light: '#FCE7F3', text: '#831843', border: '#F9A8D4' },
  { bg: '#EA580C', light: '#FFF7ED', text: '#9A3412', border: '#FDBA74' },
  { bg: '#16A34A', light: '#DCFCE7', text: '#14532D', border: '#86EFAC' },
]

export type PaletteColor = (typeof COLOR_PALETTE)[number]

export const MONO = "'SF Mono', monospace"
export const UI_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif"

// Capacity-utilization color thresholds — single source of truth used by
// the header dots, the sticky CapacityRow, and the engineering day headers.
// Returns null when zero so callers can hide the indicator entirely.
export function capColor(pct: number): string | null {
  if (pct <= 0) return null
  if (pct > 100) return '#EF4444'
  if (pct > 85) return '#F59E0B'
  if (pct > 50) return '#3B82F6'
  return '#D1D5DB'
}

export function btnS(bg: string, color: string): React.CSSProperties {
  return { fontSize: 12, fontWeight: 500, padding: '5px 12px', borderRadius: 8, border: '1px solid #E5E7EB', background: bg, color, cursor: 'pointer', transition: 'all 0.15s' }
}
