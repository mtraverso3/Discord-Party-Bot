import { ArrowLeft, ChevronRight, Clock, Gamepad2, History as HistoryIcon, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import { fmtAbs, relTime } from '../lib/time'
import { GameList } from '../components/GameList'
import {
  Badge, Card, CardContent, EmptyState, ErrorNote, Input, Mono, Segmented, Spinner, StatusDot,
} from '../components/ui'
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
  if (!data) return <Spinner />
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
      <p className="text-xs text-muted-foreground">
        {rows.length === data.length ? `${data.length} sessions` : `${rows.length} of ${data.length} sessions`}
      </p>
      <div className="space-y-2.5">
        {rows.map(s => <HistoryRow key={s.historyId} session={s} onOpen={() => goToSession(s.historyId)} />)}
      </div>
    </div>
  )
}

function HistoryRow({ session: s, onOpen }: { session: HistorySummary; onOpen: () => void }) {
  const active = s.endedAt == null
  return (
    <Card className="overflow-hidden transition-colors hover:border-primary/40">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={onOpen}
      >
        <Badge variant={active ? 'success' : 'outline'}><StatusDot />{active ? 'Active' : 'Ended'}</Badge>
        <span className="text-sm font-semibold">{s.name}</span>
        <Badge variant="outline">{s.game}</Badge>
        <Badge variant="secondary">{s.participantCount} players</Badge>
        {s.gameCount > 0 && <Badge variant="warning"><Gamepad2 className="size-3" />{s.gameCount}</Badge>}
        <span className="grow" />
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground" title={fmtAbs(s.createdAt)}>
          <Clock className="size-3.5" />{relTime(Date.now() - s.createdAt)} ago
        </span>
        <Mono className="hidden sm:inline">{s.partyId}</Mono>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </Card>
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
  if (!data) return <Spinner />

  const s = data.session
  const active = s.endedAt == null
  const tabs: [Section, string][] = [
    ['timeline', `Timeline (${data.events.length})`],
    ['games', `Games (${data.games.length})`],
  ]

  return (
    <div className="space-y-4">
      <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <button type="button" className="cursor-pointer transition-colors hover:text-foreground" onClick={goToList}>History</button>
        <ChevronRight className="size-3.5" />
        <span className="font-medium text-foreground">{s.name}</span>
      </nav>
      <BackLink />

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={active ? 'success' : 'outline'}><StatusDot />{active ? 'Active' : 'Ended'}</Badge>
            <span className="text-base font-semibold">{s.name}</span>
            <Badge variant="outline">{s.game}</Badge>
            <span className="grow" />
            <Mono>{s.partyId}</Mono>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>Owner: <span className="font-medium text-foreground">{s.ownerName || s.ownerId}</span></span>
            <span title={fmtAbs(s.createdAt)}>Created: <span className="font-medium text-foreground">{relTime(Date.now() - s.createdAt)} ago</span></span>
            {s.endedAt != null && (
              <span title={fmtAbs(s.endedAt)}>
                Ended: <span className="font-medium text-foreground">{relTime(Date.now() - s.endedAt)} ago</span>
                {s.endReason ? ` (${s.endReason})` : ''}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Segmented value={section} onChange={setSection} options={tabs} />
      {section === 'timeline' ? <Timeline events={data.events} /> : <GameList games={data.games} />}
    </div>
  )
}

function BackLink() {
  return (
    <button
      type="button"
      className="-ml-1 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      onClick={goToList}
    >
      <ArrowLeft className="size-4" />Back to history
    </button>
  )
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

const EVENT_TONE: Partial<Record<HistoryEventKind, 'success' | 'warning' | 'destructive' | 'default'>> = {
  joined: 'success', approved: 'success', promoted: 'success',
  left: 'warning', dequeued: 'warning', queued: 'default',
  removed: 'destructive', denied: 'destructive', disbanded: 'destructive',
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
    <ol className="relative space-y-3 border-l pl-5">
      {events.map((e, i) => {
        const detail = eventDetailText(e)
        return (
          <li key={i} className="relative">
            <span className={`absolute top-1.5 -left-[1.44rem] size-2 rounded-full ${
              EVENT_TONE[e.event] === 'success' ? 'bg-success'
              : EVENT_TONE[e.event] === 'destructive' ? 'bg-destructive'
              : EVENT_TONE[e.event] === 'warning' ? 'bg-warning'
              : 'bg-muted-foreground'}`}
            />
            <div className="flex flex-wrap items-baseline gap-x-1.5 text-sm">
              {e.displayName && <span className="font-medium">{e.displayName}</span>}
              <span className={e.displayName ? 'text-muted-foreground' : 'font-medium'}>{EVENT_LABEL[e.event] ?? e.event}</span>
              {detail && <span className="text-xs text-muted-foreground">· {detail}</span>}
            </div>
            <div className="text-xs text-muted-foreground" title={fmtAbs(e.ts)}>{relTime(Date.now() - e.ts)} ago</div>
          </li>
        )
      })}
    </ol>
  )
}
