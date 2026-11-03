import {
  ArrowLeft, ChevronRight, Clock, Crown, Gamepad2, NotebookPen, Pencil, Search, Swords, Trash2, TriangleAlert, UserSearch, UserX,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { allGames } from '../games'
import { useGuildData } from '../lib/guildData'
import { fmtAbs, relTime } from '../lib/time'
import { useLoad } from '../lib/useLoad'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Avatar } from '../components/Avatar'
import { GameList } from '../components/GameList'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { CopyId, CountPill, EmptyState, ErrorNote, MiniStat, Mono, PageSkeleton, SectionSkeleton, StatusDot } from '../components/common'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import type { PartyGame, UserHistorySession, UserLookup, UserNote } from '../types'

/** Parse #/users/<id> → the user ID, or null on the search route. */
function selectedUserId(): string | null {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  const parts = h.split('/')
  if (parts[0] !== 'users' || !parts[1]) return null
  return decodeURIComponent(parts[1])
}

const goToUser = (id: string) => { location.hash = '#/users/' + encodeURIComponent(id) }
const goToSearch = () => { location.hash = '#/users' }

const ago = (ts: number) => {
  const r = relTime(Date.now() - ts)
  return r === 'just now' ? r : r + ' ago'
}

export function Users() {
  const [userId, setUserId] = useState<string | null>(selectedUserId)

  useEffect(() => {
    const onHash = () => setUserId(selectedUserId())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Keying by userId remounts the profile (and its loaders) on navigation.
  return userId != null ? <UserProfile key={userId} userId={userId} /> : <SearchView />
}

// ── Search ──────────────────────────────────────────────────────────────────────

function SearchView() {
  const toast = useToast()
  const picker = useRef<UserPickerHandle>(null)
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader className="items-center text-center">
        <div className="mx-auto mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserSearch className="size-5" />
        </div>
        <CardTitle>Find a member</CardTitle>
        <CardDescription>Search by display name or username, or paste a Discord user ID.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            const id = picker.current?.getId()
            if (id) goToUser(id)
            else toast('Pick a member from the list or paste a user ID.', 'err')
          }}
        >
          <UserPicker ref={picker} className="flex-1" placeholder="Search member by name, or paste an ID" onPick={u => goToUser(u.id)} />
          <Button type="submit"><Search />Look up</Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Profile ──────────────────────────────────────────────────────────────────────

type Section = 'notes' | 'history' | 'games'

function UserProfile({ userId }: { userId: string }) {
  const { data: lookup, error } = useLoad<UserLookup>(() => api<UserLookup>('/users/' + encodeURIComponent(userId)))
  const { data: history } = useLoad<UserHistorySession[]>(() => api<UserHistorySession[]>('/users/' + encodeURIComponent(userId) + '/history'))
  const { data: games } = useLoad<PartyGame[]>(() => api<PartyGame[]>('/users/' + encodeURIComponent(userId) + '/games'))
  const [avatar, setAvatar] = useState<string | null>(null)
  const [section, setSection] = useState<Section>('notes')

  useEffect(() => {
    api<Record<string, string | null>>('/members/avatars?ids=' + encodeURIComponent(userId))
      .then(m => setAvatar(m[userId] ?? null))
      .catch(() => { /* fall back to initials */ })
  }, [userId])

  if (error) {
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorNote>Error: {error}</ErrorNote>
      </div>
    )
  }
  if (!lookup) return <PageSkeleton rows={3} />

  return (
    <div className="space-y-5">
      <BackLink />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Overview u={lookup} avatar={avatar} history={history} gamesCount={games?.length ?? null} />
        <IgnCard u={lookup} />
      </div>
      <Tabs value={section} onValueChange={v => setSection(v as Section)}>
        <TabsList>
          <TabsTrigger value="notes">Notes</TabsTrigger>
          <TabsTrigger value="history">Party history{history && <CountPill n={history.length} />}</TabsTrigger>
          <TabsTrigger value="games">Games{games && <CountPill n={games.length} />}</TabsTrigger>
        </TabsList>
        <TabsContent value="notes"><NotesCard userId={userId} /></TabsContent>
        <TabsContent value="history"><HistorySection sessions={history} /></TabsContent>
        <TabsContent value="games">{games ? <GameList games={games} /> : <SectionSkeleton />}</TabsContent>
      </Tabs>
    </div>
  )
}

function BackLink() {
  return <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={goToSearch}><ArrowLeft />Look up another member</Button>
}

// ── Overview ──────────────────────────────────────────────────────────────────────

function Overview({ u, avatar, history, gamesCount }: {
  u: UserLookup
  avatar: string | null
  history: UserHistorySession[] | null
  gamesCount: number | null
}) {
  const name = u.member?.displayName ?? 'Unknown member'

  const joined = history?.length ?? null
  const owned = history ? history.filter(s => s.wasOwner).length : null
  const firstSeen = history && history.length ? Math.min(...history.map(s => s.firstSeenAt)) : null
  const lastSeen = history && history.length ? Math.max(...history.map(s => s.lastSeenAt)) : null

  return (
    <Card className="gap-5">
      <CardHeader className="flex items-center gap-4">
        <Avatar name={name} imageUrl={avatar} className="size-14 text-lg ring-4 ring-primary/10" />
        <div className="min-w-0 flex-1 space-y-1">
          {u.member ? (
            <CardTitle className="text-xl tracking-tight">
              {u.member.displayName}{' '}
              <span className="text-base font-normal text-muted-foreground">@{u.member.username}</span>
            </CardTitle>
          ) : (
            <Badge variant="warning"><UserX />Not a member of this guild</Badge>
          )}
          <CopyId id={u.userId} label="User ID" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <PartyState u={u} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="Parties joined" value={joined} />
          <MiniStat label="Parties owned" value={owned} />
          <MiniStat label="Games played" value={gamesCount} />
          <MiniStat label="First seen" value={firstSeen != null ? ago(firstSeen) : '—'} title={firstSeen != null ? fmtAbs(firstSeen) : undefined} />
        </div>
        {lastSeen != null && (
          <p className="text-xs text-muted-foreground" title={fmtAbs(lastSeen)}>
            Last active in a party {ago(lastSeen)}.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function PartyState({ u }: { u: UserLookup }) {
  const toast = useToast()
  if (!u.partyId) {
    return <div className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">Not in any party right now.</div>
  }
  if (u.inParty) {
    return (
      <a
        href={'#/parties/' + encodeURIComponent(u.partyId)}
        className="group flex items-center gap-3 rounded-lg border border-success/30 bg-success-muted/50 px-3 py-2.5 text-sm transition-colors hover:bg-success-muted"
      >
        <Swords className="size-4 text-success" />
        <span className="flex-1">Currently in party <span className="font-mono font-semibold">{u.partyId}</span></span>
        <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </a>
    )
  }
  return (
    <Alert className="border-warning/40 bg-warning-muted/50">
      <TriangleAlert className="text-warning" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-foreground">
        <span>Stale mapping → party <span className="font-mono">{u.partyId}</span>{u.partyExists ? ' (not a member)' : ' (party gone)'}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await api('/users/' + u.userId + '/unstick', { method: 'POST' })
              toast('Mapping cleared')
            } catch (e) { toast((e as Error).message, 'err') }
          }}
        >
          Clear mapping
        </Button>
      </AlertDescription>
    </Alert>
  )
}

// ── IGNs ──────────────────────────────────────────────────────────────────────

function IgnCard({ u }: { u: UserLookup }) {
  const guildData = useGuildData()
  const { data: settings } = useLoad(() => guildData.getSettings())
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="text-sm">In-game names</CardTitle>
        <CardDescription>Auto-filled when they create or join a party.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {allGames(settings).map(g => <IgnRow key={g} game={g} userId={u.userId} initial={u.profile.igns[g] || ''} />)}
      </CardContent>
    </Card>
  )
}

function IgnRow({ game, userId, initial }: { game: string; userId: string; initial: string }) {
  const toast = useToast()
  const [value, setValue] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const dirty = value !== saved
  return (
    <form
      className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2"
      onSubmit={async e => {
        e.preventDefault()
        try {
          await api('/users/' + userId + '/profile', {
            method: 'PATCH',
            body: JSON.stringify({ game, ign: value }),
          })
          setSaved(value)
          toast(value.trim() ? 'IGN saved' : 'IGN cleared')
        } catch (err) { toast((err as Error).message, 'err') }
      }}
    >
      <span className="truncate text-xs font-medium text-muted-foreground" title={game}>{game}</span>
      <Input className="h-8" value={value} placeholder="Not set" maxLength={100} onChange={e => setValue(e.target.value)} />
      <Button type="submit" variant={dirty ? 'default' : 'ghost'} size="sm" disabled={!dirty}>Save</Button>
    </form>
  )
}

// ── Notes ──────────────────────────────────────────────────────────────────────

function NotesCard({ userId }: { userId: string }) {
  const toast = useToast()
  const { data, error, reload } = useLoad<UserNote[]>(() => api<UserNote[]>('/users/' + encodeURIComponent(userId) + '/notes'))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    try {
      await api('/users/' + userId + '/notes', { method: 'POST', body: JSON.stringify({ body }) })
      setDraft('')
      await reload()
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="space-y-3">
      <Card className="gap-3 py-4">
        <CardContent className="px-4">
          <Textarea
            value={draft}
            maxLength={2000}
            className="min-h-20 border-0 px-0 shadow-none focus-visible:ring-0 dark:bg-transparent"
            placeholder="Add a note about this member — visible to admins of this server only."
            onChange={e => setDraft(e.target.value)}
          />
        </CardContent>
        <CardFooter className="justify-end px-4">
          <Button size="sm" busy={busy} disabled={!draft.trim()} onClick={add}><NotebookPen />Add note</Button>
        </CardFooter>
      </Card>

      {error && <ErrorNote>Error: {error}</ErrorNote>}
      {!data && !error && <SectionSkeleton rows={2} />}
      {data && data.length === 0 && (
        <EmptyState icon={<NotebookPen />} title="No notes yet">
          Jot down anything worth remembering about this member — alt accounts, roles they prefer, warnings.
        </EmptyState>
      )}
      {data && data.map(n => <NoteRow key={n.id} userId={userId} note={n} onChange={reload} />)}
    </div>
  )
}

function NoteRow({ userId, note, onChange }: { userId: string; note: UserNote; onChange: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(note.body)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const body = value.trim()
    if (!body) return
    setBusy(true)
    try {
      await api('/users/' + userId + '/notes/' + note.id, { method: 'PATCH', body: JSON.stringify({ body }) })
      setEditing(false)
      await onChange()
    } catch (e) { toast((e as Error).message, 'err') } finally { setBusy(false) }
  }

  const remove = async () => {
    if (!(await confirm('Delete this note?', 'Delete'))) return
    try {
      await api('/users/' + userId + '/notes/' + note.id, { method: 'DELETE' })
      await onChange()
    } catch (e) { toast((e as Error).message, 'err') }
  }

  const edited = note.updatedAt > note.createdAt + 1000

  return (
    <Card className="gap-3 py-4">
      <CardContent className="space-y-3 px-4">
        {editing ? (
          <>
            <Textarea value={value} maxLength={2000} onChange={e => setValue(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setValue(note.body) }}>Cancel</Button>
              <Button size="sm" busy={busy} disabled={!value.trim()} onClick={save}>Save</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap">{note.body}</p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {note.authorEmail && <span className="font-medium text-foreground/80">{note.authorEmail}</span>}
              <span title={fmtAbs(note.createdAt)}>{note.authorEmail ? '· ' : ''}{ago(note.createdAt)}{edited ? ' (edited)' : ''}</span>
              <span className="grow" />
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setEditing(true)}><Pencil className="size-3" />Edit</Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs hover:text-destructive" onClick={remove}><Trash2 className="size-3" />Delete</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Party history ──────────────────────────────────────────────────────────────────

function HistorySection({ sessions }: { sessions: UserHistorySession[] | null }) {
  if (!sessions) return <SectionSkeleton />
  if (sessions.length === 0) {
    return (
      <EmptyState icon={<Clock />} title="No party history">
        This member hasn’t been in any recorded party yet.
      </EmptyState>
    )
  }
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="divide-y">
        {sessions.map(s => <HistoryRow key={s.historyId} s={s} />)}
      </div>
    </Card>
  )
}

function HistoryRow({ s }: { s: UserHistorySession }) {
  const active = s.endedAt == null
  return (
    <button
      type="button"
      className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-accent/40"
      onClick={() => { location.hash = '#/history/' + s.historyId }}
    >
      <div className="flex min-w-0 flex-1 basis-56 items-center gap-3">
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
        {s.wasOwner ? <Badge variant="warning"><Crown />Owner</Badge> : <Badge variant="secondary"><Swords />Member</Badge>}
        {s.gameCount > 0 && <Badge variant="primary"><Gamepad2 />{s.gameCount}</Badge>}
        <span className="inline-flex w-28 items-center justify-end gap-1 text-xs whitespace-nowrap text-muted-foreground" title={fmtAbs(s.firstSeenAt)}>
          <Clock className="size-3.5" />{ago(s.firstSeenAt)}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 group-hover:text-muted-foreground" />
      </div>
    </button>
  )
}
