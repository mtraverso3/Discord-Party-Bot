import { Search, UserX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { Avatar } from '../components/Avatar'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { Badge, Button, Card, CardContent, Input, Mono, Spinner } from '../components/ui'
import type { Party, UserLookup } from '../types'

export function Users() {
  const toast = useToast()
  const picker = useRef<UserPickerHandle>(null)
  const [lookup, setLookup] = useState<UserLookup | null>(null)
  const [loading, setLoading] = useState(false)
  const [parties, setParties] = useState<Party[]>([])

  useEffect(() => {
    api<Party[]>('/parties').then(setParties).catch(() => { /* lookup still works */ })
  }, [])

  const doLookup = async (userId: string) => {
    setLoading(true)
    setLookup(null)
    try {
      setLookup(await api<UserLookup>('/users/' + encodeURIComponent(userId)))
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setLoading(false)
    }
  }

  // Deep link from a party card's "Profile" button.
  useEffect(() => {
    const pending = sessionStorage.getItem('pb-user-lookup')
    if (pending) {
      sessionStorage.removeItem('pb-user-lookup')
      picker.current?.setValue(pending)
      doLookup(pending)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="space-y-4">
      <form
        className="flex max-w-xl gap-2"
        onSubmit={e => {
          e.preventDefault()
          const id = picker.current?.getId()
          if (id) doLookup(id)
          else toast('Pick a member from the list or paste a user ID.', 'err')
        }}
      >
        <div className="flex-1">
          <UserPicker ref={picker} placeholder="Search member by name, or paste an ID" onPick={u => doLookup(u.id)} />
        </div>
        <Button type="submit"><Search />Look up</Button>
      </form>
      {loading && <Spinner />}
      {lookup && <UserCard u={lookup} parties={parties} onRefresh={() => doLookup(lookup.userId)} />}
    </div>
  )
}

function UserCard({ u, parties, onRefresh }: { u: UserLookup; parties: Party[]; onRefresh: () => void }) {
  const toast = useToast()

  let partyInfo
  if (!u.partyId) {
    partyInfo = <p className="text-sm text-muted-foreground">Not in any party.</p>
  } else if (u.inParty) {
    const entry = parties.find(p => p.id === u.partyId)
    partyInfo = (
      <p className="text-sm">
        In party <span className="font-semibold">{entry ? entry.name : u.partyId}</span>{' '}
        <Mono>{u.partyId}</Mono>
      </p>
    )
  } else {
    partyInfo = (
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
              onRefresh()
            } catch (e) { toast((e as Error).message, 'err') }
          }}
        >
          Clear mapping
        </Button>
      </div>
    )
  }

  return (
    <Card className="animate-fade-in max-w-xl">
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          {u.member ? (
            <>
              <Avatar name={u.member.displayName} className="size-11 text-sm" />
              <div className="min-w-0">
                <div className="text-sm font-semibold">
                  {u.member.displayName} <span className="font-normal text-muted-foreground">@{u.member.username}</span>
                </div>
                <Mono>{u.userId}</Mono>
              </div>
            </>
          ) : (
            <div>
              <Badge variant="warning"><UserX className="size-3" />Not a member of this guild</Badge>
              <div className="mt-1"><Mono>{u.userId}</Mono></div>
            </div>
          )}
        </div>
        {partyInfo}
        <div>
          <h4 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">In-game names</h4>
          <div className="space-y-2">
            {GAMES.map(g => <IgnRow key={g} game={g} userId={u.userId} initial={u.profile.igns[g] || ''} />)}
          </div>
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
