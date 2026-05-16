export const GAMES = [
  { name: 'LoL NA', value: 'LoL NA' },
  { name: 'LoL PBE', value: 'LoL PBE' },
  { name: 'Starcraft 2', value: 'Starcraft 2' },
  { name: 'Valorant', value: 'Valorant' },
  { name: 'Overwatch 2', value: 'Overwatch 2' },
  { name: 'Other', value: 'Other' },
] as const

export const GAME_EMOJI: Record<string, string> = {
  'LoL NA': '⚔️',
  'LoL PBE': '⚔️',
  'Starcraft 2': '🌌',
  'Valorant': '🔫',
  'Overwatch 2': '🦸',
  'Other': '🎮',
}
