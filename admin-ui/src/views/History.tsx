import {
  ArrowLeft, Ban, ChevronRight, Clock, Crown, Gamepad2, History as HistoryIcon, Lock, LockOpen, LogIn, LogOut,
  PartyPopper, Search, Shuffle, Skull, UserCheck, UserMinus, UserX, Hourglass, ArrowUpFromLine, CircleDot,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { fmtAbs, relTime } from '../lib/time'
import { GameList } from '../components/GameList'
import { CountPill, EmptyState, ErrorNote, MiniStat, Mono, PageSkeleton, StatusDot } from '../components/common'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { cn } from '@/lib/utils'
import type { HistoryDetail, HistoryEvent, HistoryEventKind, HistorySummary } from '../types'

/** Parse #/history/<id> → the numeric session id, or null on the list route. */
function selectedHistoryId(): number | null {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  const parts = h.split('/')
  if (parts[0] !== 'history' || !parts[1]) return null
  const n = Number(decodeURIComponent(parts[1]))
  return Number.isInteger(n) ? n : null
}

const goToSession = (id: number) => { location.hash = '#/history/' + id }
const goToList = () => { location.hash = '#/history' }

const ago = (ts: number) => {
  const r = relTime(Date.now() - ts)
  return r === 'just now' ? r : r + ' ago'
}

export function History() {
  const [selectedId, setSelectedId] = useState<number | null>(selectedHistoryId)

  useEffect(() => {
    const onHash = () => setSelectedId(selectedHistoryId())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return selectedId != null ? <HistoryDetailView historyId={selectedId} /> : <HistoryListView />
}

// ── List ──────────────────────────────────────────────────────────────────────

function HistoryListView() {
  const { data, error } = useLoad<HistorySummary[]>(() => api<HistorySummary[]>('/history'))
  const [query, setQuery] = useState('')

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!data) return <PageSkeleton />
  if (data.length === 0) {
    return (
      <EmptyState icon={<HistoryIcon />} title="No party history yet">
        Every party that gets created is recorded here — who joined, who left, and any League games played.
      </EmptyState>
    )
  }

  const q = query.trim().toLowerCase()
  const rows = q
    ? data.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.game.toLowerCase().includes(q) ||
        s.partyId.toLowerCase().includes(q))
    : data

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          className="pl-8"
          placeholder="Filter by name, game, or party ID"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          {rows.length === data.length ? `${data.length} sessions` : `${rows.length} of ${data.length} sessions`}
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No sessions match “{query}”.</p>
        ) : (
          <div className="divide-y">
            {rows.map(s => <HistoryRow key={s.historyId} session={s} onOpen={() => goToSession(s.historyId)} />)}
          </div>
        )}
      </Card>
    </div>
  )
}

function HistoryRow({ session: s, onOpen }: { session: HistorySummary; onOpen: () => void }) {
  const active = s.endedAt == null
  return (
    <button
      type="button"
      className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
      onClick={onOpen}
    >
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
        <Badge variant={active ? 'success' : 'outline'} className="w-16 justify-center"><StatusDot />{active ? 'Active' : 'Ended'}</Badge>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{s.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{s.game}</span>
            <span>·</span>
            <Mono>{s.partyId}</Mono>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{s.participantCount} players</Badge>
        {s.gameCount > 0 && <Badge variant="primary"><Gamepad2 />{s.gameCount}</Badge>}
        <span className="inline-flex w-28 items-center justify-end gap-1 text-xs whitespace-nowrap text-muted-foreground" title={fmtAbs(s.createdAt)}>
          <Clock className="size-3.5" />{ago(s.createdAt)}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
      </div>
    </button>
  )
}

// ── Detail ──────────────────────────────────────────────────────────────────────

type Section = 'timeline' | 'games'

function HistoryDetailView({ historyId }: { historyId: number }) {
  const { data, error } = useLoad<HistoryDetail>(() => api<HistoryDetail>('/history/' + historyId))
  const [section, setSection] = useState<Section>('timeline')

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorNote>Error: {error}</ErrorNote>
      </div>
    )
  }
  if (!data) return <PageSkeleton rows={3} />

  const s = data.session
  const active = s.endedAt == null
  const people = new Set(data.events.filter(e => e.userId).map(e => e.userId)).size

  return (
    <div className="space-y-5">
      <BackLink />

      <Card className="gap-5">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={active ? 'success' : 'outline'}><StatusDot />{active ? 'Active' : 'Ended'}</Badge>
            <Badge variant="outline">{s.game}</Badge>
            {s.endReason && <Badge variant="secondary">{s.endReason}</Badge>}
          </div>
          <CardTitle className="mt-1 text-xl tracking-tight">{s.name}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Owned by <span className="font-medium text-foreground">{s.ownerName || s.ownerId}</span></span>
            <span aria-hidden>·</span>
            <Mono>{s.partyId}</Mono>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniStat label="Created" value={ago(s.createdAt)} title={fmtAbs(s.createdAt)} />
            <MiniStat label="Ended" value={s.endedAt != null ? ago(s.endedAt) : 'Still running'} title={s.endedAt != null ? fmtAbs(s.endedAt) : undefined} />
            <MiniStat label="People" value={people} />
            <MiniStat label="Games" value={data.games.length} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={section} onValueChange={v => setSection(v as Section)}>
        <TabsList>
          <TabsTrigger value="timeline">Timeline<CountPill n={data.events.length} /></TabsTrigger>
          <TabsTrigger value="games">Games<CountPill n={data.games.length} /></TabsTrigger>
        </TabsList>
        <TabsContent value="timeline"><Timeline events={data.events} /></TabsContent>
        <TabsContent value="games"><GameList games={data.games} /></TabsContent>
      </Tabs>
    </div>
  )
}

function BackLink() {
  return <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={goToList}><ArrowLeft />All sessions</Button>
}

const EVENT_LABEL: Record<HistoryEventKind, string> = {
  created: 'created the party',
  joined: 'joined',
  queued: 'joined the queue',
  left: 'left',
  dequeued: 'left the queue',
  removed: 'was removed',
  promoted: 'was promoted from the queue',
  approved: 'was approved from the queue',
  denied: 'was denied from the queue',
  owner_changed: 'became the owner',
  closed: 'closed the party',
  opened: 'opened the party',
  game_changed: 'changed the game',
  banlist_set: 'updated the banlist',
  disbanded: 'party disbanded',
}

const EVENT_ICON: Record<HistoryEventKind, ReactNode> = {
  created: <PartyPopper />,
  joined: <LogIn />,
  queued: <Hourglass />,
  left: <LogOut />,
  dequeued: <LogOut />,
  removed: <UserMinus />,
  promoted: <ArrowUpFromLine />,
  approved: <UserCheck />,
  denied: <UserX />,
  owner_changed: <Crown />,
  closed: <Lock />,
  opened: <LockOpen />,
  game_changed: <Shuffle />,
  banlist_set: <Ban />,
  disbanded: <Skull />,
}

const EVENT_TONE: Partial<Record<HistoryEventKind, 'success' | 'warning' | 'destructive' | 'primary'>> = {
  joined: 'success', approved: 'success', promoted: 'success',
  left: 'warning', dequeued: 'warning', queued: 'primary', created: 'primary', owner_changed: 'warning',
  removed: 'destructive', denied: 'destructive', disbanded: 'destructive',
}

const TONE_CLASS: Record<string, string> = {
  success: 'bg-success-muted text-success',
  warning: 'bg-warning-muted text-warning',
  destructive: 'bg-danger-muted text-destructive',
  primary: 'bg-primary/10 text-primary',
  default: 'bg-muted text-muted-foreground',
}

function eventDetailText(e: HistoryEvent): string | null {
  const d = e.detail
  if (!d) return null
  if (e.event === 'game_changed' && d.from && d.to) return `${d.from} → ${d.to}`
  if (e.event === 'disbanded' && d.reason) return String(d.reason)
  if (e.event === 'banlist_set' && d.count != null) return `${d.count} champion${d.count === 1 ? '' : 's'}`
  return null
}

function Timeline({ events }: { events: HistoryEvent[] }) {
  if (events.length === 0) {
    return <EmptyState icon={<Clock />} title="No events recorded" />
  }
  return (
    <Card className="py-5">
      <CardContent className="px-5">
        <ol className="relative">
          {events.map((e, i) => {
            const detail = eventDetailText(e)
            const tone = EVENT_TONE[e.event] ?? 'default'
            return (
              <li key={i} className="relative flex gap-3 pb-5 last:pb-0">
                {i < events.length - 1 && <span aria-hidden className="absolute top-8 bottom-0 left-[0.9375rem] w-px bg-border" />}
                <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card [&_svg]:size-3.5', TONE_CLASS[tone])}>
                  {EVENT_ICON[e.event] ?? <CircleDot />}
                </span>
                <div className="min-w-0 flex-1 pt-1">
                  <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
                    {e.displayName && <span className="font-medium">{e.displayName}</span>}
                    <span className={e.displayName ? 'text-muted-foreground' : 'font-medium'}>{EVENT_LABEL[e.event] ?? e.event}</span>
                    {detail && <Badge variant="outline" className="ml-0.5">{detail}</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground" title={fmtAbs(e.ts)}>{ago(e.ts)} · {fmtAbs(e.ts)}</div>
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
