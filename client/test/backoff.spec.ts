import { describe, expect, it } from 'vitest'
import { DEFAULT_WAIT_MS, waitMessage, waitUntil } from '../src/shared/backoff'

describe('waitUntil', () => {
  it('only asks to wait on a 429, or a 503 that says when to come back', () => {
    for (const status of [200, 401, 403, 404, 500, 502]) expect(waitUntil(status, '60', 1000)).toBeNull()
    expect(waitUntil(503, null, 1000)).toBeNull()
    expect(waitUntil(503, '20', 1000)).toBe(21_000)
  })

  it('says why it is waiting', () => {
    expect(waitMessage(429)).toContain('busy')
    expect(waitMessage(503)).toContain('updating')
  })

  it('honours Retry-After', () => {
    expect(waitUntil(429, '30', 1000)).toBe(31_000)
  })

  it('falls back to a default when Retry-After is missing or junk', () => {
    expect(waitUntil(429, null, 1000)).toBe(1000 + DEFAULT_WAIT_MS)
    expect(waitUntil(429, 'soon', 1000)).toBe(1000 + DEFAULT_WAIT_MS)
    expect(waitUntil(429, '0', 1000)).toBe(1000 + DEFAULT_WAIT_MS)
  })

  it('never waits more than ten minutes', () => {
    expect(waitUntil(429, '86400', 0)).toBe(10 * 60_000)
  })
})
