import { GAMES as GAME_DEFS } from '../../src/lib/games'

// Single source of truth shared with the Worker — bundled at build time.
export const GAMES: string[] = GAME_DEFS.map(g => g.value)
