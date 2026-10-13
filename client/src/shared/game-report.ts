// What the client tells the Worker about a League game: that it started (so the
// party's history records it) and that it ended (so the Worker looks it up in
// Riot's match history right away instead of on its next sweep).

/** Gameflow phases right after a match ends. */
export const ENDED_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame'])

export interface GameReportState {
  reported: { region: string; gameId: number } | null  // last game reported as started
  endedSent: number                                    // gameId we've sent "ended" for
}

export type GameReportAction =
  | { kind: 'start'; region: string; gameId: number }
  | { kind: 'end'; region: string; gameId: number }
  | null

/**
 * The one message to send for this poll, if any. Starts are only reported
 * while in a party; the end goes out for the game we reported, once.
 */
export function nextGameReport(
  state: GameReportState, phase: string, region: string, gameId: number, inParty: boolean,
): GameReportAction {
  if (ENDED_PHASES.has(phase)) {
    const r = state.reported
    return r && state.endedSent !== r.gameId ? { kind: 'end', region: r.region, gameId: r.gameId } : null
  }
  if (phase !== 'InProgress' || !inParty || !region || !gameId) return null
  return state.reported?.gameId === gameId ? null : { kind: 'start', region, gameId }
}
