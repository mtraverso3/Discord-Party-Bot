import { useEffect, useState } from 'react'
import { api, guildId, onSessionExpired } from './api'
import type { GuildInfo } from './types'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/Confirm'
import { GuildDataProvider } from './lib/guildData'
import { GuildPicker } from './views/GuildPicker'
import { Dashboard } from './views/Dashboard'
import { Parties } from './views/Parties'
import { Templates } from './views/Templates'
import { Users } from './views/Users'
import { Audit } from './views/Audit'
import { Settings } from './views/Settings'

const TABS: [string, string][] = [
  ['dashboard', 'Dashboard'],
  ['parties', 'Parties'],
  ['templates', 'Templates'],
  ['users', 'Users'],
  ['audit', 'Audit log'],
  ['settings', 'Settings'],
]

function currentTab(): string {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  return TABS.some(t => t[0] === h) ? h : 'dashboard'
}

export function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('pb-theme') || 'light')
  const [tab, setTab] = useState(currentTab)
  const [email, setEmail] = useState('')
  const [guildName, setGuildName] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('pb-theme', theme)
  }, [theme])

  useEffect(() => {
    onSessionExpired(() => setExpired(true))
    const onHash = () => setTab(currentTab())
    window.addEventListener('hashchange', onHash)
    api<{ email?: string }>('/me').then(r => { if (r?.email) setEmail(r.email) }).catch(() => {})
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!guildId) return
    localStorage.setItem('pb-guild', guildId)
    api<GuildInfo[]>('/guilds').then(gs => {
      const g = gs.find(x => x.id === guildId)
      if (g) setGuildName(g.name)
    }).catch(() => {})
  }, [])

  return (
    <ToastProvider>
      <ConfirmProvider>
        <GuildDataProvider>
          {expired && (
            <div id="expired">
              Your Cloudflare Access session has expired.
              <button type="button" onClick={() => location.reload()}>Reload to sign in</button>
            </div>
          )}
          <main className="container">
            <header>
              <hgroup>
                <h2>PartyBot Admin</h2>
                <p className="muted">
                  {guildId ? (guildName ?? 'Guild: ' + guildId) : 'Pick a server to manage'}
                </p>
              </hgroup>
              <div>
                <span className="muted">{email}</span>
                {guildId && <a href="?" style={{ marginLeft: '1rem' }}>change guild</a>}
                <button
                  id="theme-btn"
                  type="button"
                  title="Toggle dark mode"
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                >
                  {theme === 'dark' ? '☀' : '🌙'}
                </button>
              </div>
            </header>
            {!guildId ? (
              <GuildPicker />
            ) : (
              <>
                <nav className="tabs">
                  {TABS.map(([id, label]) => (
                    <a key={id} href={'#/' + id} className={id === tab ? 'active' : ''}>{label}</a>
                  ))}
                </nav>
                <TabView tab={tab} />
              </>
            )}
          </main>
        </GuildDataProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

function TabView({ tab }: { tab: string }) {
  switch (tab) {
    case 'parties': return <Parties />
    case 'templates': return <Templates />
    case 'users': return <Users />
    case 'audit': return <Audit />
    case 'settings': return <Settings />
    default: return <Dashboard />
  }
}
