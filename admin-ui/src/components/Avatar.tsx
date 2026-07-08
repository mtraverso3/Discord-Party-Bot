import { hueOf } from '../lib/time'
import { cn } from '../lib/cn'

export function Avatar({ name, imageUrl, title, className }: {
  name?: string
  imageUrl?: string | null
  title?: string
  className?: string
}) {
  const n = name || '?'
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={title ?? n}
        title={title}
        className={cn('size-8 shrink-0 rounded-full object-cover', className)}
      />
    )
  }
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white select-none',
        className,
      )}
      style={{ background: `hsl(${hueOf(n)}, 48%, 46%)` }}
      title={title}
    >
      {n.slice(0, 1).toUpperCase()}
    </span>
  )
}
