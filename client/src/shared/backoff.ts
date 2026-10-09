// How the client backs off when PartyBot rate-limits it or is mid-update.

export const DEFAULT_WAIT_MS = 60_000
const MAX_WAIT_MS = 10 * 60_000
export const BUSY_MESSAGE = 'PartyBot is busy, retrying shortly…'
export const UPDATING_MESSAGE = 'PartyBot is updating, retrying shortly…'

/**
 * When to contact PartyBot again after a response, or null if it isn't asking
 * us to wait: a 429, or a 503 that says when to come back (maintenance).
 */
export function waitUntil(status: number, retryAfter: string | null, now: number): number | null {
  if (status !== 429 && !(status === 503 && retryAfter)) return null
  const seconds = Number(retryAfter)
  const ms = Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_WAIT_MS) : DEFAULT_WAIT_MS
  return now + ms
}

/** What to show while waiting after `status`. */
export function waitMessage(status: number): string {
  return status === 503 ? UPDATING_MESSAGE : BUSY_MESSAGE
}
