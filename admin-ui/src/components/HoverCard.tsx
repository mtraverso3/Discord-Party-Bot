import type { ReactNode } from 'react'
import { Tooltip as TooltipPrimitive } from 'radix-ui'

/**
 * Rich League tooltip (items, augments, champions). Built on Radix Tooltip so
 * it portals out of cards, flips to stay on-screen, and opens on hover or
 * keyboard focus. Styled like the in-game tooltip: dark in both themes.
 */
export function HoverCard({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={80}>
      <TooltipPrimitive.Trigger asChild>
        <span tabIndex={0} className="inline-flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {children}
        </span>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          collisionPadding={8}
          className="z-50 w-72 animate-in rounded-md border border-zinc-700 bg-zinc-900 p-2.5 text-xs leading-relaxed text-zinc-200 shadow-lg fade-in-0 zoom-in-95"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
