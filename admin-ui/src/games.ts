import { enabledGames, guildGames, type GameSettings } from '../../src/lib/games'

// Single source of truth shared with the Worker — bundled at build time.
export {
  BUILTIN_GAMES, GAME_NAME_MAX, MAX_CUSTOM_GAMES, MAX_ENABLED_GAMES,
  cleanGameName, enabledGames, guildGames, isBuiltinGame,
} from '../../src/lib/games'

const NO_SETTINGS: GameSettings = { customGames: [], disabledGames: [] }

/** Enabled games for a party/template picker, keeping `current` even if it's since been switched off. */
export function gameChoices(settings: GameSettings | null, current?: string): string[] {
  const games = enabledGames(settings ?? NO_SETTINGS)
  return current && !games.includes(current) ? [current, ...games] : games
}

/** The default pick for a new party: "Other" if enabled, else the first enabled game. */
export function defaultGame(settings: GameSettings | null): string {
  const games = enabledGames(settings ?? NO_SETTINGS)
  return games.includes('Other') ? 'Other' : games[0] ?? 'Other'
}

/** Every game the guild knows about, enabled or not (e.g. for IGN profiles). */
export function allGames(settings: GameSettings | null): string[] {
  return guildGames(settings ?? NO_SETTINGS)
}
