import {
  Check, ChevronsUpDown, FileStack, Gamepad2, History as HistoryIcon, LayoutDashboard, LogOut, Monitor, Moon,
  ScrollText, Server, Settings as SettingsIcon, ShieldCheck, ShieldUser, Sun, Swords, UserSearch,
} from 'lucide-react'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { api, guildId, onSessionExpired } from './api'
import type { GuildInfo } from './types'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/Confirm'
import { Button } from './components/ui/button'
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from './components/ui/breadcrumb'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { Separator } from './components/ui/separator'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
  useSidebar,
} from './components/ui/sidebar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip'
import { BrandMark, GuildIcon } from './components/brand'
import { GuildDataProvider } from './lib/guildData'
import { GuildPicker } from './views/GuildPicker'
import { Dashboard } from './views/Dashboard'
import { Parties } from './views/Parties'
import { Templates } from './views/Templates'
import { Users } from './views/Users'
import { History } from './views/History'
import { Audit } from './views/Audit'
import { Admins } from './views/Admins'
import { Settings } from './views/Settings'
import { Games } from './views/Games'
import { Rules } from './views/Rules'

type Theme = 'light' | 'dark'

interface Tab { id: string; label: string; icon: ReactNode; desc: string; detail?: string }

const NAV: { label: string; tabs: Tab[] }[] = [
  {
    label: 'Overview',
    tabs: [
      { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard />, desc: 'Live overview of parties in this server.' },
    ],
  },
  {
    label: 'Parties',
    tabs: [
      { id: 'parties', label: 'Parties', icon: <Swords />, desc: 'Create, inspect, and manage active parties.', detail: 'Party' },
      { id: 'templates', label: 'Templates', icon: <FileStack />, desc: 'Reusable party blueprints — build one, then spin up a party for any member.' },
      { id: 'history', label: 'History', icon: <HistoryIcon />, desc: 'Past and present parties — who joined, who left, and League games played.', detail: 'Session' },
    ],
  },
  {
    label: 'Members',
    tabs: [
      { id: 'users', label: 'Users', icon: <UserSearch />, desc: 'Look up a member — IGN profile, admin notes, party history, and games played.', detail: 'Profile' },
      { id: 'rules', label: 'Rules & verification', icon: <ShieldCheck />, desc: 'Manage the rules quiz, queue approval, and member verification history.' },
      { id: 'admins', label: 'Admins', icon: <ShieldUser />, desc: 'Discord users allowed to sign in to this server via /party admin.' },
    ],
  },
  {
    label: 'Configuration',
    tabs: [
      { id: 'games', label: 'Games', icon: <Gamepad2 />, desc: 'The games members can pick for a party — built-ins plus your own, each switchable on or off.' },
      { id: 'settings', label: 'Settings', icon: <SettingsIcon />, desc: 'Guild-wide limits enforced by the bot.' },
      { id: 'audit', label: 'Audit log', icon: <ScrollText />, desc: 'Every admin action taken through this panel.' },
    ],
  },
]

const TABS = NAV.flatMap(g => g.tabs)

/** The current route from the hash: `#/parties/<id>` → { tab: 'parties', sub: '<id>' }. */
function currentRoute(): { tab: string; sub: string | null } {
  let h = location.hash || ''
  if (h.startsWith('#/')) h = h.slice(2)
  else if (h.startsWith('#')) h = h.slice(1)
  const [seg = '', sub] = h.split('/')
  return TABS.some(t => t.id === seg) ? { tab: seg, sub: sub ? decodeURIComponent(sub) : null } : { tab: 'dashboard', sub: null }
}

function initialTheme(): Theme {
  try { return localStorage.getItem('pb-theme') === 'dark' ? 'dark' : 'light' } catch { return 'light' }
}

export function App() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  const [route, setRoute] = useState(currentRoute)
  const [label, setLabel] = useState('')
  const [superAdmin, setSuperAdmin] = useState(true)
  const [guilds, setGuilds] = useState<GuildInfo[] | null>(null)
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('pb-theme', theme) } catch { /* private mode */ }
  }, [theme])

  useEffect(() => {
    onSessionExpired(() => setExpired(true))
    const onHash = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHash)
    api<{ email?: string; displayName?: string; superAdmin?: boolean }>('/me').then(r => {
      // Super admins show their real email; magic-link admins show their resolved
      // Discord name (never the synthetic <id>@<guild>.discord.local address).
      const l = r?.displayName ?? r?.email
      if (l) setLabel(l)
      setSuperAdmin(r?.superAdmin !== false)
    }).catch(() => {})
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (!guildId) return
    try { localStorage.setItem('pb-guild', guildId) } catch { /* private mode */ }
    api<GuildInfo[]>('/guilds').then(setGuilds).catch(() => setGuilds([]))
  }, [])

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'))

  return (
    <ToastProvider theme={theme}>
      <TooltipProvider delayDuration={300}>
        <ConfirmProvider>
          <GuildDataProvider>
            {expired && (
              <div className="fixed inset-x-0 top-0 z-100 flex items-center justify-center gap-3 bg-danger-muted px-4 py-2 text-sm text-destructive">
                Your Cloudflare Access session has expired.
                <Button variant="destructive" size="sm" onClick={() => location.reload()}>Reload to sign in</Button>
              </div>
            )}
            {!guildId ? (
              <PickerLayout label={label} theme={theme} onToggleTheme={toggleTheme} />
            ) : (
              <SidebarProvider>
                <AppSidebar
                  tab={route.tab}
                  label={label}
                  guilds={guilds}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                />
                <SidebarInset>
                  <TopBar route={route} theme={theme} onToggleTheme={toggleTheme} />
                  <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
                    <PageHeader route={route} />
                    <TabView tab={route.tab} superAdmin={superAdmin} />
                  </div>
                </SidebarInset>
              </SidebarProvider>
            )}
          </GuildDataProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </ToastProvider>
  )
}

// ── Guild picker layout ───────────────────────────────────────────────────────

function PickerLayout({ label, theme, onToggleTheme }: { label: string; theme: Theme; onToggleTheme: () => void }) {
  return (
    <div className="relative min-h-svh overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,var(--color-primary)_0%,transparent_65%)] opacity-[0.12]"
      />
      <header className="relative mx-auto flex w-full max-w-3xl items-center justify-end gap-1 px-4 pt-4 sm:px-6">
        {label && <span className="mr-2 hidden text-xs text-muted-foreground sm:block">{label}</span>}
        <ThemeButton theme={theme} onToggle={onToggleTheme} />
        <SignOutButton />
      </header>
      <main className="relative mx-auto w-full max-w-3xl px-4 pt-8 pb-16 sm:px-6">
        <div className="mb-8 flex flex-col items-center text-center">
          <BrandMark className="size-11 rounded-xl [&_svg]:size-5.5" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">PartyBot Admin</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Pick a server to manage.</p>
        </div>
        <GuildPicker />
      </main>
    </div>
  )
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function AppSidebar({ tab, label, guilds, theme, onToggleTheme }: {
  tab: string
  label: string
  guilds: GuildInfo[] | null
  theme: Theme
  onToggleTheme: () => void
}) {
  const guild = guilds?.find(g => g.id === guildId) ?? null
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <GuildSwitcher guild={guild} guilds={guilds} />
      </SidebarHeader>
      <SidebarContent>
        {NAV.map(group => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.tabs.map(t => (
                  <SidebarMenuItem key={t.id}>
                    <SidebarMenuButton asChild isActive={t.id === tab} tooltip={t.label}>
                      <a href={'#/' + t.id}>
                        {t.icon}
                        <span>{t.label}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu label={label} theme={theme} onToggleTheme={onToggleTheme} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

function GuildSwitcher({ guild, guilds }: { guild: GuildInfo | null; guilds: GuildInfo[] | null }) {
  const { isMobile } = useSidebar()
  const others = (guilds ?? []).filter(g => g.id !== guildId)
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <GuildIcon guild={guild} className="size-8 rounded-lg" />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{guild?.name ?? 'Server'}</span>
                <span className="truncate text-xs text-muted-foreground">PartyBot Admin</span>
              </div>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-60 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Servers</DropdownMenuLabel>
            {guild && (
              <DropdownMenuItem className="gap-2 p-2">
                <GuildIcon guild={guild} className="size-6 rounded-md text-[0.65rem]" />
                <span className="flex-1 truncate">{guild.name}</span>
                <Check className="text-primary" />
              </DropdownMenuItem>
            )}
            {others.map(g => (
              <DropdownMenuItem key={g.id} className="gap-2 p-2" asChild>
                <a href={'?guild=' + encodeURIComponent(g.id) + '#/dashboard'}>
                  <GuildIcon guild={g} className="size-6 rounded-md text-[0.65rem]" />
                  <span className="truncate">{g.name}</span>
                </a>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2" asChild>
              <a href="?">
                <span className="flex size-6 items-center justify-center rounded-md border bg-background"><Server className="size-3.5" /></span>
                <span className="text-muted-foreground">All servers…</span>
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

function UserMenu({ label, theme, onToggleTheme }: { label: string; theme: Theme; onToggleTheme: () => void }) {
  const { isMobile } = useSidebar()
  const name = label || 'Signed in'
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{name}</span>
                <span className="truncate text-xs text-muted-foreground">Administrator</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="truncate font-normal">
              <div className="text-xs text-muted-foreground">Signed in as</div>
              <div className="truncate text-sm font-medium">{name}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onToggleTheme}>
              {theme === 'dark' ? <Sun /> : <Moon />}
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <a href="?"><Monitor />Switch server</a>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => { location.href = '/auth/logout' }}>
              <LogOut />Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

// ── Top bar & page header ────────────────────────────────────────────────────

function TopBar({ route, theme, onToggleTheme }: { route: { tab: string; sub: string | null }; theme: Theme; onToggleTheme: () => void }) {
  const active = TABS.find(t => t.id === route.tab) ?? TABS[0]!
  const group = NAV.find(g => g.tabs.includes(active))!
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList className="flex-nowrap">
          {!route.sub && group.label !== active.label && (
            <>
              <BreadcrumbItem className="hidden sm:inline-flex">{group.label}</BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
            </>
          )}
          {route.sub ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink href={'#/' + active.id}>{active.label}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage>{active.detail ?? 'Details'}</BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem><BreadcrumbPage>{active.label}</BreadcrumbPage></BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
      <ThemeButton theme={theme} onToggle={onToggleTheme} />
    </header>
  )
}

/** Title and description for list routes; detail routes render their own header. */
function PageHeader({ route }: { route: { tab: string; sub: string | null } }) {
  if (route.sub) return null
  const active = TABS.find(t => t.id === route.tab) ?? TABS[0]!
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{active.label}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{active.desc}</p>
    </div>
  )
}

function ThemeButton({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" onClick={onToggle} aria-label="Toggle dark mode">
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</TooltipContent>
    </Tooltip>
  )
}

function SignOutButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label="Sign out" onClick={() => { location.href = '/auth/logout' }}>
          <LogOut />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Sign out</TooltipContent>
    </Tooltip>
  )
}

function TabView({ tab, superAdmin }: { tab: string; superAdmin: boolean }) {
  // Keyed so each tab mounts fresh, as before.
  const view = (() => {
    switch (tab) {
      case 'parties': return <Parties />
      case 'templates': return <Templates />
      case 'history': return <History />
      case 'users': return <Users />
      case 'audit': return <Audit />
      case 'admins': return <Admins superAdmin={superAdmin} />
      case 'games': return <Games />
      case 'settings': return <Settings />
      case 'rules': return <Rules />
      default: return <Dashboard />
    }
  })()
  return <Fragment key={tab}>{view}</Fragment>
}
