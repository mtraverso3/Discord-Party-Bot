import { describe, expect, it } from 'vitest'
import { parseChampSelect } from '../src/main/lcu'

/** A completed ban action as the client reports it for the local team. */
const allyBan = (championId: number) => ({ type: 'ban', completed: true, championId, isAllyAction: true })
/** A completed enemy ban: the client zeroes the id here and reveals it via `bans`. */
const hiddenEnemyBan = () => ({ type: 'ban', completed: true, championId: 0, isAllyAction: false })

describe('parseChampSelect — bans', () => {
  it('reads bans from the actions list', () => {
    const data = parseChampSelect({ actions: [[allyBan(238), allyBan(64)]] })
    expect(data.bannedIds.sort((a, b) => a - b)).toEqual([64, 238])
    expect(data.banPhaseDone).toBe(true)
  })

  it('picks up enemy bans the actions list hides behind championId 0', () => {
    const data = parseChampSelect({
      actions: [[allyBan(238), hiddenEnemyBan(), hiddenEnemyBan()]],
      bans: { myTeamBans: [238], theirTeamBans: [16, 12], numBans: 3 },
    })
    expect(data.bannedIds.sort((a, b) => a - b)).toEqual([12, 16, 238])
  })

  it('accepts ban arrays of {championId} objects and ignores unrevealed padding', () => {
    const data = parseChampSelect({
      bans: { myTeamBans: [{ championId: 238 }, { championId: 0 }], theirTeamBans: [-1, 16], numBans: 4 },
    })
    expect(data.bannedIds.sort((a, b) => a - b)).toEqual([16, 238])
  })

  it('does not count a hovered-but-unlocked ban', () => {
    const data = parseChampSelect({
      actions: [[{ type: 'ban', completed: false, championId: 238 }]],
    })
    expect(data.bannedIds).toEqual([])
    expect(data.banPhaseDone).toBe(false)
  })

  it('stays in progress while any ban action is pending', () => {
    const data = parseChampSelect({
      actions: [[allyBan(238), { type: 'ban', completed: false, championId: 0 }]],
      bans: { myTeamBans: [238], theirTeamBans: [], numBans: 2 },
    })
    expect(data.banPhaseDone).toBe(false)
  })

  it('falls back to numBans when the client exposes no ban actions', () => {
    const body = { bans: { myTeamBans: [238, 64], theirTeamBans: [16], numBans: 4 } }
    expect(parseChampSelect(body).banPhaseDone).toBe(false)
    expect(parseChampSelect({ bans: { ...body.bans, numBans: 3 } }).banPhaseDone).toBe(true)
  })

  it('de-duplicates ids reported through both routes', () => {
    const data = parseChampSelect({
      actions: [[allyBan(238)]],
      bans: { myTeamBans: [238], theirTeamBans: [], numBans: 1 },
    })
    expect(data.bannedIds).toEqual([238])
  })

  it('survives a missing or malformed session body', () => {
    for (const body of [undefined, null, {}, { actions: 'nope', bans: 7 }]) {
      expect(parseChampSelect(body)).toEqual({ picks: [], bannedIds: [], banPhaseDone: false })
    }
  })
})

describe('parseChampSelect — picks', () => {
  it('collects locked and hovered picks from both teams, skipping empty cells', () => {
    const data = parseChampSelect({
      myTeam: [{ puuid: 'a', championId: 238 }, { puuid: 'b', championId: 0, championPickIntent: 64 }],
      theirTeam: [{ puuid: 'c', championId: 16 }, { puuid: '', championId: 99 }, { championId: 99 }],
    })
    expect(data.picks).toEqual([
      { puuid: 'a', championId: 238 },
      { puuid: 'b', championId: 64 },
      { puuid: 'c', championId: 16 },
    ])
  })
})
