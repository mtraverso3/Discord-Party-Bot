import { describe, expect, it } from 'vitest'
import {
  LIVE_ERROR_BACKOFF_MS, LIVE_RETRY_MS, needsLiveFetch, nextLiveCache,
} from '../src/shared/live-cache'

const pick = { riotId: 'Me#NA1', championId: 1, teamId: 100 }

describe('live game cache', () => {
  it('fetches when nothing is cached', () => {
    expect(needsLiveFetch(null, 1, 0)).toBe(true)
  })

  it('reuses a live result for the rest of the game', () => {
    const cache = nextLiveCache(1, { ok: true, live: true, participants: [pick] }, 0)
    expect(needsLiveFetch(cache, 1, 3_000)).toBe(false)
    expect(needsLiveFetch(cache, 1, 60 * 60_000)).toBe(false)
    expect(cache.participants).toEqual([pick])
  })

  it('retries a not-live result only after the retry interval', () => {
    const cache = nextLiveCache(1, { ok: true, live: false, participants: [] }, 0)
    expect(needsLiveFetch(cache, 1, 3_000)).toBe(false)
    expect(needsLiveFetch(cache, 1, LIVE_RETRY_MS - 1)).toBe(false)
    expect(needsLiveFetch(cache, 1, LIVE_RETRY_MS)).toBe(true)
  })

  it('backs off longer after a failed lookup', () => {
    const cache = nextLiveCache(1, { ok: false, live: false, participants: [] }, 0)
    expect(LIVE_ERROR_BACKOFF_MS).toBeGreaterThanOrEqual(60_000)
    expect(needsLiveFetch(cache, 1, LIVE_RETRY_MS)).toBe(false)
    expect(needsLiveFetch(cache, 1, LIVE_ERROR_BACKOFF_MS - 1)).toBe(false)
    expect(needsLiveFetch(cache, 1, LIVE_ERROR_BACKOFF_MS)).toBe(true)
    expect(cache.participants).toEqual([])
  })

  it('refetches as soon as the gameId changes', () => {
    const live = nextLiveCache(1, { ok: true, live: true, participants: [pick] }, 0)
    const failed = nextLiveCache(1, { ok: false, live: false, participants: [] }, 0)
    expect(needsLiveFetch(live, 2, 1)).toBe(true)
    expect(needsLiveFetch(failed, 2, 1)).toBe(true)
  })
})
