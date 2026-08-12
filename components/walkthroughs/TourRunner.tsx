'use client'

// ============================================================================
// TourRunner — the spotlight engine
// ============================================================================
// Renders one step of one tour: a dark mask with a hole cut around the target,
// a popover anchored to it, and Back / Next / progress. It knows how to
// navigate between pages mid-tour and how to wait for a target that doesn't
// exist yet. It knows nothing about what any tour says — that's lib/walkthroughs.
//
// The mask is four fixed divs (above / below / left / right of the hole) rather
// than one overlay with an SVG cutout, because nothing renders over the hole:
// the highlighted button stays genuinely clickable, which the "Price your first
// job" tour depends on completely — the user really does click New project and
// really does build an estimate.
//
// Two failure modes are designed for rather than assumed away:
//   • Target never appears — after WAIT_MS the step still shows, just centered
//     with no spotlight. The copy lands even when the anchor doesn't. Steps
//     flagged skipIfMissing (owner-only Settings) drop out instead.
//   • Target moves — the rect is re-measured every frame and only written to
//     state when it actually changed, so sticky headers, dropdowns opening and
//     lazy content don't leave the hole behind.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import type { Tour, TourContext, TourStep } from '@/lib/walkthroughs'

const WAIT_MS = 6000 // how long to look for a target before going centered
const PAD = 6 // spotlight breathing room around the element
const POPOVER_W = 340
const GAP = 12 // popover ↔ spotlight
const EDGE = 12 // popover ↔ viewport edge

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export type ExitReason = 'dismissed' | 'completed'

interface Props {
  tour: Tour
  startIndex: number
  /** Fired on every step change so progress survives a reload. */
  onStep: (index: number) => void
  onExit: (reason: ExitReason, index: number) => void
  /** The last step of a chaining tour offers to run another one. */
  onChain: () => void
  /** Fired with the id of a project the tour walks into. The provider uses it
   *  to stamp the practice flag — the tour can't know the id up front because
   *  the user is the one who creates the project. */
  onProjectSeen?: (projectId: string) => void
}

const sel = (target: string) => `[data-tour="${CSS.escape(target)}"]`

function findTarget(target: string | undefined): HTMLElement | null {
  if (!target) return null
  const el = document.querySelector(sel(target)) as HTMLElement | null
  if (!el) return null
  // A tagged element that's display:none (a collapsed panel, a modal that
  // hasn't opened) is not a thing we can point at.
  return el.offsetParent !== null || el.getClientRects().length > 0 ? el : null
}

/** Resolve as soon as the element exists, or null at the timeout. Watches the
 *  DOM rather than polling on a timer so a target that appears on the very next
 *  paint doesn't cost an arbitrary interval of dead time. */
function waitForTarget(
  target: string,
  timeoutMs: number,
  signal: { cancelled: boolean },
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const immediate = findTarget(target)
    if (immediate) return resolve(immediate)

    let done = false
    const finish = (el: HTMLElement | null) => {
      if (done) return
      done = true
      observer.disconnect()
      clearInterval(tick)
      clearTimeout(timer)
      resolve(el)
    }
    const check = () => {
      if (signal.cancelled) return finish(null)
      const el = findTarget(target)
      if (el) finish(el)
    }
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    // Belt and braces: an element can become visible through a CSS transition
    // or a parent's layout without any mutation the observer would see.
    const tick = setInterval(check, 120)
    const timer = setTimeout(() => finish(null), timeoutMs)
  })
}

function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return {
    top: Math.max(0, r.top - PAD),
    left: Math.max(0, r.left - PAD),
    width: Math.min(window.innerWidth, r.width + PAD * 2),
    height: Math.min(window.innerHeight, r.height + PAD * 2),
  }
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5)

/** Where the popover sits relative to the hole, clamped into the viewport. The
 *  requested placement is a preference — if it doesn't fit, the opposite side
 *  wins over hanging off screen. */
function placePopover(
  rect: Rect | null,
  placement: TourStep['placement'],
  height: number,
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (!rect) {
    return { top: Math.max(EDGE, vh / 2 - height / 2), left: Math.max(EDGE, vw / 2 - POPOVER_W / 2) }
  }
  const below = rect.top + rect.height + GAP
  const above = rect.top - GAP - height
  const rightOf = rect.left + rect.width + GAP
  const leftOf = rect.left - GAP - POPOVER_W

  let top: number
  let left: number
  switch (placement) {
    case 'top':
      top = above >= EDGE ? above : below
      left = rect.left + rect.width / 2 - POPOVER_W / 2
      break
    case 'left':
      left = leftOf >= EDGE ? leftOf : rightOf
      top = rect.top + rect.height / 2 - height / 2
      break
    case 'right':
      left = rightOf + POPOVER_W <= vw - EDGE ? rightOf : leftOf
      top = rect.top + rect.height / 2 - height / 2
      break
    case 'bottom':
    default:
      top = below + height <= vh - EDGE ? below : above
      left = rect.left + rect.width / 2 - POPOVER_W / 2
      break
  }
  return {
    top: Math.min(Math.max(EDGE, top), Math.max(EDGE, vh - height - EDGE)),
    left: Math.min(Math.max(EDGE, left), Math.max(EDGE, vw - POPOVER_W - EDGE)),
  }
}

export default function TourRunner({
  tour,
  startIndex,
  onStep,
  onExit,
  onChain,
  onProjectSeen,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const [index, setIndex] = useState(startIndex)
  const [rect, setRect] = useState<Rect | null>(null)
  const [ready, setReady] = useState(false)
  const [popHeight, setPopHeight] = useState(180)
  const popRef = useRef<HTMLDivElement>(null)
  const targetElRef = useRef<HTMLElement | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })

  // Which way the user is travelling. A skipped step has to skip the way they
  // were going, or Back onto an owner-only step bounces them straight forward
  // again and reads as a dead button.
  const dirRef = useRef<1 | -1>(1)

  // What the tour has learned. A ref, not state: it's read inside async
  // resolution and must never trigger a re-render of its own.
  const ctxRef = useRef<TourContext>({ projectPath: null })

  const step = tour.steps[index]
  const total = tour.steps.length
  const isLast = index === total - 1

  // Remember the project the user builds during the tour, so the step that
  // sends them back to the estimate knows where "back" is.
  useEffect(() => {
    const m = /^\/projects\/([^/]+)/.exec(pathname || '')
    if (!m) return
    ctxRef.current.projectPath = `/projects/${m[1]}`
    onProjectSeen?.(m[1])
  }, [pathname, onProjectSeen])

  const exit = useCallback(
    (reason: ExitReason) => onExit(reason, index),
    [onExit, index],
  )

  // ── Resolve the current step: navigate, then find the target ──────────────
  useEffect(() => {
    const signal = { cancelled: false }
    setReady(false)
    setRect(null)
    targetElRef.current = null

    ;(async () => {
      const want = typeof step.route === 'function' ? step.route(ctxRef.current) : step.route
      if (want && want !== pathname) {
        router.push(want)
        // Don't race the navigation — the target lives on the page we asked
        // for, so waiting for it is also waiting for the route.
      }

      if (!step.target) {
        if (!signal.cancelled) setReady(true)
        return
      }

      const el = await waitForTarget(step.target, WAIT_MS, signal)
      if (signal.cancelled) return

      if (!el) {
        if (step.skipIfMissing) {
          // Expected absence (Settings is owner-only). Step over it in
          // whichever direction the user was already heading, rather than
          // narrating a button this user doesn't have.
          const next = index + dirRef.current
          if (next < 0) return exit('dismissed')
          if (next > total - 1) return onExit('completed', index)
          setIndex(next)
          return
        }
        // Unexpected absence: show the step centered. The copy still lands.
        setReady(true)
        return
      }

      targetElRef.current = el
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      setRect(measure(el))
      setReady(true)
    })()

    return () => {
      signal.cancelled = true
    }
    // pathname is deliberately NOT a dependency: re-resolving on every
    // navigation would restart the step the navigation was part of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tour.id])

  // ── Keep the hole on the element ─────────────────────────────────────────
  // Re-measure every frame but only re-render when the numbers actually move,
  // so sticky nav, smooth scrolling and dropdowns can't strand the spotlight.
  useEffect(() => {
    if (!ready || !targetElRef.current) return
    let raf = 0
    const loop = () => {
      const el = targetElRef.current
      if (el) {
        const next = el.isConnected ? measure(el) : null
        setRect((prev) => (sameRect(prev, next) ? prev : next))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [ready, index])

  useEffect(() => {
    if (popRef.current) setPopHeight(popRef.current.offsetHeight)
  }, [ready, index, rect])

  // ── Follow the user ──────────────────────────────────────────────────────
  // When the next step's target is something the user has to conjure (a modal,
  // a page they create), watch for it and advance the moment it lands.
  useEffect(() => {
    if (!ready || !step.advanceWhenNextAppears) return
    const next = tour.steps[index + 1]
    if (!next?.target) return
    const signal = { cancelled: false }
    ;(async () => {
      // No timeout: the user can take as long as they like naming a project.
      const el = await waitForTarget(next.target!, Number.MAX_SAFE_INTEGER, signal)
      if (!signal.cancelled && el) setIndex((i) => (i === index ? i + 1 : i))
    })()
    return () => {
      signal.cancelled = true
    }
  }, [ready, index, step.advanceWhenNextAppears, tour.steps])

  useEffect(() => {
    onStep(index)
  }, [index, onStep])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit('dismissed')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [exit])

  // The mask panels are sized from the viewport, so a resize has to re-render
  // even when the spotlit element hasn't moved (centered steps never move).
  useEffect(() => {
    const sync = () => setViewport({ w: window.innerWidth, h: window.innerHeight })
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  const goNext = () => {
    dirRef.current = 1
    if (isLast) return onExit('completed', index)
    setIndex((i) => i + 1)
  }
  const goBack = () => {
    dirRef.current = -1
    setIndex((i) => Math.max(0, i - 1))
  }

  const pos = useMemo(
    () => (ready ? placePopover(rect, step.placement, popHeight) : null),
    [ready, rect, step.placement, popHeight],
  )

  if (typeof document === 'undefined' || viewport.w === 0) return null

  const maskStyle = 'fixed bg-[#111]/60 z-[9998]'
  const { w: vw, h: vh } = viewport

  return createPortal(
    <>
      {/* Mask. Four pieces around the hole so the highlighted element keeps
          receiving real clicks. No hole → one full-screen sheet. */}
      {rect ? (
        <>
          <div className={maskStyle} style={{ top: 0, left: 0, width: vw, height: rect.top }} />
          <div
            className={maskStyle}
            style={{ top: rect.top + rect.height, left: 0, width: vw, height: Math.max(0, vh - rect.top - rect.height) }}
          />
          <div className={maskStyle} style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
          <div
            className={maskStyle}
            style={{ top: rect.top, left: rect.left + rect.width, width: Math.max(0, vw - rect.left - rect.width), height: rect.height }}
          />
          {/* Ring. pointer-events:none so it never intercepts the click the
              step is asking for. */}
          <div
            className="fixed z-[9998] rounded-lg ring-2 ring-[#2563EB] pointer-events-none transition-all duration-150"
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
        </>
      ) : (
        <div className={`${maskStyle} inset-0`} style={{ width: vw, height: vh, top: 0, left: 0 }} />
      )}

      {/* Popover */}
      {ready && pos && (
        <div
          ref={popRef}
          role="dialog"
          aria-live="polite"
          aria-label={`${tour.title}: step ${index + 1} of ${total}`}
          className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-[#E5E7EB] p-4"
          style={{ top: pos.top, left: pos.left, width: POPOVER_W }}
        >
          <button
            onClick={() => exit('dismissed')}
            className="absolute top-3 right-3 p-1 rounded-lg text-[#9CA3AF] hover:text-[#111] hover:bg-[#F3F4F6] transition-colors"
            aria-label="Close walkthrough"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="text-[11px] font-semibold text-[#2563EB] uppercase tracking-wider mb-1.5">
            Step {index + 1} of {total}
          </div>
          <h3 className="text-[15px] font-semibold text-[#111] mb-1.5 pr-6">{step.title}</h3>
          <p className="text-[13px] text-[#6B7280] leading-relaxed">{step.body}</p>

          <div className="flex items-center gap-2 mt-4">
            {index > 0 && (
              <button
                onClick={goBack}
                className="px-3 py-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            <div className="flex-1" />
            {isLast && tour.chainTo ? (
              <>
                <button
                  onClick={() => onExit('completed', index)}
                  className="px-3 py-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111] hover:bg-[#F3F4F6] rounded-lg transition-colors"
                >
                  {tour.chainTo.declineLabel}
                </button>
                <button
                  onClick={onChain}
                  className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] transition-colors"
                >
                  {tour.chainTo.label}
                </button>
              </>
            ) : (
              <button
                onClick={goNext}
                className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8] transition-colors"
              >
                {isLast ? 'Done' : 'Next'}
              </button>
            )}
          </div>
        </div>
      )}
    </>,
    document.body,
  )
}
