import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { api } from '../api'
import { useConfirm } from '../components/Confirm'
import { useToast } from '../components/Toast'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorNote, Input, Spinner, Switch } from '../components/ui'
import { GAME_NAME_MAX, MAX_CUSTOM_GAMES, MAX_ENABLED_GAMES, cleanGameName, enabledGames, guildGames, isBuiltinGame } from '../games'
import { useGuildData } from '../lib/guildData'
import { useLoad } from '../lib/useLoad'
import type { GuildSettings } from '../types'

export function Games() {
  const guildData = useGuildData()
  const { data: settings, setData: setSettings, error } = useLoad(() => guildData.getSettings(true))
  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!settings) return <Spinner />
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
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Game list</CardTitle>
          <CardDescription>
            Members pick from the enabled games when they create or edit a party, and set an IGN for any of them.
            Changes save immediately. Discord allows at most {MAX_ENABLED_GAMES} enabled at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{enabledCount}</span> of {games.length} enabled
          </div>
          <ul className="divide-y rounded-md border">
            {games.map(g => {
              const builtin = isBuiltinGame(g)
              const on = !settings.disabledGames.includes(g)
              return (
                <li key={g} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <Switch
                    checked={on}
                    disabled={busy}
                    onCheckedChange={v => toggle(g, v)}
                    aria-label={`${on ? 'Disable' : 'Enable'} ${g}`}
                  />
                  <span className={on ? 'font-medium' : 'text-muted-foreground'}>{g}</span>
                  {g.startsWith('LoL ') && (
                    <Badge variant="outline" title="Desktop client lobby tools and match tracking work with League games">
                      League features
                    </Badge>
                  )}
                  <span className="grow" />
                  {builtin ? (
                    <Badge variant="secondary">Built-in</Badge>
                  ) : (
                    <>
                      <Badge variant="outline">Custom</Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        title={`Remove ${g}`}
                        aria-label={`Remove ${g}`}
                        onClick={() => remove(g)}
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add a game</CardTitle>
          <CardDescription>
            Custom games belong to this server only. Up to {MAX_CUSTOM_GAMES}; names up to {GAME_NAME_MAX} characters.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); add() }}>
            <Input
              value={newGame}
              maxLength={GAME_NAME_MAX}
              placeholder={atCustomLimit ? 'Custom game limit reached' : 'e.g. Deadlock'}
              disabled={atCustomLimit}
              onChange={e => setNewGame(e.target.value)}
            />
            <Button type="submit" busy={busy} disabled={atCustomLimit || !cleanGameName(newGame)}>
              <Plus /> Add
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
