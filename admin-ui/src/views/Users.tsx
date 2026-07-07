import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { GAMES } from '../games'
import { useToast } from '../components/Toast'
import { Avatar } from '../components/Avatar'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
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
    <div>
      <p className="muted">Look up a member to inspect their IGN profile and party state.</p>
      <form
        className="toolbar"
        onSubmit={e => {
          e.preventDefault()
          const id = picker.current?.getId()
          if (id) doLookup(id)
          else toast('Pick a member from the list or paste a user ID.', 'err')
        }}
      >
        <div className="grow">
          <UserPicker ref={picker} placeholder="Search member by name, or paste an ID" onPick={u => doLookup(u.id)} />
        </div>
        <button type="submit">Look up</button>
      </form>
      {loading && <progress />}
      {lookup && <UserCard u={lookup} parties={parties} onRefresh={() => doLookup(lookup.userId)} />}
    </div>
  )
}

function UserCard({ u, parties, onRefresh }: { u: UserLookup; parties: Party[]; onRefresh: () => void }) {
  const toast = useToast()

  let partyInfo
  if (!u.partyId) {
    partyInfo = <p className="muted">Not in any party.</p>
  } else if (u.inParty) {
    const entry = parties.find(p => p.id === u.partyId)
    partyInfo = <p>In party <strong>{entry ? entry.name : u.partyId}</strong> <span className="uid">{u.partyId}</span></p>
  } else {
    partyInfo = (
      <div className="toolbar">
        <span className="warn">
          Stale mapping → party {u.partyId}{u.partyExists ? ' (not a member)' : ' (party gone)'}
        </span>
        <button
          className="tiny"
          onClick={async () => {
            try {
              await api('/users/' + u.userId + '/unstick', { method: 'POST' })
              toast('Mapping cleared')
              onRefresh()
            } catch (e) { toast((e as Error).message, 'err') }
          }}
        >
          Clear mapping
        </button>
      </div>
    )
  }

  return (
    <article>
      {u.member ? (
        <div className="uhead">
          <Avatar name={u.member.displayName} />
          <div>
            <strong>{u.member.displayName}</strong> <span className="muted">@{u.member.username}</span>
          </div>
        </div>
      ) : (
        <div><span className="warn">Not a member of this guild</span></div>
      )}
      <p className="uid">{u.userId}</p>
      {partyInfo}
      <h5>In-game names</h5>
      {GAMES.map(g => <IgnRow key={g} game={g} userId={u.userId} initial={u.profile.igns[g] || ''} />)}
    </article>
  )
}

function IgnRow({ game, userId, initial }: { game: string; userId: string; initial: string }) {
  const toast = useToast()
  const [value, setValue] = useState(initial)
  return (
    <div className="ign-row">
      <label>{game}</label>
      <input value={value} placeholder="—" maxLength={100} onChange={e => setValue(e.target.value)} />
      <button
        className="tiny secondary"
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
      </button>
    </div>
  )
}
