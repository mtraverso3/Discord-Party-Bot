import { describe, expect, it } from 'vitest'
import { nextGameReport, type GameReportState } from '../src/shared/game-report'

const fresh: GameReportState = { reported: null, endedSent: 0 }
const reported: GameReportState = { reported: { region: 'NA', gameId: 42 }, endedSent: 0 }

describe('game reports', () => {
  it('reports a game starting while in a party', () => {
    expect(nextGameReport(fresh, 'InProgress', 'NA', 42, true)).toEqual({ kind: 'start', region: 'NA', gameId: 42 })
  })

  it("doesn't report a start outside a party, before the game id is known, or twice", () => {
    expect(nextGameReport(fresh, 'InProgress', 'NA', 42, false)).toBeNull()
    expect(nextGameReport(fresh, 'InProgress', 'NA', 0, true)).toBeNull()
    expect(nextGameReport(reported, 'InProgress', 'NA', 42, true)).toBeNull()
  })

  it('reports the end of the game it reported, once, even after leaving the party', () => {
    expect(nextGameReport(reported, 'WaitingForStats', 'NA', 0, false)).toEqual({ kind: 'end', region: 'NA', gameId: 42 })
    expect(nextGameReport({ ...reported, endedSent: 42 }, 'EndOfGame', 'NA', 0, true)).toBeNull()
  })

  it('has no end to report for a game it never reported', () => {
    expect(nextGameReport(fresh, 'EndOfGame', 'NA', 42, true)).toBeNull()
  })

  it('stays quiet outside of games', () => {
    expect(nextGameReport(reported, 'Lobby', 'NA', 0, true)).toBeNull()
    expect(nextGameReport(reported, 'ChampSelect', 'NA', 0, true)).toBeNull()
  })
})
