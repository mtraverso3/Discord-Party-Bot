// Maintenance mode: while a deploy runs a migration the live code can't
// survive, PartyBot answers "updating, try again shortly" instead of failing.
// The Deploy workflow sets `maintenance_until` in system_state before migrating
// and clears it after; it also expires on its own if a deploy dies halfway.

export const MAINTENANCE_MESSAGE = 'PartyBot is updating. Try again in a minute.'

// Read at most this often per isolate, so the check costs next to nothing.
const CACHE_MS = 5_000
let cached: { at: number; until: number } | null = null

export function resetMaintenanceCache(): void {
  cached = null
}

/** Epoch ms until which maintenance is on, or 0. Never throws: an unreadable flag means off. */
export async function maintenanceUntil(db: D1Database, now = Date.now()): Promise<number> {
  if (cached && now - cached.at < CACHE_MS) return cached.until
  const row = await db.prepare("SELECT value FROM system_state WHERE key = 'maintenance_until'")
    .first<{ value: string }>().catch(() => null)
  const until = Number(row?.value) || 0
  cached = { at: now, until }
  return until
}

/** The 503 the HTTP APIs answer with while maintenance is on, or null. */
export async function maintenanceResponse(db: D1Database, now = Date.now()): Promise<Response | null> {
  const until = await maintenanceUntil(db, now)
  if (until <= now) return null
  const retryAfter = Math.max(5, Math.ceil((until - now) / 1000))
  return Response.json(
    { ok: false, error: MAINTENANCE_MESSAGE },
    { status: 503, headers: { 'Retry-After': String(retryAfter) } },
  )
}

/** What an interaction gets back while maintenance is on, or null. */
export async function maintenanceInteraction(db: D1Database, type: number, now = Date.now()): Promise<Response | null> {
  if (type === 1 || (await maintenanceUntil(db, now)) <= now) return null
  if (type === 4) return Response.json({ type: 8, data: { choices: [] } })
  return Response.json({ type: 4, data: { content: MAINTENANCE_MESSAGE, flags: 64 } })
}
