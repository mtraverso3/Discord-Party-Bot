// When to re-ask the Worker for the live game while a match is in progress.
// Picks are final once a game starts, so a live result is kept for the whole
// game; "not live yet" and failures are retried on a slower cadence.

export const LIVE_RETRY_MS = 30_000
export const LIVE_ERROR_BACKOFF_MS = 60_000

export interface LiveResult<P> {
  ok: boolean
  live: boolean
  participants: P[]
}

export interface LiveCache<P> {
  gameId: number
  live: boolean
  participants: P[]
  retryAt: number
}

export function needsLiveFetch<P>(cache: LiveCache<P> | null, gameId: number, now: number): boolean {
  if (!cache || cache.gameId !== gameId) return true
  return !cache.live && now >= cache.retryAt
}

export function nextLiveCache<P>(gameId: number, result: LiveResult<P>, now: number): LiveCache<P> {
  if (!result.ok) return { gameId, live: false, participants: [], retryAt: now + LIVE_ERROR_BACKOFF_MS }
  return { gameId, live: result.live, participants: result.participants, retryAt: now + LIVE_RETRY_MS }
}
