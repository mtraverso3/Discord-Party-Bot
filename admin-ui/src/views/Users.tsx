import {
  ArrowLeft, Clock, Copy, Crown, Gamepad2, NotebookPen, Pencil, Search, Swords, Trash2, UserX,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { fmtAbs, relTime } from '../lib/time'
import { useLoad } from '../lib/useLoad'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { Avatar } from '../components/Avatar'
import { GameList } from '../components/GameList'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import {
  Badge, Button, Card, CardContent, EmptyState, ErrorNote, Input, Mono, Segmented, Spinner,
  StatusDot, Textarea,
} from '../components/ui'
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
    <form
      className="flex max-w-xl gap-2"
      onSubmit={e => {
        e.preventDefault()
        const id = picker.current?.getId()
        if (id) goToUser(id)
        else toast('Pick a member from the list or paste a user ID.', 'err')
      }}
    >
      <div className="flex-1">
        <UserPicker ref={picker} placeholder="Search member by name, or paste an ID" onPick={u => goToUser(u.id)} />
      </div>
      <Button type="submit"><Search />Look up</Button>
    </form>
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
  if (!lookup) return <Spinner />

  const tabs: [Section, string][] = [
    ['notes', 'Notes'],
    ['history', `Party history${history ? ` (${history.length})` : ''}`],
    ['games', `Games${games ? ` (${games.length})` : ''}`],
  ]

  return (
    <div className="max-w-3xl space-y-4">
      <BackLink />
      <Overview u={lookup} avatar={avatar} history={history} gamesCount={games?.length ?? null} />
      <IgnCard u={lookup} />
      <Segmented value={section} onChange={setSection} options={tabs} />
      {section === 'notes' && <NotesCard userId={userId} />}
      {section === 'history' && <HistorySection sessions={history} />}
      {section === 'games' && <GamesSection games={games} />}
    </div>
  )
}

function BackLink() {
  return (
    <button
      type="button"
      className="-ml-1 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      onClick={goToSearch}
    >
      <ArrowLeft className="size-4" />Look up another member
    </button>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────────

function Overview({ u, avatar, history, gamesCount }: {
  u: UserLookup
  avatar: string | null
  history: UserHistorySession[] | null
  gamesCount: number | null
}) {
  const toast = useToast()
  const name = u.member?.displayName ?? 'Unknown member'

  const joined = history?.length ?? null
  const owned = history ? history.filter(s => s.wasOwner).length : null
  const firstSeen = history && history.length ? Math.min(...history.map(s => s.firstSeenAt)) : null
  const lastSeen = history && history.length ? Math.max(...history.map(s => s.lastSeenAt)) : null

  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={name} imageUrl={avatar} className="size-12 text-base" />
          <div className="min-w-0 flex-1">
            {u.member ? (
              <div className="text-base font-semibold">
                {u.member.displayName}{' '}
                <span className="font-normal text-muted-foreground">@{u.member.username}</span>
              </div>
            ) : (
              <Badge variant="warning"><UserX className="size-3" />Not a member of this guild</Badge>
            )}
            <button
              type="button"
              className="mt-0.5 inline-flex cursor-pointer items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
              title="Copy user ID"
              onClick={() => { navigator.clipboard?.writeText(u.userId).then(() => toast('User ID copied')).catch(() => {}) }}
            >
              <Mono>{u.userId}</Mono><Copy className="size-3" />
            </button>
          </div>
        </div>

        <PartyState u={u} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Parties joined" value={joined} />
          <Stat label="Parties owned" value={owned} />
          <Stat label="Games played" value={gamesCount} />
          <Stat
            label="First seen"
            value={firstSeen != null ? relTime(Date.now() - firstSeen) + ' ago' : '—'}
            title={firstSeen != null ? fmtAbs(firstSeen) : undefined}
          />
        </div>
        {lastSeen != null && (
          <p className="text-xs text-muted-foreground" title={fmtAbs(lastSeen)}>
            Last active in a party {relTime(Date.now() - lastSeen)} ago.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, title }: { label: string; value: number | string | null; title?: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-lg font-semibold" title={title}>{value ?? '—'}</div>
      <div className="text-[0.7rem] tracking-wide text-muted-foreground uppercase">{label}</div>
    </div>
  )
}

function PartyState({ u }: { u: UserLookup }) {
  const toast = useToast()
  if (!u.partyId) return <p className="text-sm text-muted-foreground">Not in any party right now.</p>
  if (u.inParty) {
    return (
      <p className="text-sm">
        Currently in party{' '}
        <button
          type="button"
          className="cursor-pointer font-semibold text-primary hover:underline"
          onClick={() => { location.hash = '#/parties/' + encodeURIComponent(u.partyId!) }}
        >
          {u.partyId}
        </button>
      </p>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="warning">
        Stale mapping → party {u.partyId}{u.partyExists ? ' (not a member)' : ' (party gone)'}
      </Badge>
      <Button
        variant="secondary"
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
    </div>
  )
}

// ── IGNs ──────────────────────────────────────────────────────────────────────

function IgnCard({ u }: { u: UserLookup }) {
  return (
    <Card>
      <CardContent>
        <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">In-game names</h4>
        <div className="space-y-2">
          {GAMES.map(g => <IgnRow key={g} game={g} userId={u.userId} initial={u.profile.igns[g] || ''} />)}
        </div>
      </CardContent>
    </Card>
  )
}

function IgnRow({ game, userId, initial }: { game: string; userId: string; initial: string }) {
  const toast = useToast()
  const [value, setValue] = useState(initial)
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 shrink-0 text-xs font-medium text-muted-foreground">{game}</span>
      <Input value={value} placeholder="—" maxLength={100} onChange={e => setValue(e.target.value)} />
      <Button
        variant="secondary"
        size="sm"
        onClick={async () => {
          try {
            await api('/users/' + userId + '/profile', {
              method: 'PATCH',
              body: JSON.stringify({ game, ign: value }),
            })
            toast(value.trim() ? 'IGN saved' : 'IGN cleared')
          } catch (e) { toast((e as Error).message, 'err') }
        }}
      >
        Save
      </Button>
    </div>
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
      <Card>
        <CardContent className="space-y-2">
          <Textarea
            value={draft}
            maxLength={2000}
            placeholder="Add a note about this member — visible to admins of this server only."
            onChange={e => setDraft(e.target.value)}
          />
          <div className="flex justify-end">
            <Button size="sm" busy={busy} disabled={!draft.trim()} onClick={add}><NotebookPen />Add note</Button>
          </div>
        </CardContent>
      </Card>

      {error && <ErrorNote>Error: {error}</ErrorNote>}
      {!data && !error && <Spinner />}
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
    <Card>
      <CardContent className="space-y-2">
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
              {note.authorEmail && <span>{note.authorEmail}</span>}
              <span title={fmtAbs(note.createdAt)}>· {relTime(Date.now() - note.createdAt)} ago{edited ? ' (edited)' : ''}</span>
              <span className="grow" />
              <button type="button" className="inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-foreground" onClick={() => setEditing(true)}>
                <Pencil className="size-3" />Edit
              </button>
              <button type="button" className="inline-flex cursor-pointer items-center gap-1 transition-colors hover:text-destructive" onClick={remove}>
                <Trash2 className="size-3" />Delete
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Party history ──────────────────────────────────────────────────────────────────

function HistorySection({ sessions }: { sessions: UserHistorySession[] | null }) {
  if (!sessions) return <Spinner />
  if (sessions.length === 0) {
    return (
      <EmptyState icon={<Clock />} title="No party history">
        This member hasn’t been in any recorded party yet.
      </EmptyState>
    )
  }
  return (
    <div className="space-y-2.5">
      {sessions.map(s => <HistoryRow key={s.historyId} s={s} />)}
    </div>
  )
}

function HistoryRow({ s }: { s: UserHistorySession }) {
  const active = s.endedAt == null
  return (
    <Card className="overflow-hidden transition-colors hover:border-primary/40">
      <button
        type="button"
        className="flex w-full cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40"
        onClick={() => { location.hash = '#/history/' + s.historyId }}
      >
        <Badge variant={active ? 'success' : 'outline'}><StatusDot />{active ? 'Active' : 'Ended'}</Badge>
        <span className="text-sm font-semibold">{s.name}</span>
        <Badge variant="outline">{s.game}</Badge>
        {s.wasOwner ? <Badge variant="warning"><Crown className="size-3" />Owner</Badge> : <Badge variant="secondary"><Swords className="size-3" />Member</Badge>}
        {s.gameCount > 0 && <Badge variant="warning"><Gamepad2 className="size-3" />{s.gameCount}</Badge>}
        <span className="grow" />
        <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground" title={fmtAbs(s.firstSeenAt)}>
          <Clock className="size-3.5" />{relTime(Date.now() - s.firstSeenAt)} ago
        </span>
        <Mono className="hidden sm:inline">{s.partyId}</Mono>
      </button>
    </Card>
  )
}

// ── Games ──────────────────────────────────────────────────────────────────────

function GamesSection({ games }: { games: PartyGame[] | null }) {
  if (!games) return <Spinner />
  return <GameList games={games} />
}
