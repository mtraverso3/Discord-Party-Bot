// League game reporting: the desktop client tells us when a match starts (its
// gameId + region); we record it against the party's active history session and
// later fill in who played and which champions they picked from Match-v5.
//
// A just-started match isn't in Match-v5 yet, so reports land as `pending` and a
// cron sweep (resolvePendingGames) retries until the game finishes, then writes
// the participants. Reports that never resolve are aged out to `failed`.

import { RiotRateLimited, fetchMatch, matchIdForGame, platformForRegion } from '../lib/riot'

// Give up on a report the API never returns (custom games aren't indexed by
// Match-v5 at all, so those will always age out — expected).
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000
// Per 2-minute sweep. Riot's smallest key limit is 100 calls per 2 minutes,
// shared with live-game lookups, so this leaves room for those.
const RESOLVE_BATCH = 40
const RESOLVE_CONCURRENCY = 4
export const MAX_GAMES_PER_SESSION = 100
// A game shows up in Match-v5 shortly after it ends, so while it could still be
// running we check every sweep (just under 2 minutes, so a retry isn't pushed
// back a whole tick). Past that it's likely a custom game Riot never returns,
// so back off, doubling up to 4h, until it ages out.
const EARLY_WINDOW_MS = 2 * 60 * 60 * 1000
const EARLY_RETRY_MS = 110 * 1000
const RETRY_BASE_MS = 14 * 60 * 1000
const RETRY_MAX_MS = 4 * 60 * 60 * 1000

/** Delay before the next try after `attempts` misses, for a report `ageMs` old. */
export function retryDelayMs(attempts: number, ageMs = Infinity): number {
  if (ageMs < EARLY_WINDOW_MS) return EARLY_RETRY_MS
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(attempts - 1, 0), RETRY_MAX_MS)
}

export interface GameParticipant {
  puuid: string
  riotId: string
  championId: number
  championName: string
  teamId: number
  win: boolean | null
  subteam: number | null
  placement: number | null
  items: number[]      // final items, slot order, empty slots dropped
  augments: number[]   // Arena-style modes, pick order
}

interface ParticipantRow {
  game_row_id: number; puuid: string; riot_id: string
  champion_id: number; champion_name: string; team_id: number; win: number | null
  subteam: number | null; placement: number | null
  items: string | null; augments: string | null
}

/** A JSON id list column; rows stored before it existed read as empty. */
function idList(raw: string | null): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : []
  } catch {
    return []
  }
}

function toParticipant(p: ParticipantRow): GameParticipant {
  return {
    puuid: p.puuid,
    riotId: p.riot_id,
    championId: p.champion_id,
    championName: p.champion_name,
    teamId: p.team_id,
    win: p.win == null ? null : !!p.win,
    subteam: p.subteam,
    placement: p.placement,
    items: idList(p.items),
    augments: idList(p.augments),
  }
}

export interface PartyGame {
  id: number
  matchId: string
  region: string | null
  gameId: string
  reportedBy: string
  reportedAt: number
  status: 'pending' | 'resolved' | 'failed'
  resolvedAt?: number
  queueId?: number
  gameCreation?: number
  gameDuration?: number
  endResult?: string    // Riot's endOfGameResult, e.g. 'Abort_TooFewPlayers'
  error?: string
  participants: GameParticipant[]
}

export type ReportGameResult =
  | { ok: true; status: 'pending' | 'resolved'; matchId: string }
  | { ok: false; error: string }

export interface ReportGameInput {
  historyId: number
  guildId: string
  partyId: string
  region: string
  gameId: string
  reportedBy: string
}

/**
 * Record a match the client just saw for a party session. Idempotent per
 * (session, match): a second client reporting the same game is a no-op.
 */
export async function reportGame(db: D1Database, input: ReportGameInput): Promise<ReportGameResult> {
  const platform = platformForRegion(input.region)
  const matchId = matchIdForGame(input.region, input.gameId)
  if (!platform || !matchId) return { ok: false, error: `Unsupported region "${input.region}".` }
  if (!/^\d{1,20}$/.test(input.gameId)) return { ok: false, error: 'Invalid gameId.' }

  const res = await db.prepare(`
    INSERT INTO party_games (history_id, guild_id, party_id, match_id, platform, region, game_id, reported_by, reported_at, status)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending'
    WHERE (SELECT COUNT(*) FROM party_games WHERE history_id = ?1) < ?10
    ON CONFLICT (history_id, match_id) DO NOTHING
  `).bind(input.historyId, input.guildId, input.partyId, matchId, platform,
    input.region.toUpperCase(), input.gameId, input.reportedBy, Date.now(), MAX_GAMES_PER_SESSION).run()

  if (!res.meta.changes) {
    const known = await db.prepare('SELECT 1 FROM party_games WHERE history_id = ?1 AND match_id = ?2')
      .bind(input.historyId, matchId).first()
    if (!known) return { ok: false, error: 'This party has reported too many games.' }
  }
  return { ok: true, status: 'pending', matchId }
}

interface GameRow {
  id: number
  history_id: number
  match_id: string
  platform: string
  region: string | null
  game_id: string
  reported_by: string
  reported_at: number
  status: 'pending' | 'resolved' | 'failed'
  attempts: number
  resolved_at: number | null
  queue_id: number | null
  game_creation: number | null
  game_duration: number | null
  end_result: string | null
  error: string | null
}

/** All games recorded for a history session, newest first, with participants. */
export async function listGamesForHistory(db: D1Database, historyId: number): Promise<PartyGame[]> {
  const [{ results: games }, { results: parts }] = await Promise.all([
    db.prepare('SELECT * FROM party_games WHERE history_id = ?1 ORDER BY id DESC').bind(historyId).all<GameRow>(),
    db.prepare(`
      SELECT p.* FROM party_game_participants p
      JOIN party_games g ON g.id = p.game_row_id
      WHERE g.history_id = ?1
    `).bind(historyId).all<ParticipantRow>(),
  ])
  return games.map(g => ({
    id: g.id,
    matchId: g.match_id,
    region: g.region,
    gameId: g.game_id,
    reportedBy: g.reported_by,
    reportedAt: g.reported_at,
    status: g.status,
    resolvedAt: g.resolved_at ?? undefined,
    queueId: g.queue_id ?? undefined,
    gameCreation: g.game_creation ?? undefined,
    gameDuration: g.game_duration ?? undefined,
    endResult: g.end_result ?? undefined,
    error: g.error ?? undefined,
    participants: parts.filter(p => p.game_row_id === g.id).map(toParticipant),
  }))
}

/**
 * League games from every session a user took part in, newest first. A party's
 * reported games belong to whoever was in that party, so this is "the games
 * played in this member's parties" — the reverse index in user_igns then lets
 * the UI highlight which participant row is actually them.
 */
export async function listGamesForUser(
  db: D1Database, guildId: string, userId: string, limit = 50,
): Promise<PartyGame[]> {
  const { results: games } = await db.prepare(`
    SELECT g.* FROM party_games g
    WHERE g.guild_id = ?1
      AND EXISTS (
        SELECT 1 FROM party_history_events e
        WHERE e.history_id = g.history_id AND e.user_id = ?2
      )
    ORDER BY g.id DESC LIMIT ?3
  `).bind(guildId, userId, limit).all<GameRow>()
  if (games.length === 0) return []

  const { results: parts } = await db.prepare(`
    SELECT * FROM party_game_participants WHERE game_row_id IN (SELECT value FROM json_each(?1))
  `).bind(JSON.stringify(games.map(g => g.id))).all<ParticipantRow>()

  return games.map(g => ({
    id: g.id,
    matchId: g.match_id,
    region: g.region,
    gameId: g.game_id,
    reportedBy: g.reported_by,
    reportedAt: g.reported_at,
    status: g.status,
    resolvedAt: g.resolved_at ?? undefined,
    queueId: g.queue_id ?? undefined,
    gameCreation: g.game_creation ?? undefined,
    gameDuration: g.game_duration ?? undefined,
    endResult: g.end_result ?? undefined,
    error: g.error ?? undefined,
    participants: parts.filter(p => p.game_row_id === g.id).map(toParticipant),
  }))
}

/**
 * Cron: resolve pending game reports via Match-v5. Finished games get their
 * participants written and go `resolved`; games the API still can't return are
 * left pending (and aged out to `failed` after PENDING_MAX_AGE_MS). Requires
 * RIOT_API_KEY; a no-op without one. Returns how many resolved this pass.
 */
export async function resolvePendingGames(
  db: D1Database, riotApiKey: string | undefined, now = Date.now(),
): Promise<number> {
  if (!riotApiKey) return 0
  // Games that never resolved come before re-fetches of ones that did (e.g. a
  // migration's backfill), so a backfill never holds up new games.
  const { results } = await db.prepare(`
    SELECT * FROM party_games WHERE status = 'pending' AND next_attempt_at <= ?1
    ORDER BY resolved_at IS NOT NULL, next_attempt_at, id LIMIT ?2
  `).bind(now, RESOLVE_BATCH).all<GameRow>()
  return resolveGames(db, riotApiKey, results, now)
}

/**
 * The desktop client saw a game end: try it right away instead of waiting for
 * the next sweep. If Riot doesn't have it yet, the sweeps keep checking.
 */
export async function resolveEndedGame(
  db: D1Database, riotApiKey: string | undefined, guildId: string, matchId: string, now = Date.now(),
): Promise<number> {
  const { results } = await db.prepare(`
    SELECT * FROM party_games WHERE guild_id = ?1 AND match_id = ?2 AND status = 'pending'
  `).bind(guildId, matchId).all<GameRow>()
  if (!riotApiKey || results.length === 0) return 0
  return resolveGames(db, riotApiKey, results, now)
}

/** Looks the games up a few at a time, stopping early if Riot rate-limits us. */
async function resolveGames(db: D1Database, riotApiKey: string, rows: GameRow[], now: number): Promise<number> {
  let resolved = 0
  for (let i = 0; i < rows.length; i += RESOLVE_CONCURRENCY) {
    const outcomes = await Promise.all(rows.slice(i, i + RESOLVE_CONCURRENCY).map(g => resolveOne(db, riotApiKey, g, now)))
    resolved += outcomes.filter(o => o === 'resolved').length
    if (outcomes.includes('rate-limited')) {
      console.warn('Riot rate-limited the game resolver; the rest wait for the next sweep')
      break
    }
  }
  return resolved
}

async function resolveOne(
  db: D1Database, riotApiKey: string, g: GameRow, now: number,
): Promise<'resolved' | 'pending' | 'rate-limited'> {
  if (!g.region) { await failGame(db, g.id, 'no region recorded'); return 'pending' }
  try {
    const match = await fetchMatch(riotApiKey, g.region, g.match_id)
    if (!match) {
      // Not available yet. Retry next sweep, unless it's simply too old now.
      if (now - g.reported_at > PENDING_MAX_AGE_MS) {
        await failGame(db, g.id, 'match not found before timeout (custom game, or never finished)')
      } else {
        await retryLater(db, g, now)
      }
      return 'pending'
    }
    await db.batch([
      db.prepare(`
        UPDATE party_games
        SET status = 'resolved', resolved_at = ?2, queue_id = ?3, game_creation = ?4,
            game_duration = ?5, end_result = ?6, attempts = attempts + 1, error = NULL
        WHERE id = ?1
      `).bind(g.id, now, match.queueId, match.gameCreation, match.gameDuration, match.endResult),
      db.prepare('DELETE FROM party_game_participants WHERE game_row_id = ?1').bind(g.id),
      ...match.participants.map(p => db.prepare(`
        INSERT INTO party_game_participants
          (game_row_id, puuid, riot_id, champion_id, champion_name, team_id, win, subteam, placement, items, augments)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      `).bind(g.id, p.puuid, p.riotId, p.championId, p.championName, p.teamId, p.win ? 1 : 0, p.subteam, p.placement,
        JSON.stringify(p.items), JSON.stringify(p.augments))),
    ])
    return 'resolved'
  } catch (e) {
    // Rate limits aren't the game's fault: leave it due, without counting a try.
    if (e instanceof RiotRateLimited) return 'rate-limited'
    const msg = (e as Error).message.slice(0, 300)
    if (now - g.reported_at > PENDING_MAX_AGE_MS) {
      await failGame(db, g.id, msg)
    } else {
      await retryLater(db, g, now, msg)
    }
    return 'pending'
  }
}

async function retryLater(db: D1Database, g: GameRow, now: number, error?: string): Promise<void> {
  await db.prepare(`
    UPDATE party_games SET attempts = attempts + 1, next_attempt_at = ?2, error = COALESCE(?3, error)
    WHERE id = ?1
  `).bind(g.id, now + retryDelayMs(g.attempts + 1, now - g.reported_at), error ?? null).run()
}

/** Give up on a report. One that resolved before (a re-fetch) keeps what it had. */
async function failGame(db: D1Database, id: number, error: string): Promise<void> {
  await db.prepare(`
    UPDATE party_games SET status = CASE WHEN resolved_at IS NULL THEN 'failed' ELSE 'resolved' END,
      error = CASE WHEN resolved_at IS NULL THEN ?2 ELSE error END, attempts = attempts + 1
    WHERE id = ?1
  `).bind(id, error).run()
}
