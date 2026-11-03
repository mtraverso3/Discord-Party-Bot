import { PartyPopper } from 'lucide-react'
import type { GuildInfo } from '../types'
import { cn } from '@/lib/utils'

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm', className)}>
      <PartyPopper className="size-4.5" />
    </span>
  )
}

export function GuildIcon({ guild, className }: { guild: GuildInfo | null; className?: string }) {
  if (guild?.icon) {
    return (
      <img
        className={cn('size-8 shrink-0 rounded-full', className)}
        src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
        alt=""
      />
    )
  }
  return (
    <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground', className)}>
      {(guild?.name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}
