import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const GAP = 6
const MARGIN = 8

/**
 * Shows `content` next to `children` on hover, keyboard focus or tap. Rendered
 * in a portal with fixed positioning so cards and scroll areas don't clip it,
 * and kept inside the viewport (flips above when there's no room below).
 */
export function HoverCard({ content, children }: { content: ReactNode; children: ReactNode }) {
  const trigger = useRef<HTMLSpanElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !trigger.current || !card.current) { setPos(null); return }
    const t = trigger.current.getBoundingClientRect()
    const c = card.current.getBoundingClientRect()
    const left = Math.min(Math.max(MARGIN, t.left + t.width / 2 - c.width / 2), window.innerWidth - c.width - MARGIN)
    const below = t.bottom + GAP
    const top = below + c.height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, t.top - GAP - c.height)
    setPos({ left, top })
  }, [open])

  return (
    <span
      ref={trigger}
      tabIndex={0}
      className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && createPortal(
        <div
          ref={card}
          role="tooltip"
          className="pointer-events-none fixed z-50 w-72 rounded-md border border-zinc-700 bg-zinc-900 p-2.5 text-xs leading-relaxed text-zinc-200 shadow-lg"
          style={pos ?? { left: -9999, top: 0, visibility: 'hidden' }}
        >
          {content}
        </div>,
        document.body,
      )}
    </span>
  )
}
