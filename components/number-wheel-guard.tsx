'use client'

// ============================================================================
// NumberWheelGuard — no scroll-to-increment on number fields, app-wide
// ============================================================================
// October batch item 5 (Matt's report): a mouse wheel over a FOCUSED
// <input type="number"> changes its value — on a price or draw-percent field
// that silently changes money while you think you're scrolling the page.
//
// One document-level listener instead of 80 per-field handlers: when a wheel
// event lands on the focused number input, blur it. The browser only steps
// the value of a focused field, so the step never happens — and because the
// listener is passive and doesn't preventDefault, the PAGE still scrolls.
// Keyboard arrows are untouched (they don't fire wheel events).
//
// Mounted once in app/layout.tsx. New number inputs are covered automatically.
// ============================================================================

import { useEffect } from 'react'

export default function NumberWheelGuard() {
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const t = e.target
      if (
        t instanceof HTMLInputElement &&
        t.type === 'number' &&
        document.activeElement === t
      ) {
        t.blur()
      }
    }
    // Capture: runs before any field-level handler could stop propagation.
    document.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => document.removeEventListener('wheel', onWheel, { capture: true })
  }, [])
  return null
}
