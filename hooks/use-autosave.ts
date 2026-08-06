// ============================================================================
// hooks/use-autosave.ts — debounced persist that survives navigating away.
// ============================================================================
// The pattern this replaces (repeated on /team and /settings):
//
//   useEffect(() => {
//     const t = setTimeout(() => save(value), 600)
//     return () => clearTimeout(t)        // ← unmount CANCELS the pending save
//   }, [value])
//
// Edit a field, click a nav link within 600ms, and the cleanup throws the save
// away. The edit is gone with no error and no warning — which is exactly what
// Andrew hit on /team (fix list 2, item 1).
//
// This hook keeps the debounce but flushes instead of cancelling: on unmount,
// when the tab is hidden, and on demand via `saveNow`. It also reports state so
// the page can SHOW whether work is saved rather than leaving the user to guess.
//
// Change detection is `JSON.stringify` on the value. Fine for the settings-shaped
// objects this serves (small, plain, jsonb-bound); don't hand it a value with
// unstable key order or non-serializable members.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error'

export interface Autosave {
  status: AutosaveStatus
  /** Populated when status === 'error'. */
  error: string | null
  /** Flush any pending change immediately (a "Save now" / retry button). */
  saveNow: () => void
}

export function useAutosave<T>(
  value: T,
  /** `baseline` is what this hook believes is already persisted — the value it
   *  adopted on load, or the last thing it successfully wrote. Savers that
   *  share a row with another page use it to write only what changed instead
   *  of stamping their whole copy over someone else's edits. Null before the
   *  first baseline exists. */
  save: (value: T, baseline: T | null) => Promise<void>,
  opts: {
    /** Gate the whole thing — usually `loaded && userMayWrite`. */
    enabled: boolean
    delayMs?: number
    /** Label used in the console warning when a background save fails. */
    label?: string
  },
): Autosave {
  const { enabled, delayMs = 600, label = 'autosave' } = opts

  const [status, setStatus] = useState<AutosaveStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  // Latest render's value + save fn, so the flush paths (unmount, tab hide)
  // never close over a stale copy.
  const valueRef = useRef(value)
  valueRef.current = value
  const saveRef = useRef(save)
  saveRef.current = save
  // Serialized snapshot of what's known to be persisted. null until enabled —
  // the first enabled render adopts the current value as the baseline so
  // loading a page never writes it straight back.
  const savedRef = useRef<string | null>(null)
  const inFlightRef = useRef(false)
  // Set when a flush is asked for while one is already running, so the newer
  // value gets its own save the moment the current one finishes. Without this,
  // editing during a save leaves the last keystrokes stranded until the next
  // edit or unmount.
  const againRef = useRef(false)
  // flush calls itself through a ref to avoid a circular useCallback.
  const flushRef = useRef<() => void>(() => {})

  const flush = useCallback(() => {
    if (!enabled) return
    const snapshot = JSON.stringify(valueRef.current)
    if (savedRef.current === null || savedRef.current === snapshot) return
    if (inFlightRef.current) {
      againRef.current = true
      return
    }
    inFlightRef.current = true
    setStatus('saving')
    const pending = valueRef.current
    const baseline = JSON.parse(savedRef.current) as T
    saveRef
      .current(pending, baseline)
      .then(() => {
        savedRef.current = snapshot
        setError(null)
        // A change made while this save was in flight leaves us dirty again;
        // the debounce effect below will pick it up.
        setStatus(JSON.stringify(valueRef.current) === snapshot ? 'saved' : 'unsaved')
      })
      .catch((e) => {
        // Baseline is deliberately NOT advanced — the change is still unsaved,
        // so a retry (or the next edit) tries again.
        console.warn(`${label} failed`, e)
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
      .finally(() => {
        inFlightRef.current = false
        if (againRef.current) {
          againRef.current = false
          flushRef.current()
        }
      })
  }, [enabled, label])
  flushRef.current = flush

  // Adopt a baseline the FIRST time the hook goes live, and never again.
  //
  // This used to re-adopt on every false→true transition of `enabled`, which
  // is a silent data-loss bug: `enabled` is derived from the org, and the auth
  // context replaces the org object on token refresh, tab focus and after any
  // refreshOrg(). If that flickers while an edit is pending, the baseline is
  // reset to the CURRENT (edited) value — the hook then believes those edits
  // are already persisted, the flush no-ops, and the work is dropped with no
  // error and a green "Saved" from whatever saved last.
  //
  // Only the null check matters now: null means "never been live", which is
  // the one moment adopting the current value is correct.
  useEffect(() => {
    if (!enabled) return
    if (savedRef.current !== null) return
    savedRef.current = JSON.stringify(valueRef.current)
    setStatus('idle')
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Debounce. The cleanup clears only the TIMER — the pending change stays
  // pending, and the unmount effect below flushes it.
  const serialized = enabled ? JSON.stringify(value) : ''
  useEffect(() => {
    if (!enabled || savedRef.current === null) return
    if (savedRef.current === serialized) return
    setStatus((s) => (s === 'saving' ? s : 'unsaved'))
    const t = setTimeout(flush, delayMs)
    return () => clearTimeout(t)
  }, [serialized, enabled, delayMs, flush])

  // Flush on the ways out: SPA navigation (unmount) and tab hide/close.
  // A fetch started here still goes out — React has unmounted the component,
  // not torn down the page.
  useEffect(() => {
    if (!enabled) return
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const snapshot = JSON.stringify(valueRef.current)
      if (savedRef.current === null || savedRef.current === snapshot) return
      flush()
      // A hard unload can kill the request mid-flight, so warn rather than
      // pretend. (Browsers only honour this after a real interaction.)
      e.preventDefault()
      e.returnValue = ''
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('beforeunload', onBeforeUnload)
      flush()
    }
  }, [enabled, flush])

  return { status, error, saveNow: flush }
}
