import { Check, ChevronsUpDown, Hash } from 'lucide-react'
import { useState } from 'react'
import type { ChannelInfo } from '../types'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface Props {
  channels: ChannelInfo[]
  value: string
  onChange: (id: string) => void
  /** Adds a "None" entry that clears the selection. */
  allowNone?: boolean
  placeholder?: string
}

/**
 * Searchable channel picker (shadcn combobox: Popover + Command) for a
 * potentially huge client-side channel list.
 */
export function ChannelSelect({ channels, value, onChange, allowNone, placeholder }: Props) {
  const [open, setOpen] = useState(false)
  const selected = channels.find(c => c.id === value)
  const unknown = value && !selected

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between bg-transparent px-3 font-normal dark:bg-input/30', !selected && !unknown && 'text-muted-foreground')}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {(selected || unknown) && <Hash className="text-muted-foreground" />}
            <span className="truncate">
              {unknown ? `unknown (${value})` : selected ? selected.name : allowNone ? 'None' : (placeholder || 'Select a channel')}
            </span>
          </span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search channels…" />
          <CommandList>
            <CommandEmpty>No channels match.</CommandEmpty>
            <CommandGroup>
              {allowNone && (
                <CommandItem value="__none__" onSelect={() => pick('')} className="text-muted-foreground">
                  <Check className={cn(value ? 'opacity-0' : 'opacity-100')} />
                  None
                </CommandItem>
              )}
              {channels.map(c => (
                <CommandItem key={c.id} value={`${c.name} ${c.id}`} onSelect={() => pick(c.id)}>
                  <Check className={cn(c.id === value ? 'opacity-100' : 'opacity-0')} />
                  <Hash />
                  <span className="truncate">{c.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
