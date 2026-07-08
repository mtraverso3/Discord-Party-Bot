// Party history: a durable record of every party lifetime and what happened in
// it, kept separately from the ephemeral `parties` table so it survives disband.
//
// The store/parties.ts mutations call the tiny `logEvent` / open / close helpers
// here so history is captured centrally, no matter which surface (slash command,
// admin panel, desktop client) drove the change. Logging is best-effort: a
// failed write is swallowed so it can never break the mutation that caused it.

import type { PartyData } from '../types'

export type HistoryEventKind =
  | 'created' | 'joined' | 'queued' | 'left' | 'dequeued' | 'removed'
  | 'promoted' | 'approved' | 'denied' | 'owner_changed'
  | 'closed' | 'opened' | 'game_changed' | 'banlist_set' | 'disbanded'

export interface HistoryEvent {
  ts: number
  event: HistoryEventKind
  userId?: string
  displayName?: string
  detail?: Record<string, unknown>
}

export interface HistorySession {
  historyId: number
  guildId: string
  partyId: string
  name: string
  game: string
  ownerId: string
  ownerName: string
  maxSize: number
  createdAt: number
  endedAt?: number
  endReason?: string
}

export interface HistorySummary extends HistorySession {
  eventCount: number
  gameCount: number
  participantCount: number  // distinct users seen in the session
}

interface SessionRow {
  history_id: number
  guild_id: string
  party_id: string
  name: string
  game: string
  owner_id: string
  owner_name: string
  max_size: number
  created_at: number
  ended_at: number | null
  end_reason: string | null
}

function toSession(r: SessionRow): HistorySession {
  return {
    historyId: r.history_id,
    guildId: r.guild_id,
    partyId: r.party_id,
    name: r.name,
    game: r.game,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    maxSize: r.max_size,
    createdAt: r.created_at,
    endedAt: r.ended_at ?? undefined,
    endReason: r.end_reason ?? undefined,
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

/** Open a history session for a freshly created party. Best-effort. */
export async function openSession(db: D1Database, party: PartyData): Promise<void> {
  try {
    const now = Date.now()
    const res = await db.prepare(`
      INSERT INTO party_history (guild_id, party_id, name, game, owner_id, owner_name, max_size, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
      RETURNING history_id
    `).bind(party.guildId, party.id, party.name, party.game, party.ownerId, party.ownerName,
      party.maxSize, party.createdAt || now).first<{ history_id: number }>()
    if (res) {
      await insertEvent(db, res.history_id, {
        ts: now, event: 'created', userId: party.ownerId, displayName: party.ownerName,
        detail: { name: party.name, game: party.game },
      })
    }
  } catch (e) {
    console.warn('history.openSession failed:', e)
  }
}

/** The active (not-yet-ended) session id for a party, or null. */
export async function activeSessionId(db: D1Database, guildId: string, partyId: string): Promise<number | null> {
  const row = await db.prepare(`
    SELECT history_id FROM party_history
    WHERE guild_id = ?1 AND party_id = ?2 AND ended_at IS NULL
    ORDER BY history_id DESC LIMIT 1
  `).bind(guildId, partyId).first<{ history_id: number }>()
  return row?.history_id ?? null
}

async function insertEvent(db: D1Database, historyId: number, e: HistoryEvent): Promise<void> {
  await db.prepare(`
    INSERT INTO party_history_events (history_id, ts, event, user_id, display_name, detail)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(historyId, e.ts, e.event, e.userId ?? null, e.displayName ?? null,
    e.detail ? JSON.stringify(e.detail) : null).run()
}

/** Append an event to a party's active session. Best-effort no-op if none. */
export async function logEvent(
  db: D1Database, guildId: string, partyId: string, event: HistoryEventKind,
  opts: { userId?: string; displayName?: string; detail?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    const historyId = await activeSessionId(db, guildId, partyId)
    if (historyId == null) return
    await insertEvent(db, historyId, { ts: Date.now(), event, ...opts })
  } catch (e) {
    console.warn('history.logEvent failed:', e)
  }
}

/** Log a `promoted` event for each user pulled out of the queue. */
export async function logPromotions(
  db: D1Database, guildId: string, partyId: string, promoted: string[], after: PartyData,
): Promise<void> {
  for (const uid of promoted) {
    const name = after.members.find(m => m.userId === uid)?.displayName
    await logEvent(db, guildId, partyId, 'promoted', { userId: uid, displayName: name })
  }
}

/** Close a party's active session, recording the reason. Best-effort. */
export async function closeSession(
  db: D1Database, guildId: string, partyId: string, reason: string,
): Promise<void> {
  try {
    const historyId = await activeSessionId(db, guildId, partyId)
    if (historyId == null) return
    const now = Date.now()
    await insertEvent(db, historyId, { ts: now, event: 'disbanded', detail: { reason } })
    await db.prepare('UPDATE party_history SET ended_at = ?2, end_reason = ?3 WHERE history_id = ?1')
      .bind(historyId, now, reason).run()
  } catch (e) {
    console.warn('history.closeSession failed:', e)
  }
}

// ── Reads (admin API) ────────────────────────────────────────────────────────

export async function listSessions(
  db: D1Database, guildId: string, limit = 100, offset = 0,
): Promise<HistorySummary[]> {
  const { results } = await db.prepare(`
    SELECT h.*,
      (SELECT COUNT(*) FROM party_history_events e WHERE e.history_id = h.history_id) AS event_count,
      (SELECT COUNT(*) FROM party_games g WHERE g.history_id = h.history_id) AS game_count,
      (SELECT COUNT(DISTINCT e.user_id) FROM party_history_events e
         WHERE e.history_id = h.history_id AND e.user_id IS NOT NULL) AS participant_count
    FROM party_history h
    WHERE h.guild_id = ?1
    ORDER BY h.history_id DESC
    LIMIT ?2 OFFSET ?3
  `).bind(guildId, limit, offset).all<SessionRow & {
    event_count: number; game_count: number; participant_count: number
  }>()
  return results.map(r => ({
    ...toSession(r),
    eventCount: r.event_count,
    gameCount: r.game_count,
    participantCount: r.participant_count,
  }))
}

export interface UserHistorySession extends HistorySession {
  gameCount: number
  wasOwner: boolean    // did the user own the party (finally) in this session
  firstSeenAt: number  // their earliest event in the session
  lastSeenAt: number   // their latest event in the session
}

/**
 * Every session a user took part in, newest first. "Took part" means they
 * appear as the subject of at least one event (created/joined/queued/…), which
 * also covers owners. Includes their first/last activity timestamps within the
 * session so the profile can show when they were around.
 */
export async function listSessionsForUser(
  db: D1Database, guildId: string, userId: string, limit = 200,
): Promise<UserHistorySession[]> {
  const { results } = await db.prepare(`
    SELECT h.*,
      (SELECT COUNT(*) FROM party_games g WHERE g.history_id = h.history_id) AS game_count,
      ue.first_ts, ue.last_ts
    FROM party_history h
    JOIN (
      SELECT history_id, MIN(ts) AS first_ts, MAX(ts) AS last_ts
      FROM party_history_events WHERE user_id = ?2
      GROUP BY history_id
    ) ue ON ue.history_id = h.history_id
    WHERE h.guild_id = ?1
    ORDER BY h.history_id DESC
    LIMIT ?3
  `).bind(guildId, userId, limit).all<SessionRow & {
    game_count: number; first_ts: number; last_ts: number
  }>()
  return results.map(r => ({
    ...toSession(r),
    gameCount: r.game_count,
    wasOwner: r.owner_id === userId,
    firstSeenAt: r.first_ts,
    lastSeenAt: r.last_ts,
  }))
}

export async function getSession(
  db: D1Database, guildId: string, historyId: number,
): Promise<HistorySession | null> {
  const row = await db.prepare('SELECT * FROM party_history WHERE guild_id = ?1 AND history_id = ?2')
    .bind(guildId, historyId).first<SessionRow>()
  return row ? toSession(row) : null
}

export async function getSessionEvents(db: D1Database, historyId: number): Promise<HistoryEvent[]> {
  const { results } = await db.prepare(`
    SELECT ts, event, user_id, display_name, detail
    FROM party_history_events WHERE history_id = ?1 ORDER BY id
  `).bind(historyId).all<{
    ts: number; event: HistoryEventKind; user_id: string | null
    display_name: string | null; detail: string | null
  }>()
  return results.map(r => ({
    ts: r.ts,
    event: r.event,
    userId: r.user_id ?? undefined,
    displayName: r.display_name ?? undefined,
    detail: r.detail ? safeParse(r.detail) : undefined,
  }))
}

function safeParse(s: string): Record<string, unknown> | undefined {
  try { return JSON.parse(s) } catch { return undefined }
}
