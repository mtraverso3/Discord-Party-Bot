import {
  ArrowDown, ArrowLeft, ArrowUp, Check, ChevronRight, Crown, Ellipsis, Lock, LockOpen, Megaphone, Moon, Plus,
  RefreshCw, Search, Swords, Timer, Trash2, UserMinus, UserPlus, UserRound, Volume1, Volume2, VolumeX, X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { cn } from '@/lib/utils'
import { defaultGame, gameChoices } from '../games'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Avatar } from '../components/Avatar'
import { GameList } from '../components/GameList'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { ChannelSelect } from '../components/ChannelSelect'
import {
  CheckboxCard, CopyId, CountPill, EmptyState, ErrorNote, Field, GameSelect, MiniStat, Mono, PageSkeleton, SectionLabel,
  SectionSkeleton, StatusDot,
} from '../components/common'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { Progress } from '../components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Switch } from '../components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import { deadlineOf, fmtAbs, relTime } from '../lib/time'
import type { ChannelInfo, GuildSettings, Party, PartyGamesResponse, PartyMember, QueueEntry, VoiceStatus } from '../types'

type SortMode = 'newest' | 'oldest' | 'fullest' | 'expiring'
type Avatars = Record<string, string | null>

const SORTS: [SortMode, string][] = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['fullest', 'Fullest first'],
  ['expiring', 'Expiring soonest'],
]

/** Parse the selected party id out of the hash, e.g. #/parties/<id> → "<id>". */
function selectedPartyId(): string | null {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  const parts = h.split('/')
  return parts[0] === 'parties' && parts[1] ? decodeURIComponent(parts[1]) : null
}

const goToParty = (id: string) => { location.hash = '#/parties/' + encodeURIComponent(id) }
const goToList = () => { location.hash = '#/parties' }

function readPref(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* private mode */ }
}

export function Parties() {
  const guildData = useGuildData()

  const [parties, setParties] = useState<Party[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settings, setSettings] = useState<GuildSettings | null>(null)
  const [voiceChannels, setVoiceChannels] = useState<ChannelInfo[]>([])
  const [textChannels, setTextChannels] = useState<ChannelInfo[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(selectedPartyId)

  const refresh = useCallback(async () => {
    try {
      setParties(await api<Party[]>('/parties'))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    refresh()
    guildData.getSettings().then(setSettings).catch(() => {})
    guildData.getVoiceChannels().then(setVoiceChannels).catch(() => {})
    guildData.getTextChannels().then(setTextChannels).catch(() => {})
  }, [refresh, guildData])

  useEffect(() => {
    const onHash = () => setSelectedId(selectedPartyId())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Most mutation endpoints return the updated party — patch it into the local
  // cache instead of re-fetching every party (one DO round-trip each).
  const applyUpdate = useCallback((p: Party | null) => {
    if (!p || !p.id) { refresh(); return }
    setParties(ps => {
      if (!ps) return ps
      const i = ps.findIndex(x => x.id === p.id)
      if (i === -1) return [...ps, p]
      const next = ps.slice()
      next[i] = p
      return next
    })
  }, [refresh])

  const removeLocal = useCallback((id: string) => {
    setParties(ps => ps ? ps.filter(p => p.id !== id) : ps)
  }, [])

  if (error && !parties) return <ErrorNote>Error: {error}</ErrorNote>
  if (!parties) return <PageSkeleton />

  if (selectedId) {
    const party = parties.find(p => p.id === selectedId)
    if (!party) {
      return (
        <div className="space-y-4">
          <BackButton />
          <EmptyState icon={<Swords />} title="Party not found">
            It may have been disbanded. Go back to the list to see current parties.
          </EmptyState>
        </div>
      )
    }
    return (
      <PartyDetail
        party={party}
        voiceChannels={voiceChannels}
        onUpdate={applyUpdate}
        onRemove={id => { removeLocal(id); goToList() }}
      />
    )
  }

  return (
    <PartyList
      parties={parties}
      settings={settings}
      voiceChannels={voiceChannels}
      textChannels={textChannels}
      onRefresh={refresh}
      onUpdate={applyUpdate}
      setParties={setParties}
    />
  )
}

function BackButton() {
  return <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={goToList}><ArrowLeft />All parties</Button>
}

// ── List view ─────────────────────────────────────────────────────────────────

function PartyList({ parties, settings, voiceChannels, textChannels, onRefresh, onUpdate, setParties }: {
  parties: Party[]
  settings: GuildSettings | null
  voiceChannels: ChannelInfo[]
  textChannels: ChannelInfo[]
  onRefresh: () => void
  onUpdate: (p: Party) => void
  setParties: (fn: (ps: Party[] | null) => Party[] | null) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortMode>(() => (readPref('pb-sort') as SortMode) || 'newest')
  const [auto, setAuto] = useState(() => readPref('pb-autorefresh') === '1')
  const [showCreate, setShowCreate] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!auto) return
    const t = setInterval(() => {
      api<Party[]>('/parties').then(ps => setParties(() => ps)).catch(() => {})
    }, 10000)
    return () => clearInterval(t)
  }, [auto, setParties])

  const filtered = applyFilterSort(parties, query, sort)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="pl-8"
            placeholder="Filter by name, game, or ID"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <Select value={sort} onValueChange={v => { setSort(v as SortMode); writePref('pb-sort', v) }}>
          <SelectTrigger className="w-44" aria-label="Sort parties"><SelectValue /></SelectTrigger>
          <SelectContent>
            {SORTS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <label
          className="flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm text-muted-foreground shadow-xs dark:bg-input/30"
          title="Refresh the list every 10 seconds"
        >
          <Switch checked={auto} onCheckedChange={v => { setAuto(v); writePref('pb-autorefresh', v ? '1' : '0') }} />
          Auto-refresh
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh"
              onClick={async () => { setRefreshing(true); await onRefresh(); setRefreshing(false) }}
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="More actions"><Ellipsis /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              variant="destructive"
              onSelect={async () => {
                if (!(await confirm('Disband ALL parties in this guild? This cannot be undone.', 'Disband all'))) return
                try {
                  await api('/clear', { method: 'POST' })
                  toast('Cleared')
                  onRefresh()
                } catch (e) { toast((e as Error).message, 'err') }
              }}
            >
              <Trash2 />Disband all parties…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button onClick={() => setShowCreate(true)}><Plus />New party</Button>
      </div>

      <CreateDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        settings={settings}
        voiceChannels={voiceChannels}
        textChannels={textChannels}
        onCreated={p => { onUpdate(p); setShowCreate(false); goToParty(p.id) }}
      />

      {parties.length === 0 ? (
        <EmptyState
          icon={<Swords />}
          title="No active parties"
          action={<Button size="sm" onClick={() => setShowCreate(true)}><Plus />New party</Button>}
        >
          Parties members create in Discord show up here. You can also create one on a member's behalf.
        </EmptyState>
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            <span>
              {filtered.length === parties.length
                ? `${parties.length} ${parties.length === 1 ? 'party' : 'parties'}`
                : `${filtered.length} of ${parties.length} parties`}
            </span>
            <span className="hidden sm:inline">Roster · Auto-disband</span>
          </div>
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">No parties match “{query}”.</p>
          ) : (
            <div className="divide-y">
              {filtered.map(p => <PartyListRow key={p.id} party={p} onOpen={() => goToParty(p.id)} />)}
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function PartyListRow({ party: p, onOpen }: { party: Party; onOpen: () => void }) {
  const deadline = deadlineOf(p)
  const now = Date.now()
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'
  const status = statusOf(p)
  const pct = p.maxSize > 0 ? Math.min(100, (p.members.length / p.maxSize) * 100) : 0

  return (
    <button
      type="button"
      className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none"
      onClick={onOpen}
    >
      <div className="flex min-w-0 flex-1 basis-60 items-center gap-3">
        <Badge variant={status.variant} className="w-16 justify-center"><StatusDot />{status.label}</Badge>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.name}</div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{p.game}</span>
            <span>·</span>
            <Mono>{p.id}</Mono>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex w-32 items-center gap-2">
          <Progress value={pct} className="h-1.5" indicatorClassName={pct >= 100 ? 'bg-warning' : undefined} />
          <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{p.members.length}/{p.maxSize}</span>
        </div>
        <span className="w-20">
          {p.queue.length > 0 && <Badge variant="warning">{p.queue.length} queued</Badge>}
        </span>
        <span
          className="inline-flex w-24 items-center gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          title={'Auto-disband ' + fmtAbs(deadline)}
        >
          <Timer className="size-3.5" />{dueLabel}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-muted-foreground" />
      </div>
    </button>
  )
}

function applyFilterSort(parties: Party[], query: string, sort: SortMode): Party[] {
  let out = parties.slice()
  const q = query.trim().toLowerCase()
  if (q) {
    out = out.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.game.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q))
  }
  if (sort === 'newest') out.sort((a, b) => b.createdAt - a.createdAt)
  else if (sort === 'oldest') out.sort((a, b) => a.createdAt - b.createdAt)
  else if (sort === 'fullest') out.sort((a, b) => (b.members.length / b.maxSize) - (a.members.length / a.maxSize))
  else if (sort === 'expiring') out.sort((a, b) => deadlineOf(a) - deadlineOf(b))
  return out
}

function statusOf(p: Party): { variant: 'destructive' | 'warning' | 'success'; label: string } {
  return p.isClosed
    ? { variant: 'destructive', label: 'Closed' }
    : p.members.length >= p.maxSize
      ? { variant: 'warning', label: 'Full' }
      : { variant: 'success', label: 'Open' }
}

// ── Create dialog ────────────────────────────────────────────────────────────

function CreateDialog({ open, onOpenChange, ...rest }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  settings: GuildSettings | null
  voiceChannels: ChannelInfo[]
  textChannels: ChannelInfo[]
  onCreated: (p: Party) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New party</DialogTitle>
          <DialogDescription>Create a party on a member's behalf. The bot posts its embed in the channel you pick.</DialogDescription>
        </DialogHeader>
        {/* Remounting on open resets the form each time. */}
        {open && <CreateForm {...rest} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CreateForm({ settings, voiceChannels, textChannels, onCreated, onCancel }: {
  settings: GuildSettings | null
  voiceChannels: ChannelInfo[]
  textChannels: ChannelInfo[]
  onCreated: (p: Party) => void
  onCancel: () => void
}) {
  const toast = useToast()
  const s = settings || { defaultCap: 10 }
  const allowed = gameChoices(settings)
  const ownerPicker = useRef<UserPickerHandle>(null)

  const [name, setName] = useState('')
  const [game, setGame] = useState(() => defaultGame(settings))
  const [cap, setCap] = useState(s.defaultCap)
  const [channel, setChannel] = useState('')
  const [voice, setVoice] = useState('')
  const [desc, setDesc] = useState('')
  const [rules, setRules] = useState(false)
  const [rulesAvailable, setRulesAvailable] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<{ enabled: boolean; defaultRequired: boolean }>('/rules/status')
      .then(r => { setRulesAvailable(r.enabled); setRules(r.defaultRequired) })
      .catch(() => setRulesAvailable(false))
  }, [])

  const submit = async () => {
    const ownerId = ownerPicker.current?.getId()
    if (!ownerId) return toast('Pick an owner from the list or paste a user ID.', 'err')
    setBusy(true)
    try {
      const p = await api<Party>('/parties', {
        method: 'POST',
        body: JSON.stringify({
          ownerId,
          name,
          game,
          maxSize: Number(cap),
          channelId: channel || textChannels[0]?.id,
          voiceChannelId: voice || undefined,
          description: desc,
          rulesRequired: rules,
        }),
      })
      toast('Party created')
      onCreated(p)
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-5" onSubmit={e => { e.preventDefault(); if (!busy) submit() }}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Owner"><UserPicker ref={ownerPicker} placeholder="Search by name, or paste an ID" /></Field>
        <Field label="Name"><Input value={name} placeholder={'Defaults to "<owner>\'s party"'} maxLength={100} onChange={e => setName(e.target.value)} /></Field>
        <Field label="Game"><GameSelect value={game} onChange={setGame} games={allowed} /></Field>
        <Field label="Player cap"><Input type="number" min={2} max={50} value={cap} onChange={e => setCap(Number(e.target.value))} /></Field>
        <Field label="Post embed in">
          <ChannelSelect channels={textChannels} value={channel || textChannels[0]?.id || ''} onChange={setChannel} />
        </Field>
        <Field label="Voice channel">
          <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Textarea value={desc} placeholder="Optional" onChange={e => setDesc(e.target.value)} />
        </Field>
        {rulesAvailable && (
          <CheckboxCard
            className="sm:col-span-2"
            checked={rules}
            onCheckedChange={setRules}
            title="Require the rules check"
            description="Only members who have passed can join this party."
          />
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" busy={busy}>{busy ? 'Creating…' : 'Create party'}</Button>
      </DialogFooter>
    </form>
  )
}

// ── Detail page ──────────────────────────────────────────────────────────────

type Section = 'people' | 'settings' | 'banlist' | 'games'

function PartyDetail({ party: p, voiceChannels, onUpdate, onRemove }: {
  party: Party
  voiceChannels: ChannelInfo[]
  onUpdate: (p: Party | null) => void
  onRemove: (id: string) => void
}) {
  const toast = useToast()
  const [section, setSection] = useState<Section>('people')
  const [avatars, setAvatars] = useState<Avatars>({})

  // Resolve Discord avatars for everyone shown on this page. The endpoint is
  // 6h-cached server-side, so re-fetching as the roster changes stays cheap.
  const ids = [...p.members.map(m => m.userId), ...p.queue.map(q => q.userId)].join(',')
  useEffect(() => {
    let alive = true
    if (!ids) { setAvatars({}); return }
    api<Avatars>('/members/avatars?ids=' + encodeURIComponent(ids))
      .then(a => { if (alive) setAvatars(prev => ({ ...prev, ...a })) })
      .catch(() => {})
    return () => { alive = false }
  }, [ids])

  const act = async (fn: () => Promise<Party>, okMsg: string) => {
    try {
      onUpdate(await fn())
      toast(okMsg)
    } catch (e) { toast((e as Error).message, 'err') }
  }

  const deadline = deadlineOf(p)
  const last = p.lastActivityAt ?? p.createdAt
  const now = Date.now()
  const dueLabel = deadline > now ? 'in ' + relTime(deadline - now) : 'overdue'
  const lastLabel = last <= now ? relTime(now - last) + (relTime(now - last) === 'just now' ? '' : ' ago') : 'just now'
  const status = statusOf(p)
  const owner = p.members.find(m => m.userId === p.ownerId)

  return (
    <div className="space-y-5">
      <BackButton />

      <Card className="gap-5">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.variant}><StatusDot />{status.label}</Badge>
            <Badge variant="outline">{p.game}</Badge>
            {p.rulesRequired && <Badge variant="primary">Rules check</Badge>}
          </div>
          <CardTitle className="mt-1 text-xl tracking-tight">{p.name}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>Owned by <span className="font-medium text-foreground">{owner?.displayName ?? p.ownerName}</span></span>
            <span aria-hidden>·</span>
            <CopyId id={p.id} />
          </CardDescription>
          <CardAction className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => act(() => api<Party>('/parties/' + p.id + '/bump', { method: 'POST', body: JSON.stringify({}) }), 'Bumped')}
            >
              <Megaphone /><span className="hidden sm:inline">Bump embed</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => act(
                () => api<Party>('/parties/' + p.id + (p.isClosed ? '/open' : '/close'), { method: 'POST' }),
                p.isClosed ? 'Opened' : 'Closed',
              )}
            >
              {p.isClosed ? <LockOpen /> : <Lock />}
              <span className="hidden sm:inline">{p.isClosed ? 'Open party' : 'Close party'}</span>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-4">
          {p.description && <p className="text-sm whitespace-pre-line text-muted-foreground">{p.description}</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
              <div className="text-xs text-muted-foreground">Roster</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{p.members.length}<span className="text-sm font-normal text-muted-foreground"> / {p.maxSize}</span></div>
              <Progress value={Math.min(100, (p.members.length / p.maxSize) * 100)} className="mt-1.5 h-1" />
            </div>
            <MiniStat label="Queue" value={p.queue.length} />
            <MiniStat label="Last activity" value={lastLabel} title={fmtAbs(last)} />
            <MiniStat label="Auto-disband" value={dueLabel} title={fmtAbs(deadline)} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={section} onValueChange={v => setSection(v as Section)}>
        <TabsList>
          <TabsTrigger value="people">People<CountPill n={p.members.length + p.queue.length} /></TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="banlist">Banlist{p.banlist && <CountPill n={p.banlist.source.length} />}</TabsTrigger>
          <TabsTrigger value="games">Games</TabsTrigger>
        </TabsList>
        <TabsContent value="people"><PeopleSection p={p} avatars={avatars} onUpdate={onUpdate} /></TabsContent>
        <TabsContent value="settings"><SettingsSection p={p} voiceChannels={voiceChannels} onUpdate={onUpdate} onRemove={onRemove} /></TabsContent>
        <TabsContent value="banlist"><BanlistSection p={p} onUpdate={onUpdate} /></TabsContent>
        <TabsContent value="games"><GamesSection partyId={p.id} /></TabsContent>
      </Tabs>
    </div>
  )
}

function GamesSection({ partyId }: { partyId: string }) {
  const [data, setData] = useState<PartyGamesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<PartyGamesResponse>('/parties/' + partyId + '/games')
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError((e as Error).message) })
    return () => { alive = false }
  }, [partyId])

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!data) return <SectionSkeleton />
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        League games party members reported through the desktop client. Champions fill in once each match finishes.
      </p>
      <GameList games={data.games} />
    </div>
  )
}

function PeopleSection({ p, avatars, onUpdate }: { p: Party; avatars: Avatars; onUpdate: (p: Party | null) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const addPicker = useRef<UserPickerHandle>(null)
  const [voice, setVoice] = useState<VoiceStatus | null>(null)
  const [voiceBusy, setVoiceBusy] = useState(false)

  const call = async (fn: () => Promise<Party>, okMsg: string) => {
    try {
      onUpdate(await fn())
      toast(okMsg)
    } catch (e) { toast((e as Error).message, 'err') }
  }

  const checkVoice = async () => {
    setVoiceBusy(true)
    try {
      setVoice(await api<VoiceStatus>('/parties/' + p.id + '/voice'))
    } catch (e) { toast((e as Error).message, 'err') }
    setVoiceBusy(false)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="space-y-4">
        <Card className="gap-0 py-0">
          <CardHeader className="border-b py-4 [.border-b]:pb-4">
            <CardTitle className="text-sm">Members</CardTitle>
            <CardDescription>{p.members.length} of {p.maxSize} spots taken</CardDescription>
          </CardHeader>
          <div className="divide-y">
            {p.members.map(m => (
              <MemberRow
                key={m.userId}
                p={p}
                m={m}
                avatarUrl={avatars[m.userId]}
                onPromote={() => call(() => api<Party>(`/parties/${p.id}/members/${m.userId}/promote`, { method: 'POST' }), 'Promoted')}
                onRemove={() => call(() => api<Party>(`/parties/${p.id}/members/${m.userId}`, { method: 'DELETE' }), 'Removed')}
                confirmPromote={() => confirm(`Promote ${m.displayName} to owner of "${p.name}"?`, 'Promote')}
              />
            ))}
          </div>
          <CardFooter className="border-t py-3 [.border-t]:pt-3">
            <form
              className="flex w-full gap-2"
              onSubmit={async e => {
                e.preventDefault()
                const userId = addPicker.current?.getId()
                if (!userId) return toast('Pick a member from the list or paste a user ID.', 'err')
                await call(() => api<Party>(`/parties/${p.id}/members`, {
                  method: 'POST', body: JSON.stringify({ userId }),
                }), 'Added')
                addPicker.current?.clear()
              }}
            >
              <UserPicker ref={addPicker} className="flex-1" placeholder="Add a member — search by name or paste an ID" />
              <Button type="submit" variant="secondary"><UserPlus />Add</Button>
            </form>
          </CardFooter>
        </Card>

        {p.queue.length > 0 && (
          <Card className="gap-0 py-0">
            <CardHeader className="border-b py-4 [.border-b]:pb-4">
              <CardTitle className="text-sm">Queue</CardTitle>
              <CardDescription>{p.queue.length} waiting — approve to admit them, in order.</CardDescription>
            </CardHeader>
            <div className="divide-y">
              {p.queue.map((q, i) => (
                <QueueRow
                  key={q.userId}
                  p={p}
                  q={q}
                  idx={i}
                  avatarUrl={avatars[q.userId]}
                  onMove={dir => call(() => api<Party>(`/parties/${p.id}/queue/${q.userId}/move`, {
                    method: 'POST', body: JSON.stringify({ direction: dir }),
                  }), 'Moved')}
                  onApprove={() => call(() => api<Party>(`/parties/${p.id}/members/${q.userId}/approve`, { method: 'POST' }), 'Approved')}
                  onDeny={() => call(() => api<Party>(`/parties/${p.id}/queue/${q.userId}`, { method: 'DELETE' }), 'Denied')}
                />
              ))}
            </div>
          </Card>
        )}
      </div>

      <Card className="h-fit gap-4">
        <CardHeader>
          <CardTitle className="text-sm">Voice</CardTitle>
          <CardDescription>See which members are in the linked voice channel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" size="sm" className="w-full" busy={voiceBusy} onClick={checkVoice}>
            {!voiceBusy && <Volume2 />}Check voice
          </Button>
          {voice && <VoiceReport voice={voice} members={p.members} />}
        </CardContent>
      </Card>
    </div>
  )
}

/** Structured breakdown of where each party member is in voice. */
function VoiceReport({ voice, members }: { voice: VoiceStatus; members: PartyMember[] }) {
  const nameOf = (id: string) => members.find(x => x.userId === id)?.displayName ?? id
  const inLinked = voice.states.filter(s => voice.voiceChannelId && s.channelId === voice.voiceChannelId)
  const elsewhere = voice.states.filter(s => s.channelId && s.channelId !== voice.voiceChannelId)
  const notInVoice = voice.states.filter(s => !s.channelId)

  const groups: { key: string; icon: ReactNode; label: string; ids: string[]; tone: string }[] = [
    { key: 'linked', icon: <Volume2 />, label: voice.voiceChannelId ? 'In linked voice' : 'In voice', ids: (voice.voiceChannelId ? inLinked : elsewhere).map(s => s.userId), tone: 'text-success' },
    ...(voice.voiceChannelId ? [{ key: 'elsewhere', icon: <Volume1 />, label: 'In another channel', ids: elsewhere.map(s => s.userId), tone: 'text-warning' }] : []),
    { key: 'none', icon: <VolumeX />, label: 'Not in voice', ids: notInVoice.map(s => s.userId), tone: 'text-muted-foreground' },
  ]
  const total = voice.states.length

  return (
    <div className="divide-y rounded-lg border text-sm">
      {groups.map(g => (
        <div key={g.key} className="flex items-start gap-2.5 px-3 py-2.5">
          <span className={cn('mt-0.5 shrink-0 [&_svg]:size-4', g.tone)}>{g.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-1.5">
              <span className="font-medium">{g.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{g.ids.length}/{total}</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {g.ids.length ? g.ids.map(nameOf).join(', ') : '—'}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function PersonCell({ name, username, userId, ign, avatarUrl, badges }: {
  name: string
  username: string
  userId: string
  ign?: string
  avatarUrl?: string | null
  badges?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <Avatar name={name} imageUrl={avatarUrl} className="size-9" />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-sm">
          <span className="truncate font-medium">{name}</span>
          {badges}
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="truncate">@{username}</span>
          {ign && <><span aria-hidden>·</span><span className="truncate">{ign}</span></>}
          <span aria-hidden className="hidden md:inline">·</span>
          <Mono className="hidden md:inline">{userId}</Mono>
        </div>
      </div>
    </div>
  )
}

function MemberRow({ p, m, avatarUrl, onPromote, onRemove, confirmPromote }: {
  p: Party
  m: PartyMember
  avatarUrl?: string | null
  onPromote: () => void
  onRemove: () => void
  confirmPromote: () => Promise<boolean>
}) {
  const isOwner = m.userId === p.ownerId
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30">
      <PersonCell
        name={m.displayName}
        username={m.username}
        userId={m.userId}
        ign={m.ign}
        avatarUrl={avatarUrl}
        badges={<>
          {isOwner && <Badge variant="warning" className="px-1.5"><Crown />Owner</Badge>}
          {m.away && (
            <Tooltip>
              <TooltipTrigger asChild><Moon className="size-3.5 text-muted-foreground" aria-label="Marked as away (BRB)" /></TooltipTrigger>
              <TooltipContent>Marked as away (BRB)</TooltipContent>
            </Tooltip>
          )}
        </>}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${m.displayName}`}><Ellipsis /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => { location.hash = '#/users/' + encodeURIComponent(m.userId) }}>
            <UserRound />View profile
          </DropdownMenuItem>
          {!isOwner && (
            <>
              <DropdownMenuItem onSelect={async () => { if (await confirmPromote()) onPromote() }}>
                <Crown />Promote to owner
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                <UserMinus />Remove from party
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function QueueRow({ p, q, idx, avatarUrl, onMove, onApprove, onDeny }: {
  p: Party
  q: QueueEntry
  idx: number
  avatarUrl?: string | null
  onMove: (dir: 'up' | 'down') => void
  onApprove: () => void
  onDeny: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/30">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground tabular-nums">{idx + 1}</span>
      <PersonCell name={q.displayName} username={q.username} userId={q.userId} ign={q.ign} avatarUrl={avatarUrl} />
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={idx === 0} onClick={() => onMove('up')}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={idx === p.queue.length - 1} onClick={() => onMove('down')}><ArrowDown /></Button>
        <Button variant="outline" size="sm" className="ml-1" onClick={onApprove}><Check />Approve</Button>
        <Button variant="destructive-outline" size="sm" onClick={onDeny}><X />Deny</Button>
      </div>
    </div>
  )
}

function SettingsSection({ p, voiceChannels, onUpdate, onRemove }: {
  p: Party
  voiceChannels: ChannelInfo[]
  onUpdate: (p: Party | null) => void
  onRemove: (id: string) => void
}) {
  const toast = useToast()
  const confirm = useConfirm()
  const guildData = useGuildData()
  const { data: settings } = useLoad(() => guildData.getSettings())
  const [name, setName] = useState(p.name)
  const [cap, setCap] = useState(p.maxSize)
  const [game, setGame] = useState(p.game)
  const [voice, setVoice] = useState(p.voiceChannelId || '')
  const [desc, setDesc] = useState(p.description || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      onUpdate(await api<Party>('/parties/' + p.id, {
        method: 'PATCH',
        body: JSON.stringify({ name, description: desc, maxSize: Number(cap), game, voiceChannelId: voice }),
      }))
      toast('Saved')
    } catch (e) { toast((e as Error).message, 'err') } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Party details</CardTitle>
          <CardDescription>Changes update the Discord embed once saved.</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="party-settings" className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save() }}>
            <Field label="Name"><Input value={name} required maxLength={100} onChange={e => setName(e.target.value)} /></Field>
            <Field label="Player cap"><Input type="number" min={2} max={50} required value={cap} onChange={e => setCap(Number(e.target.value))} /></Field>
            <Field label="Game"><GameSelect value={game} onChange={setGame} games={gameChoices(settings, p.game)} /></Field>
            <Field label="Voice channel">
              <ChannelSelect channels={voiceChannels} value={voice} onChange={setVoice} allowNone />
            </Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={desc} onChange={e => setDesc(e.target.value)} /></Field>
          </form>
        </CardContent>
        <CardFooter className="justify-end border-t [.border-t]:pt-5">
          <Button type="submit" form="party-settings" busy={saving}>Save changes</Button>
        </CardFooter>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="text-sm">Disband party</CardTitle>
          <CardDescription>Members are released and the embed is marked disbanded. This can't be undone.</CardDescription>
          <CardAction>
            <Button
              variant="destructive"
              size="sm"
              onClick={async () => {
                if (!(await confirm(`Disband "${p.name}"? Members will be released and the embed marked disbanded.`, 'Disband'))) return
                try {
                  await api('/parties/' + p.id, { method: 'DELETE' })
                  onRemove(p.id)
                  toast('Disbanded')
                } catch (e) { toast((e as Error).message, 'err') }
              }}
            >
              <Trash2 />Disband…
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  )
}

function BanlistSection({ p, onUpdate }: { p: Party; onUpdate: (p: Party | null) => void }) {
  const toast = useToast()
  const [text, setText] = useState(p.banlist?.source.join('\n') ?? '')

  const save = async (value: string) => {
    try {
      onUpdate(await api<Party>('/parties/' + p.id + '/banlist', {
        method: 'PATCH', body: JSON.stringify({ banlist: value }),
      }))
      toast(value ? 'Banlist saved' : 'Cleared')
    } catch (e) { toast((e as Error).message, 'err') }
  }

  const assignments = p.banlist ? Object.entries(p.banlist.assignments) : []
  const nameOf = (id: string) => p.members.find(m => m.userId === id)?.displayName ?? id

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Champion banlist</CardTitle>
          <CardDescription>Members are assigned one ban each, in paste order. Freed bans recycle to the next joiner.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            className="min-h-48 font-mono text-xs"
            placeholder="One champion per line — assigned to members in order"
            value={text}
            onChange={e => setText(e.target.value)}
          />
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button variant="outline" onClick={() => { setText(''); save('') }}>Clear</Button>
          <Button onClick={() => save(text)}>Save banlist</Button>
        </CardFooter>
      </Card>
      <Card className="h-fit gap-3">
        <CardHeader>
          <CardTitle className="text-sm">Current assignments</CardTitle>
        </CardHeader>
        <CardContent>
          {assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bans assigned yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {assignments.map(([uid, champ]) => (
                <li key={uid} className="flex items-center justify-between gap-2">
                  <span className="truncate">{nameOf(uid)}</span>
                  <Badge variant="destructive">{champ}</Badge>
                </li>
              ))}
            </ul>
          )}
          {p.banlist && p.banlist.pool.length > 0 && (
            <div className="mt-4 space-y-1.5">
              <SectionLabel>Unassigned</SectionLabel>
              <div className="flex flex-wrap gap-1">
                {p.banlist.pool.map(c => <Badge key={c} variant="outline">{c}</Badge>)}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
