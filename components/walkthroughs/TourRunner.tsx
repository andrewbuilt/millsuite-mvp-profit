'use client'

// ============================================================================
// TourRunner — the coach-mark engine
// ============================================================================
// Renders one step of one tour: a ring around the thing being talked about and
// a small card that travels to it. It knows how to navigate between pages
// mid-tour and how to wait for a target that doesn't exist yet. It knows
// nothing about what any tour says — that's lib/walkthroughs.
//
// THE PAGE IS NEVER DIMMED AND NEVER BLOCKED (Andrew, 2026-08-13). The opt-in
// modal is the only opaque thing; once a tour is running you're looking at the
// real app. The first build dimmed the page AND put a Next button on every
// card, which meant two things to click that did different things — you'd read
// "Click New project", and then have to guess whether that meant the real
// button or the tour's own button. Now there is exactly one thing to do at any
// moment:
//
//   ACTION step  — the tour is waiting for you to do the real thing (click New
//                  project, name the job). NO buttons on the card at all; it
//                  advances the instant the app shows the result. Marked by
//                  `advanceWhenNextAppears` in the tour script.
//   INFO step    — nothing to do; the card carries Back/Next. This isn't a
//                  fallback, it's required: the whole Welcome tour is a look
//                  around the nav with nothing to click, so without a Next
//                  button it could never move.
//
// Two failure modes are designed for rather than assumed away:
//   • Target never appears — after WAIT_MS the step still shows, just centered
//     with no ring. The copy lands even when the anchor doesn't. Steps flagged
//     skipIfMissing (owner-only Settings) drop out instead.
//   • Target moves — the rect is re-measured every frame and only written to
//     state when it actually changed, so sticky headers, dropdowns opening and
//     lazy content don't leave the ring behind.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { loadProjectIds } from '@/lib/practice'
import type { Tour, TourContext, TourStep } from '@/lib/walkthroughs'

const WAIT_MS = 6000 // how long to look for a target before going centered
/** How long an action step waits before it quietly offers a way past itself.
 *  An action step has no buttons on purpose, but "no buttons" must never mean
 *  "no exit" — if the app doesn't do the expected thing, the user is stuck
 *  staring at a card with nothing to press. Long enough not to undercut the
 *  instruction, short enough that nobody feels trapped. */
const STUCK_MS = 12000
const NEW_PROJECT_POLL_MS = 500
const PAD = 6 // ring breathing room around the element
const POPOVER_W = 340
const GAP = 14 // card ↔ ring
const EDGE = 12 // card ↔ viewport edge

/** A target bigger than this much of the viewport isn't a thing you can point
 *  at — it's the page. Ringing the whole screen says nothing, so those steps
 *  render as a centered card with no ring. ("The project home" targets the
 *  entire project page by design.) */
const HUGE = 0.6

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
 *  paint doesn't cost an arbitrary interval of dead time.
 *
 *  `timeoutMs: null` means wait indefinitely. It has to be an explicit null,
 *  NOT a huge number: setTimeout's delay is a WebIDL long, so anything past
 *  2^31-1 wraps through ToInt32 and clamps to 0 — passing MAX_SAFE_INTEGER
 *  fires the timeout on the next tick, which is the exact opposite of what it
 *  reads like. */
function waitForTarget(
  target: string,
  timeoutMs: number | null,
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
      if (timer !== null) clearTimeout(timer)
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
    const timer = timeoutMs === null ? null : setTimeout(() => finish(null), timeoutMs)
  })
}

/** The element's true viewport rect. Deliberately NOT clamped into the
 *  viewport: an earlier version did `Math.max(0, top - PAD)`, so a target that
 *  had scrolled above the fold got a ring pinned to y=0 — which is why "Send
 *  the estimate" drew a box around the top nav instead of the Documents row.
 *  An off-screen rect is honest; the caller scrolls to it or falls back to
 *  centering. */
function measure(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
}

/** Is something painted on top of this element? A tour that rings a button
 *  sitting behind a modal draws a blue box over whatever the modal happens to
 *  show there — which is how "Compose a line" ended up appearing to highlight
 *  the composer's Interior Finish dropdown. Our own ring and card are excluded
 *  (the ring is pointer-events:none anyway, but the card is not, and letting it
 *  count as occlusion makes the ring flap on and off as the card moves). */
function isOccluded(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect()
  const cx = r.left + r.width / 2
  const cy = r.top + r.height / 2
  if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false
  const hit = document.elementFromPoint(cx, cy)
  if (!hit) return false
  if (hit.closest('[data-tour-ui]')) return false
  return !(el.contains(hit) || hit.contains(el))
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5)

/** Where the card sits relative to the ring.
 *
 *  The requested placement is a PREFERENCE, not an instruction. Two rules
 *  override it, in order:
 *    1. It has to fit on screen.
 *    2. It must not cover the ring.
 *
 *  Rule 2 is why this got rewritten. "Where it shows up" points at the full
 *  width "Shows in" row, so a 'right' placement couldn't fit, fell back to
 *  'left', clamped against the viewport edge — and landed on top of the name
 *  field the user was being asked to fill in. Sliding a card to the nearest
 *  edge is not the same as getting it out of the way.
 *
 *  If no side works, dock in the corner furthest from the ring: guaranteed not
 *  to cover it, and predictable.
 */
function placePopover(
  rect: Rect | null,
  placement: TourStep['placement'],
  height: number,
  dock = false,
): { top: number; left: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const centred = {
    top: Math.max(EDGE, vh / 2 - height / 2),
    left: Math.max(EDGE, vw / 2 - POPOVER_W / 2),
  }
  if (!rect) {
    return dock ? { top: Math.max(EDGE, vh - height - EDGE), left: EDGE } : centred
  }

  const clampX = (x: number) => Math.min(Math.max(EDGE, x), Math.max(EDGE, vw - POPOVER_W - EDGE))
  const clampY = (y: number) => Math.min(Math.max(EDGE, y), Math.max(EDGE, vh - height - EDGE))
  const midX = clampX(rect.left + rect.width / 2 - POPOVER_W / 2)
  const midY = clampY(rect.top + rect.height / 2 - height / 2)

  const candidates: Record<string, { top: number; left: number }> = {
    bottom: { top: rect.top + rect.height + GAP, left: midX },
    top: { top: rect.top - GAP - height, left: midX },
    right: { top: midY, left: rect.left + rect.width + GAP },
    left: { top: midY, left: rect.left - GAP - POPOVER_W },
  }

  const fits = (p: { top: number; left: number }) =>
    p.top >= EDGE && p.left >= EDGE && p.top + height <= vh - EDGE && p.left + POPOVER_W <= vw - EDGE

  const overlapsRing = (p: { top: number; left: number }) =>
    p.left < rect.left + rect.width &&
    p.left + POPOVER_W > rect.left &&
    p.top < rect.top + rect.height &&
    p.top + height > rect.top

  // Preferred side first, then the rest — opposite before perpendicular, since
  // the opposite side is usually the roomiest.
  const opposite: Record<string, string> = { bottom: 'top', top: 'bottom', left: 'right', right: 'left' }
  const first = placement ?? 'bottom'
  const order = [first, opposite[first], ...Object.keys(candidates)].filter(
    (k, i, a) => a.indexOf(k) === i,
  )

  for (const key of order) {
    const p = candidates[key]
    if (p && fits(p) && !overlapsRing(p)) return p
  }

  // Nothing fits beside it. Take the corner furthest from the ring's centre so
  // the card is as far from the work as the screen allows.
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  return {
    left: cx < vw / 2 ? vw - POPOVER_W - EDGE : EDGE,
    top: cy < vh / 2 ? vh - height - EDGE : EDGE,
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
  const { org } = useAuth()
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(0, startIndex), tour.steps.length - 1),
  )
  const [rect, setRect] = useState<Rect | null>(null)
  const [ready, setReady] = useState(false)
  const [popHeight, setPopHeight] = useState(160)
  const popRef = useRef<HTMLDivElement>(null)
  const targetElRef = useRef<HTMLElement | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [stuck, setStuck] = useState(false)
  const [occluded, setOccluded] = useState(false)

  // Which way the user is travelling. A skipped step has to skip the way they
  // were going, or Back onto an owner-only step bounces them straight forward
  // again and reads as a dead button.
  const dirRef = useRef<1 | -1>(1)

  // What the tour has learned. A ref, not state: it's read inside async
  // resolution and must never trigger a re-render of its own.
  const ctxRef = useRef<TourContext>({ projectPath: null, subprojectPath: null, invoicePath: null })

  // Where each step was actually shown. Back used to only navigate when the
  // step declared a `route`, so stepping back from the subproject page to a
  // step that had been shown on the project page left you on the wrong page
  // reading the right card — and then sat there for the full target timeout.
  const pathAtStep = useRef<Record<number, string>>({})

  const step = tour.steps[index]
  const total = tour.steps.length
  const isLast = index === total - 1
  // The tour is waiting on the user to do the real thing — so the card offers
  // nothing to click and gets out of the way.
  const isAction = !!(step.advanceWhenNextAppears || step.waitForNewProject || step.advanceOnEvent)

  // Remember the project the user builds during the tour, so the step that
  // sends them back to the estimate knows where "back" is.
  useEffect(() => {
    // Invoices: same idea as projects below — the getting-paid lesson follows
    // the user into an invoice it can't name up front.
    const inv = /^\/invoices\/([^/]+)/.exec(pathname || '')
    if (inv) ctxRef.current.invoicePath = `/invoices/${inv[1]}`
    const m = /^\/projects\/([^/]+)/.exec(pathname || '')
    if (!m) return
    ctxRef.current.projectPath = `/projects/${m[1]}`
    const sub = /^\/projects\/[^/]+\/subprojects\/[^/]+/.exec(pathname || '')
    if (sub) ctxRef.current.subprojectPath = sub[0]
    onProjectSeen?.(m[1])
  }, [pathname, onProjectSeen])

  const exit = useCallback((reason: ExitReason) => onExit(reason, index), [onExit, index])

  // ── Resolve the current step: navigate, then find the target ──────────────
  useEffect(() => {
    const signal = { cancelled: false }
    setReady(false)
    setRect(null)
    setOccluded(false)
    targetElRef.current = null

    ;(async () => {
      const declared = typeof step.route === 'function' ? step.route(ctxRef.current) : step.route
      // A step with no declared route still knows where it lived last time.
      const want = declared ?? pathAtStep.current[index] ?? null
      if (want && want !== pathname) {
        router.push(want)
        // Don't race the navigation — the target lives on the page we asked
        // for, so waiting for it is also waiting for the route.
      }

      if (!step.target) {
        if (!signal.cancelled) {
          pathAtStep.current[index] = window.location.pathname
          setReady(true)
        }
        return
      }

      // Going BACKWARD, a missing target usually means its transient UI is
      // gone (the add form closed, the modal dismissed) — waiting the full
      // timeout just makes Back feel broken. Fail fast and show the copy.
      const el = await waitForTarget(step.target, dirRef.current === -1 ? 1200 : WAIT_MS, signal)
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
        // Unexpected absence: show the step anyway. The copy still lands.
        pathAtStep.current[index] = window.location.pathname
        setReady(true)
        return
      }

      targetElRef.current = el
      // Only scroll to things we can actually point at. Centring a target the
      // size of the page dumps you in the MIDDLE of it — which is why opening
      // the new project landed halfway down.
      const m = measure(el)
      const pageSized = m.width > window.innerWidth * HUGE && m.height > window.innerHeight * HUGE
      if (pageSized) window.scrollTo({ top: 0, behavior: 'smooth' })
      else el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
      setRect(m)
      pathAtStep.current[index] = window.location.pathname
      setReady(true)
    })()

    return () => {
      signal.cancelled = true
    }
    // pathname is deliberately NOT a dependency: re-resolving on every
    // navigation would restart the step the navigation was part of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tour.id])

  // ── Keep the ring on the element ─────────────────────────────────────────
  // Re-measure every frame but only re-render when the numbers actually move,
  // so sticky nav, smooth scrolling and dropdowns can't strand the highlight.
  useEffect(() => {
    // Gate on the step HAVING a target, not on having already found it. The
    // loop used to start only when the first lookup succeeded, so a control
    // that rendered a moment late (the project page finishing its load) never
    // got a ring at all for the rest of the step — the copy pointed at a button
    // with nothing drawn on it.
    if (!ready || !step.target) return
    let raf = 0
    const loop = () => {
      // Re-resolve from the DOM rather than trusting the cached node. When the
      // new-project modal closed, the cached element kept reporting a rect and
      // left an empty blue outline floating over the board.
      const el = targetElRef.current
      const live = el && el.isConnected && findTarget(step.target) === el ? el : findTarget(step.target)
      targetElRef.current = live
      setRect((prev) => {
        const next = live ? measure(live) : null
        return sameRect(prev, next) ? prev : next
      })
      const hidden = live ? isOccluded(live) : false
      setOccluded((prev) => (prev === hidden ? prev : hidden))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [ready, index, step.target])

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
      const el = await waitForTarget(next.target!, null, signal)
      if (!signal.cancelled && el) setIndex((i) => (i === index ? i + 1 : i))
    })()
    return () => {
      signal.cancelled = true
    }
  }, [ready, index, step.advanceWhenNextAppears, tour.steps])

  // ── Advance on the real save ─────────────────────────────────────────────
  // The app announces successful saves (lib/tour-events); a form step advances
  // on that, not on the form appearing or a click landing. This is what lets a
  // lesson ring a whole form ("name it, price it, click Add material") and
  // wait for the row to actually exist.
  useEffect(() => {
    if (!ready || !step.advanceOnEvent) return
    const name = step.advanceOnEvent
    const onFire = () => setIndex((i) => (i === index ? i + 1 : i))
    window.addEventListener(name, onFire)
    return () => window.removeEventListener(name, onFire)
  }, [ready, index, step.advanceOnEvent])

  // ── Open the project the user just made ─────────────────────────────────
  // Creating from the kanban closes the modal and drops a card on the board;
  // it does NOT navigate. So the tour snapshots the project list, waits for an
  // id that wasn't there, and opens it. Without this the step waited forever
  // for a page nothing was going to open.
  useEffect(() => {
    if (!ready || !step.waitForNewProject || !org?.id) return
    const signal = { cancelled: false }
    let timer: ReturnType<typeof setTimeout> | null = null
    ;(async () => {
      const before = await loadProjectIds(org.id)
      if (signal.cancelled || !before) return
      const poll = async () => {
        if (signal.cancelled) return
        const now = await loadProjectIds(org.id)
        if (signal.cancelled || !now) return
        const fresh = [...now].find((id) => !before.has(id))
        if (fresh) {
          ctxRef.current.projectPath = `/projects/${fresh}`
          onProjectSeen?.(fresh)
          router.push(`/projects/${fresh}`)
          setIndex((i) => (i === index ? i + 1 : i))
          return
        }
        timer = setTimeout(poll, NEW_PROJECT_POLL_MS)
      }
      timer = setTimeout(poll, NEW_PROJECT_POLL_MS)
    })()
    return () => {
      signal.cancelled = true
      if (timer) clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, index, step.waitForNewProject, org?.id])

  // ── Never trap ──────────────────────────────────────────────────────────
  // Action steps carry no buttons by design, but the app can always fail to do
  // the expected thing — and resuming straight onto one (from Guides, after a
  // reload) lands on a step whose trigger already happened and will never fire
  // again. Both left the user staring at a card with nothing to press. After a
  // pause, or immediately on a resumed step, a quiet way forward appears.
  useEffect(() => {
    if (!isAction || !ready) {
      setStuck(false)
      return
    }
    const resumedOntoThisStep = index === startIndex
    if (resumedOntoThisStep) {
      setStuck(true)
      return
    }
    setStuck(false)
    const t = setTimeout(() => setStuck(true), STUCK_MS)
    return () => clearTimeout(t)
  }, [isAction, ready, index, startIndex])

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

  // A target that fills the screen, or one that's scrolled out of sight, gets
  // no ring — a box around everything (or around nothing) is worse than none.
  const ringRect = useMemo(() => {
    if (!rect || viewport.w === 0) return null
    const fillsScreen = rect.width > viewport.w * HUGE && rect.height > viewport.h * HUGE
    const offScreen =
      rect.top + rect.height < 0 || rect.top > viewport.h || rect.left + rect.width < 0 || rect.left > viewport.w
    if (fillsScreen || offScreen) return null
    // Behind a modal: the ring would paint over whatever the modal shows there.
    if (occluded) return null
    return rect
  }, [rect, viewport, occluded])

  // A step that NAMES a target but couldn't get a ring docks out of the way;
  // a step that never had one (the closers) is genuinely a centred card.
  const dock = !!step.target && !ringRect

  const pos = useMemo(
    () => (ready ? placePopover(ringRect, step.placement, popHeight, dock) : null),
    [ready, ringRect, step.placement, popHeight, dock],
  )

  // Render NOTHING until the step has resolved — no flash of a card pointing
  // at the wrong thing while we're still navigating.
  if (typeof document === 'undefined' || viewport.w === 0 || !ready || !pos) return null

  return createPortal(
    <>
      {/* Ring only. No mask, no dimming, nothing over the page: the app stays
          fully live and every click goes where the user aimed it. */}
      {ringRect && (
        <div
          data-tour-ui="ring"
          className="fixed z-[9998] rounded-lg pointer-events-none transition-all duration-200"
          style={{
            top: ringRect.top,
            left: ringRect.left,
            width: ringRect.width,
            height: ringRect.height,
            boxShadow: '0 0 0 2px #2563EB, 0 0 0 7px rgba(37,99,235,0.22)',
          }}
        />
      )}

      <div
        ref={popRef}
        data-tour-ui="card"
        role="dialog"
        aria-live="polite"
        aria-label={`${tour.title}: step ${index + 1} of ${total}`}
        className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-[#E5E7EB] p-4 transition-[top,left] duration-200"
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

        {isAction ? (
          // No buttons at all — the highlighted control IS the button. The one
          // line of chrome exists because the first build left people guessing
          // which of two things to click.
          <div className="flex items-center gap-2 mt-3.5 pt-3 border-t border-[#F3F4F6]">
            <span className="relative flex h-2 w-2 flex-shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2563EB] opacity-60" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2563EB]" />
            </span>
            <span className="text-[12px] text-[#9CA3AF]">
              {/* Two kinds of waiting: a save step moves on when the row lands;
                  a click step's next move is the highlighted control. Both
                  point OUTWARD at the app — the card never claims the click. */}
              {step.advanceOnEvent ? 'Moves on when it’s saved.' : 'The highlighted button is the next step.'}
            </span>
            <div className="flex-1" />
            {/* Appears only once the step looks stuck, so the happy path still
                has exactly one thing to do. */}
            {stuck && (
              <button
                onClick={goNext}
                className="text-[12px] font-medium text-[#2563EB] hover:underline whitespace-nowrap"
              >
                Skip →
              </button>
            )}
          </div>
        ) : (
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
        )}
      </div>
    </>,
    document.body,
  )
}
