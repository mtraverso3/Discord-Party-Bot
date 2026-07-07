import { ChevronRight, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import type { GuildInfo } from '../types'
import { Badge, Button, Input, Mono, Spinner } from '../components/ui'

function openGuild(id: string) {
  location.href = '?guild=' + encodeURIComponent(id) + '#/dashboard'
}

export function GuildPicker() {
  const { data: guilds } = useLoad(() => api<GuildInfo[]>('/guilds').catch(() => [] as GuildInfo[]))
  const [manualId, setManualId] = useState('')

  if (!guilds) return <Spinner />

  const last = localStorage.getItem('pb-guild')
  const sorted = guilds.slice().sort((a, b) => Number(b.id === last) - Number(a.id === last))

  return (
    <div>
      {sorted.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sorted.map(g => (
            <a
              key={g.id}
              className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-md"
              href={'?guild=' + encodeURIComponent(g.id) + '#/dashboard'}
            >
              {g.icon
                ? <img className="size-11 shrink-0 rounded-full" src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`} alt="" />
                : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                    {(g.name || '?').slice(0, 1).toUpperCase()}
                  </span>
                )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold">{g.name}</span>
                  {g.id === last && <Badge variant="outline">last used</Badge>}
                </div>
                <Mono>{g.id}</Mono>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Could not list servers — enter a guild ID manually:</p>
      )}
      <details className="mt-6">
        <summary className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <KeyRound className="size-3.5" /> Enter a guild ID manually
        </summary>
        <form
          className="mt-3 flex max-w-md gap-2"
          onSubmit={e => { e.preventDefault(); if (manualId.trim()) openGuild(manualId.trim()) }}
        >
          <Input
            type="text"
            placeholder="Guild ID"
            autoComplete="off"
            value={manualId}
            onChange={e => setManualId(e.target.value)}
          />
          <Button type="submit" variant="secondary">Open</Button>
        </form>
      </details>
    </div>
  )
}
