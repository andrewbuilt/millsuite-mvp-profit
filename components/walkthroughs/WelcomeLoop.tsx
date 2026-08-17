'use client'

// ============================================================================
// WelcomeLoop — the animated welcome moment (guide system v2, spec §5)
// ============================================================================
// Shown once, right after the setup wizard, in place of the old welcome-tour
// offer modal: the five beats of the learning loop appear one by one, glide
// into a ring, and the final frame IS the offer ("Show me around"). The loop
// is the product's core idea, and this is the one place it gets taught —
// the welcome tour no longer carries a text-card version of it.
//
// Also rerunnable from Manage → Guides ("How MillSuite works").
//
// Skippable at any instant (Skip, Esc, or either button). Reduced motion goes
// straight to the assembled ring. Mockup this was built from:
// mockups/welcome-loop.html.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { BarChart3, BookOpen, Clock, FileText, RefreshCw } from 'lucide-react'

const BEATS = [
  { icon: BookOpen, title: 'Build your rates', line: 'Your shop rate and your labor numbers. Set once.' },
  { icon: FileText, title: 'Estimate the job', line: 'Every line prices straight off your rate book.' },
  { icon: Clock, title: 'Track it live', line: 'Time and materials land on the job as it’s built. The P&L is real while it’s happening.' },
  { icon: BarChart3, title: 'Review and tighten', line: 'Estimated against actual. Fix the numbers that were off.' },
  { icon: RefreshCw, title: 'Price the next one smarter', line: 'Your rates evolve. The loop runs again.' },
]

// ── Stage geometry (fixed coordinates; the stage scales as one unit) ────────
const W = 920
const H = 600
const CX = W / 2
const CY = H / 2 + 30
const R = 195
const ROW_W = 168
const RING_W = 128
const ROW_GAP = 16
const ICON_DY = 29 // icon center below a beat's top edge

const rowPos = (i: number) => ({
  left: (W - (5 * ROW_W + 4 * ROW_GAP)) / 2 + i * (ROW_W + ROW_GAP),
  top: 150,
})
const ringAngle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / 5
const ringPos = (i: number) => ({
  left: CX + R * Math.cos(ringAngle(i)) - RING_W / 2,
  top: CY + R * Math.sin(ringAngle(i)) - 44,
})
const iconCenter = (i: number) => ({
  x: CX + R * Math.cos(ringAngle(i)),
  y: CY + R * Math.sin(ringAngle(i)) - 44 + ICON_DY,
})

/** Connector arcs between adjacent ring icons, bowed slightly outward and
 *  trimmed so they don't run under the icons. Pure geometry — computed once. */
const ARCS = BEATS.map((_, i) => {
  const a = iconCenter(i)
  const b = iconCenter((i + 1) % 5)
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const cx2 = CX + (mx - CX) * 1.16
  const cy2 = CY + (my - CY) * 1.16
  const trim = (p: { x: number; y: number }, t: number) => ({
    x: p.x + (cx2 - p.x) * t,
    y: p.y + (cy2 - p.y) * t,
  })
  const s = trim(a, 0.22)
  const e = trim(b, 0.22)
  return `M ${s.x} ${s.y} Q ${cx2} ${cy2} ${e.x} ${e.y}`
})

type Phase = 'intro' | 'ring' | 'final'

export default function WelcomeLoop({
  onStart,
  onDismiss,
  replay = false,
}: {
  /** "Show me around" — starts the welcome tour. */
  onStart: () => void
  /** "I'll explore on my own" / Skip / Esc. */
  onDismiss: () => void
  /** Rerun from Guides: same moment, calmer buttons. */
  replay?: boolean
}) {
  const [phase, setPhase] = useState<Phase>('intro')
  const [shown, setShown] = useState(0) // beats visible so far
  const [scale, setScale] = useState(1)
  const [lit, setLit] = useState(-1) // beat the pulse is passing
  const pulseRef = useRef<HTMLDivElement>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const finale = phase === 'ring' || phase === 'final'

  // Fit the fixed-coordinate stage to the viewport as one unit.
  useEffect(() => {
    const fit = () =>
      setScale(Math.min(1, (window.innerWidth - 24) / W, (window.innerHeight - 24) / H))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  // ── Timeline ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const later = (fn: () => void, ms: number) => timersRef.current.push(setTimeout(fn, ms))
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(5)
      setPhase('ring')
      later(() => setPhase('final'), 250)
      return () => timersRef.current.forEach(clearTimeout)
    }
    for (let i = 1; i <= 5; i++) later(() => setShown(i), 900 + (i - 1) * 1000)
    later(() => setPhase('ring'), 900 + 5 * 1000 + 400)
    later(() => setPhase('final'), 900 + 5 * 1000 + 400 + 1300)
    return () => timersRef.current.forEach(clearTimeout)
  }, [])

  const skipAhead = () => {
    timersRef.current.forEach(clearTimeout)
    setShown(5)
    setPhase('final')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onDismiss])

  // ── The circulating pulse (final phase only) ─────────────────────────────
  // Position written straight to the node every frame; React state only for
  // the "lit" beat, which changes five times a lap.
  useEffect(() => {
    if (phase !== 'final') return
    let raf = 0
    const start = performance.now()
    const LAP = 6000
    const frame = (now: number) => {
      const t = ((now - start) % LAP) / LAP
      const a = -Math.PI / 2 + t * 2 * Math.PI
      const el = pulseRef.current
      if (el) {
        el.style.left = `${CX + R * 1.02 * Math.cos(a) - 5}px`
        el.style.top = `${CY + R * 1.02 * Math.sin(a) - 15 - 5}px`
      }
      setLit(Math.round(t * 5) % 5)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  return (
    <div className="fixed inset-0 z-[9997] bg-white/[0.97] flex items-center justify-center">
      <div className="relative" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        {/* Skip — gone once the buttons are up, so there's one way out at a time */}
        {phase !== 'final' && (
          <button
            onClick={skipAhead}
            className="absolute top-2 right-3 z-10 px-2.5 py-1.5 text-[13px] text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] rounded-lg transition-colors"
          >
            Skip →
          </button>
        )}

        {/* Heading */}
        <div className="absolute top-6 left-0 right-0 text-center">
          <h1 className="text-[30px] font-bold text-[#111] tracking-tight">
            {replay ? 'How MillSuite works' : 'Welcome to MillSuite'}
          </h1>
          <p
            className="text-[15px] text-[#6B7280] mt-1.5 transition-opacity duration-500"
            style={{ opacity: finale ? 0 : 1 }}
          >
            Here&rsquo;s how it works.
          </p>
        </div>

        {/* Connectors */}
        <svg className="absolute inset-0 pointer-events-none overflow-visible" viewBox={`0 0 ${W} ${H}`}>
          {ARCS.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#C7D7FE"
              strokeWidth={2}
              style={{
                strokeDasharray: finale ? '1000 0' : '0 1000',
                transition: 'stroke-dasharray 1.4s ease',
              }}
            />
          ))}
        </svg>
        {phase === 'final' && (
          <div ref={pulseRef} className="absolute w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
        )}

        {/* Center tagline */}
        <div
          className="absolute text-center transition-all duration-700"
          style={{
            width: 300,
            left: CX - 150,
            top: CY - 58,
            opacity: finale ? 1 : 0,
            transform: finale ? 'none' : 'scale(0.94)',
          }}
        >
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#2563EB] mb-2">
            The loop
          </div>
          <h2 className="text-[21px] font-bold text-[#111] leading-snug">
            Every job makes the next quote smarter.
          </h2>
        </div>

        {/* Beats */}
        {BEATS.map((b, i) => {
          const pos = finale ? ringPos(i) : rowPos(i)
          const visible = shown > i
          const isLit = phase === 'final' && lit === i
          const Icon = b.icon
          return (
            <div
              key={b.title}
              className="absolute text-center"
              style={{
                width: finale ? RING_W : ROW_W,
                left: pos.left,
                top: pos.top,
                opacity: visible ? 1 : 0,
                transform: visible ? 'none' : 'translateY(14px) scale(0.96)',
                transition:
                  'opacity .55s ease, transform .9s cubic-bezier(.22,.9,.3,1), top .9s cubic-bezier(.22,.9,.3,1), left .9s cubic-bezier(.22,.9,.3,1), width .9s cubic-bezier(.22,.9,.3,1)',
              }}
            >
              <div
                className="w-[58px] h-[58px] mx-auto mb-2.5 rounded-2xl flex items-center justify-center transition-colors duration-300"
                style={{
                  background: isLit ? '#2563EB' : '#EFF6FF',
                  border: `1.5px solid ${isLit ? '#2563EB' : '#BFDBFE'}`,
                  boxShadow: isLit ? '0 0 0 6px rgba(37,99,235,0.22)' : 'none',
                }}
              >
                <Icon className="w-[26px] h-[26px]" style={{ color: isLit ? '#fff' : '#2563EB' }} />
              </div>
              <h3 className="text-[14px] font-semibold text-[#111] leading-tight">{b.title}</h3>
              <p
                className="text-[12px] text-[#6B7280] leading-relaxed mt-1 overflow-hidden transition-all duration-500"
                style={{ opacity: finale ? 0 : 1, maxHeight: finale ? 0 : 80, marginTop: finale ? 0 : 4 }}
              >
                {b.line}
              </p>
            </div>
          )
        })}

        {/* The offer — the final frame IS the opt-in */}
        <div
          className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-2.5 transition-all duration-700"
          style={{
            opacity: phase === 'final' ? 1 : 0,
            transform: phase === 'final' ? 'none' : 'translateY(8px)',
            pointerEvents: phase === 'final' ? 'auto' : 'none',
          }}
        >
          <button
            onClick={onDismiss}
            className="px-4 py-2.5 text-sm font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] rounded-xl transition-colors"
          >
            {replay ? 'Done' : 'I’ll explore on my own'}
          </button>
          <button
            onClick={onStart}
            className="px-5 py-2.5 text-sm font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8] transition-colors"
          >
            Show me around
          </button>
        </div>
      </div>
    </div>
  )
}
