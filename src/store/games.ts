// League game reporting: the desktop client tells us when a match starts (its
// gameId + region); we record it against the party's active history session and
// later fill in who played and which champions they picked from Match-v5.
//
// A just-started match isn't in Match-v5 yet, so reports land as `pending` and a
// cron sweep (resolvePendingGames) retries until the game finishes, then writes
// the participants. Reports that never resolve are aged out to `failed`.

import { fetchMatch, matchIdForGame, platformForRegion } from '../lib/riot'

// Give up on a report the API never returns (custom games aren't indexed by
// Match-v5 at all, so those will always age out — expected).
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000
const RESOLVE_BATCH = 20

export interface GameParticipant {
  puuid: string
  riotId: string
  championId: number
  championName: string
  teamId: number
  win: boolean | null
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

  await db.prepare(`
    INSERT INTO party_games (history_id, guild_id, party_id, match_id, platform, region, game_id, reported_by, reported_at, status)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending')
    ON CONFLICT (history_id, match_id) DO NOTHING
  `).bind(input.historyId, input.guildId, input.partyId, matchId, platform,
    input.region.toUpperCase(), input.gameId, input.reportedBy, Date.now()).run()

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
  resolved_at: number | null
  queue_id: number | null
  game_creation: number | null
  game_duration: number | null
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
    `).bind(historyId).all<{
      game_row_id: number; puuid: string; riot_id: string
      champion_id: number; champion_name: string; team_id: number; win: number | null
    }>(),
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
    error: g.error ?? undefined,
    participants: parts.filter(p => p.game_row_id === g.id).map(p => ({
      puuid: p.puuid,
      riotId: p.riot_id,
      championId: p.champion_id,
      championName: p.champion_name,
      teamId: p.team_id,
      win: p.win == null ? null : !!p.win,
    })),
  }))
}

/**
 * Cron: resolve pending game reports via Match-v5. Finished games get their
 * participants written and go `resolved`; games the API still can't return are
 * left pending (and aged out to `failed` after PENDING_MAX_AGE_MS). Requires
 * RIOT_API_KEY; a no-op without one. Returns how many resolved this pass.
 */
export async function resolvePendingGames(db: D1Database, riotApiKey: string | undefined): Promise<number> {
  if (!riotApiKey) return 0
  const { results } = await db.prepare(
    "SELECT * FROM party_games WHERE status = 'pending' ORDER BY id LIMIT ?1",
  ).bind(RESOLVE_BATCH).all<GameRow>()

  const now = Date.now()
  let resolved = 0
  for (const g of results) {
    if (!g.region) { await failGame(db, g.id, 'no region recorded'); continue }
    try {
      const match = await fetchMatch(riotApiKey, g.region, g.match_id)
      if (!match) {
        // Not available yet. Retry next sweep, unless it's simply too old now.
        if (now - g.reported_at > PENDING_MAX_AGE_MS) {
          await failGame(db, g.id, 'match not found before timeout (custom game, or never finished)')
        } else {
          await db.prepare('UPDATE party_games SET attempts = attempts + 1 WHERE id = ?1').bind(g.id).run()
        }
        continue
      }
      await db.batch([
        db.prepare(`
          UPDATE party_games
          SET status = 'resolved', resolved_at = ?2, queue_id = ?3, game_creation = ?4,
              game_duration = ?5, attempts = attempts + 1, error = NULL
          WHERE id = ?1
        `).bind(g.id, now, match.queueId, match.gameCreation, match.gameDuration),
        db.prepare('DELETE FROM party_game_participants WHERE game_row_id = ?1').bind(g.id),
        ...match.participants.map(p => db.prepare(`
          INSERT INTO party_game_participants (game_row_id, puuid, riot_id, champion_id, champion_name, team_id, win)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        `).bind(g.id, p.puuid, p.riotId, p.championId, p.championName, p.teamId, p.win ? 1 : 0)),
      ])
      resolved++
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300)
      if (now - g.reported_at > PENDING_MAX_AGE_MS) {
        await failGame(db, g.id, msg)
      } else {
        await db.prepare('UPDATE party_games SET attempts = attempts + 1, error = ?2 WHERE id = ?1')
          .bind(g.id, msg).run()
      }
    }
  }
  return resolved
}

async function failGame(db: D1Database, id: number, error: string): Promise<void> {
  await db.prepare("UPDATE party_games SET status = 'failed', error = ?2, attempts = attempts + 1 WHERE id = ?1")
    .bind(id, error).run()
}
