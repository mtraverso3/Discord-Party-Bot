/**
 * The game catalog. Every guild sees the built-in games below plus any custom
 * games its admins add in the dashboard, minus the ones they've switched off.
 *
 * Pure (no D1, no Discord) so the admin UI can bundle it too.
 */

/**
 * Built in for every guild. The League entries come first: the desktop client
 * auto-switches a party to these exact names from the connected account's
 * region, and IGNs are stored against them, so never rename a value here.
 */
export const BUILTIN_GAMES = [
  'LoL NA',
  'LoL EUW',
  'LoL PBE',
  'Valorant',
  'Overwatch',
  'Starcraft 2',
  'Other',
] as const

/** Discord select menus (the create/edit modal's game picker) cap out at 25 options. */
export const MAX_ENABLED_GAMES = 25
export const MAX_CUSTOM_GAMES = 25
export const GAME_NAME_MAX = 50

/** The settings fields the catalog reads; GuildSettings satisfies this. */
export interface GameSettings {
  customGames: string[]
  disabledGames: string[]
}

const BUILTIN_LOWER = new Set<string>(BUILTIN_GAMES.map(g => g.toLowerCase()))

export function isBuiltinGame(name: string): boolean {
  return (BUILTIN_GAMES as readonly string[]).includes(name)
}

/**
 * Normalize an admin-typed custom game name: collapse whitespace, drop control
 * characters, cap the length. Returns '' if nothing usable is left.
 */
export function cleanGameName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GAME_NAME_MAX)
    .trim()
}

/**
 * Sanitize a submitted custom-game list: cleaned, deduplicated
 * case-insensitively, never shadowing a built-in, and capped.
 */
export function sanitizeCustomGames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>(BUILTIN_LOWER)
  const out: string[] = []
  for (const item of raw) {
    const name = cleanGameName(item)
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
    if (out.length >= MAX_CUSTOM_GAMES) break
  }
  return out
}

/** Every game this guild knows about, enabled or not: built-ins, then custom, with "Other" last. */
export function guildGames(settings: GameSettings): string[] {
  const builtins = BUILTIN_GAMES.filter(g => g !== 'Other')
  return [...builtins, ...settings.customGames, 'Other']
}

/** The games members can pick for a party in this guild. */
export function enabledGames(settings: GameSettings): string[] {
  return guildGames(settings).filter(g => !settings.disabledGames.includes(g))
}

export function isKnownGame(settings: GameSettings, game: string): boolean {
  return guildGames(settings).includes(game)
}

export function gameAllowed(settings: GameSettings, game: string): boolean {
  return isKnownGame(settings, game) && !settings.disabledGames.includes(game)
}

/** Case-insensitive lookup of a typed game name to its canonical spelling. */
export function resolveGameName(settings: GameSettings, typed: string): string | null {
  const key = typed.trim().toLowerCase()
  return guildGames(settings).find(g => g.toLowerCase() === key) ?? null
}
