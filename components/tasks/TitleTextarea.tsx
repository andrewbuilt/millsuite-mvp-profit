'use client'

// ============================================================================
// TitleTextarea — the "What needs doing?" field, wrapped + growing
// ============================================================================
// Capacity round 2 item 5: the CREATE inputs (/tasks, /pm, the drawer, the
// project button) still scrolled a long title sideways in one line — batch
// 2's wrap fix only reached the edit field. A drop-in for the old <input>:
// same value/onChange/onKeyDown, Enter (no Shift) still fires the caller's
// Enter handler instead of adding a newline, pasted newlines fold to spaces.
// ============================================================================

import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react'

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows'> & { value: string }

const TitleTextarea = forwardRef<HTMLTextAreaElement, Props>(function TitleTextarea(
  { value, onChange, onKeyDown, className = '', ...rest },
  ref,
) {
  const el = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => el.current as HTMLTextAreaElement)
  useLayoutEffect(() => {
    const t = el.current
    if (!t) return
    t.style.height = 'auto'
    t.style.height = `${t.scrollHeight}px`
  }, [value])
  return (
    <textarea
      {...rest}
      ref={el}
      rows={1}
      value={value}
      onChange={(e) => {
        if (/\n/.test(e.target.value)) e.target.value = e.target.value.replace(/\s*\n\s*/g, ' ')
        onChange?.(e)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) e.preventDefault()
        onKeyDown?.(e)
      }}
      className={`${className} resize-none overflow-hidden leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]`}
    />
  )
})

export default TitleTextarea
