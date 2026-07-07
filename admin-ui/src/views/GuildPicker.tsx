import { useState } from 'react'
import { api } from '../api'
import { useLoad } from '../lib/useLoad'
import type { GuildInfo } from '../types'

function openGuild(id: string) {
  location.href = '?guild=' + encodeURIComponent(id) + '#/dashboard'
}

export function GuildPicker() {
  const { data: guilds } = useLoad(() => api<GuildInfo[]>('/guilds').catch(() => [] as GuildInfo[]))
  const [manualId, setManualId] = useState('')

  if (!guilds) return <progress />

  const last = localStorage.getItem('pb-guild')
  const sorted = guilds.slice().sort((a, b) => Number(b.id === last) - Number(a.id === last))

  return (
    <div>
      {sorted.length > 0 ? (
        <div className="guild-grid">
          {sorted.map(g => (
            <a key={g.id} className="gcard" href={'?guild=' + encodeURIComponent(g.id) + '#/dashboard'}>
              {g.icon
                ? <img className="gicon" src={`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64`} alt="" />
                : <div className="gicon ginit">{(g.name || '?').slice(0, 1).toUpperCase()}</div>}
              <div>
                <div className="gname">{g.name}</div>
                <div className="uid">{g.id}{g.id === last ? ' · last used' : ''}</div>
              </div>
            </a>
          ))}
        </div>
      ) : (
        <p className="muted">Could not list servers — enter a guild ID manually:</p>
      )}
      <details>
        <summary className="muted">Enter a guild ID manually</summary>
        <form
          className="toolbar"
          onSubmit={e => { e.preventDefault(); if (manualId.trim()) openGuild(manualId.trim()) }}
        >
          <div className="grow">
            <input
              type="text"
              placeholder="Guild ID"
              autoComplete="off"
              value={manualId}
              onChange={e => setManualId(e.target.value)}
            />
          </div>
          <button type="submit" className="secondary">Open</button>
        </form>
      </details>
    </div>
  )
}
