import { ArrowLeftRight, History as HistoryIcon, LayoutDashboard, Moon, ScrollText, Settings as SettingsIcon, Sun, Swords, User, FileStack, PartyPopper } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, guildId, onSessionExpired } from './api'
import type { GuildInfo } from './types'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/Confirm'
import { Button } from './components/ui'
import { cn } from './lib/cn'
import { GuildDataProvider } from './lib/guildData'
import { GuildPicker } from './views/GuildPicker'
import { Dashboard } from './views/Dashboard'
import { Parties } from './views/Parties'
import { Templates } from './views/Templates'
import { Users } from './views/Users'
import { History } from './views/History'
import { Audit } from './views/Audit'
import { Settings } from './views/Settings'

const TABS: { id: string; label: string; icon: ReactNode; desc: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard />, desc: 'Live overview of parties in this server.' },
  { id: 'parties', label: 'Parties', icon: <Swords />, desc: 'Create, inspect, and manage active parties.' },
  { id: 'templates', label: 'Templates', icon: <FileStack />, desc: 'Reusable party blueprints — build one, then spin up a party for any member.' },
  { id: 'history', label: 'History', icon: <HistoryIcon />, desc: 'Past and present parties — who joined, who left, and League games played.' },
  { id: 'users', label: 'Users', icon: <User />, desc: 'Look up a member to inspect their IGN profile and party state.' },
  { id: 'audit', label: 'Audit log', icon: <ScrollText />, desc: 'Every admin action taken through this panel.' },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon />, desc: 'Guild-wide limits enforced by the bot.' },
]

function currentTab(): string {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  // Keep the tab active for sub-routes like #/parties/<id>.
  const seg = h.split('/')[0]!
  return TABS.some(t => t.id === seg) ? seg : 'dashboard'
}

export function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('pb-theme') || 'light')
  const [tab, setTab] = useState(currentTab)
  const [email, setEmail] = useState('')
  const [guild, setGuild] = useState<GuildInfo | null>(null)
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
      if (g) setGuild(g)
    }).catch(() => {})
  }, [])

  const themeButton = (
    <Button
      variant="ghost"
      size="icon"
      title="Toggle dark mode"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      {theme === 'dark' ? <Sun /> : <Moon />}
    </Button>
  )

  return (
    <ToastProvider>
      <ConfirmProvider>
        <GuildDataProvider>
          {expired && (
            <div className="fixed inset-x-0 top-0 z-100 flex items-center justify-center gap-3 bg-danger-muted px-4 py-2 text-sm text-destructive">
              Your Cloudflare Access session has expired.
              <Button variant="destructive" size="sm" onClick={() => location.reload()}>Reload to sign in</Button>
            </div>
          )}
          {!guildId ? (
            <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex items-center gap-2.5">
                    <BrandMark />
                    <h1 className="text-lg font-semibold tracking-tight">PartyBot Admin</h1>
                  </div>
                  <p className="text-sm text-muted-foreground">Pick a server to manage.</p>
                </div>
                <div className="flex items-center gap-2">
                  {email && <span className="hidden text-xs text-muted-foreground sm:block">{email}</span>}
                  {themeButton}
                </div>
              </div>
              <GuildPicker />
            </main>
          ) : (
            <Shell
              tab={tab}
              email={email}
              guild={guild}
              themeButton={themeButton}
            >
              <TabView tab={tab} />
            </Shell>
          )}
        </GuildDataProvider>
      </ConfirmProvider>
    </ToastProvider>
  )
}

function BrandMark() {
  return (
    <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
      <PartyPopper className="size-4.5" />
    </span>
  )
}

function Shell({ tab, email, guild, themeButton, children }: {
  tab: string
  email: string
  guild: GuildInfo | null
  themeButton: ReactNode
  children: ReactNode
}) {
  const active = TABS.find(t => t.id === tab) ?? TABS[0]

  return (
    <div className="flex min-h-dvh">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex items-center gap-2.5 px-4 pt-5 pb-4">
          <BrandMark />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">PartyBot Admin</div>
            <div className="truncate text-[0.7rem] text-muted-foreground">Party management console</div>
          </div>
        </div>
        <div className="mx-3 mb-3 flex items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2">
          <GuildIcon guild={guild} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-xs font-medium">{guild?.name ?? guildId}</div>
            <div className="truncate font-mono text-[0.65rem] text-muted-foreground">{guildId}</div>
          </div>
          <a href="?" title="Switch server" className="text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeftRight className="size-3.5" />
          </a>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {TABS.map(t => (
            <a
              key={t.id}
              href={'#/' + t.id}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
                t.id === tab
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {t.icon}
              {t.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t px-4 py-3">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={email}>{email}</span>
          {themeButton}
        </div>
      </aside>

      {/* Main column */}
      <div className="min-w-0 flex-1">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur md:hidden">
          <div className="flex items-center gap-2.5 px-4 pt-3">
            <BrandMark />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-semibold">PartyBot Admin</div>
              <div className="truncate text-[0.7rem] text-muted-foreground">{guild?.name ?? guildId}</div>
            </div>
            <a href="?" title="Switch server" className="text-muted-foreground"><ArrowLeftRight className="size-4" /></a>
            {themeButton}
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 py-2">
            {TABS.map(t => (
              <a
                key={t.id}
                href={'#/' + t.id}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors [&_svg]:size-3.5',
                  t.id === tab ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {t.icon}
                {t.label}
              </a>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 md:py-8">
          <div className="mb-6">
            <h1 className="text-lg font-semibold tracking-tight">{active.label}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{active.desc}</p>
          </div>
          {children}
        </main>
      </div>
    </div>
  )
}

function GuildIcon({ guild }: { guild: GuildInfo | null }) {
  if (guild?.icon) {
    return (
      <img
        className="size-8 shrink-0 rounded-full"
        src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`}
        alt=""
      />
    )
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
      {(guild?.name || '?').slice(0, 1).toUpperCase()}
    </span>
  )
}

function TabView({ tab }: { tab: string }) {
  switch (tab) {
    case 'parties': return <Parties />
    case 'templates': return <Templates />
    case 'history': return <History />
    case 'users': return <Users />
    case 'audit': return <Audit />
    case 'settings': return <Settings />
    default: return <Dashboard />
  }
}
