import { hueOf } from '../lib/time'
import { cn } from '@/lib/utils'
import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from './ui/avatar'

/** Discord avatar with a deterministic coloured initial while loading or when missing. */
export function Avatar({ name, imageUrl, title, className }: {
  name?: string
  imageUrl?: string | null
  title?: string
  className?: string
}) {
  const n = name || '?'
  return (
    <AvatarRoot className={cn('size-8', className)} title={title}>
      {imageUrl && <AvatarImage src={imageUrl} alt={title ?? n} />}
      <AvatarFallback
        className="text-xs font-semibold text-white select-none"
        style={{ background: `hsl(${hueOf(n)}, 48%, 46%)` }}
      >
        {n.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </AvatarRoot>
  )
}
