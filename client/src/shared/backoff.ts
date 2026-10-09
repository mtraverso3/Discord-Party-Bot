// How the client backs off when PartyBot rate-limits it.

export const DEFAULT_WAIT_MS = 60_000
const MAX_WAIT_MS = 10 * 60_000
export const BUSY_MESSAGE = 'PartyBot is busy, retrying shortly…'

/** When to contact PartyBot again after a response, or null if it isn't asking us to wait. */
export function waitUntil(status: number, retryAfter: string | null, now: number): number | null {
  if (status !== 429) return null
  const seconds = Number(retryAfter)
  const ms = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_WAIT_MS) : DEFAULT_WAIT_MS
  return now + ms
}
