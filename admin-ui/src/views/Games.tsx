import { Gamepad2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { useConfirm } from '../components/Confirm'
import { useToast } from '../components/Toast'
import { ErrorNote, PageSkeleton } from '../components/common'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Progress } from '../components/ui/progress'
import { Switch } from '../components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { GAME_NAME_MAX, MAX_CUSTOM_GAMES, MAX_ENABLED_GAMES, cleanGameName, enabledGames, guildGames, isBuiltinGame } from '../games'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import { cn } from '@/lib/utils'
import type { GuildSettings } from '../types'

export function Games() {
  const guildData = useGuildData()
  const { data: settings, setData: setSettings, error } = useLoad(() => guildData.getSettings(true))
  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!settings) return <PageSkeleton rows={6} />
  return <GameManager settings={settings} onSaved={s => { guildData.setSettings(s); setSettings(s) }} />
}

function GameManager({ settings, onSaved }: { settings: GuildSettings; onSaved: (s: GuildSettings) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [newGame, setNewGame] = useState('')

  const games = guildGames(settings)
  const enabledCount = enabledGames(settings).length

  // Every change saves straight away; only the game fields are sent, so this
  // never clobbers the Settings tab.
  const save = async (patch: Pick<GuildSettings, 'customGames' | 'disabledGames'>, okMsg: string) => {
    setBusy(true)
    try {
      onSaved(await api<GuildSettings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }))
      toast(okMsg)
      return true
    } catch (e) {
      toast((e as Error).message, 'err')
      return false
    } finally {
      setBusy(false)
    }
  }

  const toggle = (game: string, on: boolean) => save({
    customGames: settings.customGames,
    disabledGames: on ? settings.disabledGames.filter(g => g !== game) : [...settings.disabledGames, game],
  }, `${game} ${on ? 'enabled' : 'disabled'}`)

  const add = async () => {
    const name = cleanGameName(newGame)
    if (!name) return
    if (games.some(g => g.toLowerCase() === name.toLowerCase())) return toast(`${name} is already on the list`, 'err')
    if (await save({ customGames: [...settings.customGames, name], disabledGames: settings.disabledGames }, `${name} added`)) {
      setNewGame('')
    }
  }

  const remove = async (game: string) => {
    if (!(await confirm(`Remove ${game}? Parties and templates already using it keep it, but nobody can pick it for a new party.`, 'Remove'))) return
    await save({
      customGames: settings.customGames.filter(g => g !== game),
      disabledGames: settings.disabledGames.filter(g => g !== game),
    }, `${game} removed`)
  }

  const atCustomLimit = settings.customGames.length >= MAX_CUSTOM_GAMES

  return (
    <div className="max-w-3xl">
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="border-b py-5 [.border-b]:pb-5">
          <CardTitle>Game list</CardTitle>
          <CardDescription>
            Members pick from the enabled games when they create or edit a party, and set an IGN for any of them.
            Changes save immediately.
          </CardDescription>
          <CardAction className="text-right">
            <div className="text-sm font-medium tabular-nums">{enabledCount} <span className="text-muted-foreground">/ {MAX_ENABLED_GAMES}</span></div>
            <div className="text-xs text-muted-foreground">enabled</div>
          </CardAction>
          <Progress
            value={(enabledCount / MAX_ENABLED_GAMES) * 100}
            className="col-span-full mt-2 h-1"
            indicatorClassName={enabledCount >= MAX_ENABLED_GAMES ? 'bg-warning' : undefined}
          />
        </CardHeader>
        <ul className="divide-y">
          {games.map(g => {
            const builtin = isBuiltinGame(g)
            const on = !settings.disabledGames.includes(g)
            return (
              <li key={g} className="flex items-center gap-3 px-6 py-3 text-sm transition-colors hover:bg-accent/30">
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-md border', on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                  <Gamepad2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className={cn('truncate', on ? 'font-medium' : 'text-muted-foreground')}>{g}</div>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    <Badge variant={builtin ? 'secondary' : 'outline'} className="px-1.5 py-0 text-[0.65rem]">{builtin ? 'Built-in' : 'Custom'}</Badge>
                    {g.startsWith('LoL ') && (
                      <Badge variant="primary" className="px-1.5 py-0 text-[0.65rem]" title="Desktop client lobby tools and match tracking work with League games">
                        League features
                      </Badge>
                    )}
                  </div>
                </div>
                {!builtin && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hover:text-destructive"
                        disabled={busy}
                        aria-label={`Remove ${g}`}
                        onClick={() => remove(g)}
                      >
                        <Trash2 />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Remove {g}</TooltipContent>
                  </Tooltip>
                )}
                <Switch
                  checked={on}
                  disabled={busy}
                  onCheckedChange={v => toggle(g, v)}
                  aria-label={`${on ? 'Disable' : 'Enable'} ${g}`}
                />
              </li>
            )
          })}
        </ul>
        <CardFooter className="flex-col items-stretch gap-2 border-t bg-muted/20 py-5 [.border-t]:pt-5">
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); add() }}>
            <Input
              value={newGame}
              maxLength={GAME_NAME_MAX}
              placeholder={atCustomLimit ? 'Custom game limit reached' : 'Add a custom game, e.g. Deadlock'}
              disabled={atCustomLimit}
              onChange={e => setNewGame(e.target.value)}
            />
            <Button type="submit" busy={busy} disabled={atCustomLimit || !cleanGameName(newGame)}>
              {!busy && <Plus />}Add game
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Custom games belong to this server only — {settings.customGames.length} of {MAX_CUSTOM_GAMES} used; names up to {GAME_NAME_MAX} characters.
          </p>
        </CardFooter>
      </Card>
    </div>
  )
}
