import { ChevronRight, CircleDot, Gamepad2, Hourglass, Plus, Swords, Timer, Users as UsersIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { useGuildData } from '../lib/guildData'
import { deadlineOf, fmtAbs, relTime } from '../lib/time'
import type { GuildSettings, Party } from '../types'
import { EmptyState, ErrorNote, Mono } from '../components/common'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Progress } from '../components/ui/progress'
import { Skeleton } from '../components/ui/skeleton'
import { cn } from '@/lib/utils'

export function Dashboard() {
  const guildData = useGuildData()
  const { data, error } = useLoad(async () => {
    const [parties, settings] = await Promise.all([
      api<Party[]>('/parties'),
      guildData.getSettings(true),
    ])
    return { parties, settings }
  })

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!data) return <DashboardSkeleton />
  const { parties, settings } = data

  return (
    <div className="space-y-6">
      <Stats parties={parties} settings={settings} />
      {parties.length === 0 ? (
        <EmptyState
          icon={<Swords />}
          title="No active parties"
          action={<Button size="sm" asChild><a href="#/parties"><Plus />Create a party</a></Button>}
        >
          Parties members create in Discord show up here as they happen.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle>Top active parties</CardTitle>
              <CardDescription>Busiest rosters right now.</CardDescription>
              <CardAction>
                <Button variant="ghost" size="sm" asChild><a href="#/parties">View all<ChevronRight /></a></Button>
              </CardAction>
            </CardHeader>
            <CardContent><TopActive parties={parties} /></CardContent>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Next auto-disbands</CardTitle>
              <CardDescription>Idle parties are swept on a schedule.</CardDescription>
            </CardHeader>
            <CardContent><DisbandsSoon parties={parties} /></CardContent>
          </Card>
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>By game</CardTitle>
              <CardDescription>Where players are right now.</CardDescription>
            </CardHeader>
            <CardContent><ByGame parties={parties} /></CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-xl lg:col-span-3" />
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, footer }: { label: string; value: ReactNode; icon: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardDescription className="flex items-center gap-2 text-xs font-medium tracking-wide uppercase">{label}</CardDescription>
        <CardAction>
          <div className="rounded-md bg-primary/10 p-1.5 text-primary [&_svg]:size-4">{icon}</div>
        </CardAction>
        <CardTitle className="text-3xl font-semibold tracking-tight tabular-nums">{value}</CardTitle>
      </CardHeader>
      {footer && <CardContent className="px-5 text-xs text-muted-foreground">{footer}</CardContent>}
    </Card>
  )
}

function Stats({ parties, settings }: { parties: Party[]; settings: GuildSettings }) {
  const members = parties.reduce((a, p) => a + p.members.length, 0)
  const seats = parties.reduce((a, p) => a + p.maxSize, 0)
  const queued = parties.reduce((a, p) => a + p.queue.length, 0)
  const open = parties.filter(p => !p.isClosed && p.members.length < p.maxSize).length
  const full = parties.filter(p => !p.isClosed && p.members.length >= p.maxSize).length
  const closed = parties.filter(p => p.isClosed).length
  const total = parties.length || 1

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Active parties"
        icon={<Swords />}
        value={<>{parties.length}<span className="text-lg font-normal text-muted-foreground"> / {settings.maxParties}</span></>}
        footer={<Progress value={Math.min(100, (parties.length / Math.max(1, settings.maxParties)) * 100)} className="h-1.5" />}
      />
      <StatCard
        label="Players in parties"
        icon={<UsersIcon />}
        value={members}
        footer={seats > 0 ? `${Math.round((members / seats) * 100)}% of ${seats} seats filled` : 'No open seats'}
      />
      <StatCard
        label="Waiting in queues"
        icon={<Hourglass />}
        value={queued}
        footer={queued > 0 ? `Across ${plural(parties.filter(p => p.queue.length > 0).length, 'party', 'parties')}` : 'Nobody waiting'}
      />
      <StatCard
        label="Party status"
        icon={<CircleDot />}
        value={<span className="flex items-baseline gap-3 text-2xl">
          <span className="text-success">{open}</span>
          <span className="text-warning">{full}</span>
          <span className="text-destructive">{closed}</span>
        </span>}
        footer={
          <div className="space-y-2">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="bg-success" style={{ width: `${(open / total) * 100}%` }} />
              <div className="bg-warning" style={{ width: `${(full / total) * 100}%` }} />
              <div className="bg-destructive" style={{ width: `${(closed / total) * 100}%` }} />
            </div>
            <div className="flex gap-3">
              <span>Open</span><span>Full</span><span>Closed</span>
            </div>
          </div>
        }
      />
    </div>
  )
}

function ByGame({ parties }: { parties: Party[] }) {
  const byGame = new Map<string, { parties: number; members: number }>()
  for (const p of parties) {
    const g = byGame.get(p.game) || { parties: 0, members: 0 }
    g.parties++
    g.members += p.members.length
    byGame.set(p.game, g)
  }
  const rows = [...byGame.entries()].sort((a, b) => b[1].members - a[1].members || b[1].parties - a[1].parties)
  const max = Math.max(1, ...rows.map(([, n]) => n.members))
  return (
    <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
      {rows.map(([g, n]) => (
        <div key={g} className="space-y-1.5">
          <div className="flex items-center gap-2 text-sm">
            <Gamepad2 className="size-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium">{g}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {n.parties} {n.parties === 1 ? 'party' : 'parties'} · {n.members} {n.members === 1 ? 'player' : 'players'}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-chart-1" style={{ width: `${Math.max(4, (n.members / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TopActive({ parties }: { parties: Party[] }) {
  const top = [...parties]
    .sort((a, b) => b.members.length - a.members.length || a.maxSize - b.maxSize)
    .slice(0, 5)

  return (
    <div className="-mx-2 divide-y">
      {top.map(p => (
        <PartyRow key={p.id} p={p}>
          <div className="flex w-28 shrink-0 items-center gap-2 sm:w-36">
            <Progress
              value={p.maxSize > 0 ? Math.min(100, (p.members.length / p.maxSize) * 100) : 0}
              className="h-1.5"
              indicatorClassName={p.members.length >= p.maxSize ? 'bg-warning' : undefined}
            />
            <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{p.members.length}/{p.maxSize}</span>
          </div>
        </PartyRow>
      ))}
    </div>
  )
}

function DisbandsSoon({ parties }: { parties: Party[] }) {
  const now = Date.now()
  const soon = parties
    .map(p => ({ p, deadline: deadlineOf(p) }))
    .sort((a, b) => a.deadline - b.deadline)
    .slice(0, 5)
  return (
    <div className="-mx-2 divide-y">
      {soon.map(({ p, deadline }) => {
        const left = deadline - now
        return (
          <PartyRow key={p.id} p={p}>
            <Badge
              variant={left <= 0 ? 'destructive' : left < 30 * 60_000 ? 'warning' : 'outline'}
              className="shrink-0 tabular-nums"
              title={fmtAbs(deadline)}
            >
              <Timer />
              {left > 0 ? 'in ' + relTime(left) : 'overdue'}
            </Badge>
          </PartyRow>
        )
      })}
    </div>
  )
}

function statusTone(p: Party): string {
  return p.isClosed ? 'bg-destructive' : p.members.length >= p.maxSize ? 'bg-warning' : 'bg-success'
}

/** A party list row that links to the party's detail page in the Parties tab. */
function PartyRow({ p, children }: { p: Party; children: ReactNode }) {
  return (
    <a
      href={`#/parties/${encodeURIComponent(p.id)}`}
      className="group flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/50"
    >
      <span className={cn('size-2 shrink-0 rounded-full', statusTone(p))} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{p.name}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">{p.game}</span>
          <span>·</span>
          <Mono className="truncate">{p.id}</Mono>
        </div>
      </div>
      {children}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
    </a>
  )
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}
