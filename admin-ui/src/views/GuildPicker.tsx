import { ChevronRight, KeyRound, ServerOff } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import type { GuildInfo } from '../types'
import { GuildIcon } from '../components/brand'
import { EmptyState, Mono } from '../components/common'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'

function openGuild(id: string) {
  location.href = '?guild=' + encodeURIComponent(id) + '#/dashboard'
}

export function GuildPicker() {
  const { data: guilds } = useLoad(() => api<GuildInfo[]>('/guilds').catch(() => [] as GuildInfo[]))
  const [manualId, setManualId] = useState('')
  const [showManual, setShowManual] = useState(false)

  if (!guilds) {
    return (
      <Card className="gap-0 overflow-hidden py-0">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex items-center gap-3 border-b p-4 last:border-0">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex-1 space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-28" /></div>
          </div>
        ))}
      </Card>
    )
  }

  let last: string | null = null
  try { last = localStorage.getItem('pb-guild') } catch { /* private mode */ }
  const sorted = guilds.slice().sort((a, b) => Number(b.id === last) - Number(a.id === last))

  return (
    <div className="space-y-4">
      {sorted.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          {sorted.map(g => (
            <a
              key={g.id}
              className="group flex items-center gap-3.5 border-b p-4 transition-colors last:border-0 hover:bg-accent/50 focus-visible:bg-accent/50 focus-visible:outline-none"
              href={'?guild=' + encodeURIComponent(g.id) + '#/dashboard'}
            >
              <GuildIcon guild={g} className="size-10 text-sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{g.name}</span>
                  {g.id === last && <Badge variant="primary">Last used</Badge>}
                </div>
                <Mono>{g.id}</Mono>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </a>
          ))}
        </Card>
      ) : (
        <EmptyState icon={<ServerOff />} title="Couldn't list servers">
          Enter a guild ID below to open it directly.
        </EmptyState>
      )}

      <div className="flex justify-center">
        {showManual || sorted.length === 0 ? (
          <form
            className="flex w-full max-w-md gap-2"
            onSubmit={e => { e.preventDefault(); if (manualId.trim()) openGuild(manualId.trim()) }}
          >
            <Input
              type="text"
              placeholder="Guild ID"
              autoComplete="off"
              autoFocus={showManual}
              value={manualId}
              onChange={e => setManualId(e.target.value)}
            />
            <Button type="submit" variant="secondary">Open</Button>
          </form>
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowManual(true)}>
            <KeyRound />Enter a guild ID manually
          </Button>
        )}
      </div>
    </div>
  )
}
