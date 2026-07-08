import type { UserProfile } from '../types'

// Per-user, per-game IGNs, plus the normalized reverse index that lets the
// desktop client map a Riot ID it sees in a live lobby back to a Discord user.

function normalizeIgnPart(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function parseIgn(raw: string): { name: string; tag: string } | null {
  const s = raw.trim()
  if (!s) return null
  const hash = s.indexOf('#')
  if (hash === -1) return { name: normalizeIgnPart(s), tag: '' }
  const name = normalizeIgnPart(s.slice(0, hash))
  const tag = normalizeIgnPart(s.slice(hash + 1))
  return name ? { name, tag } : null
}

export async function getUserProfile(db: D1Database, userId: string): Promise<UserProfile> {
  const { results } = await db.prepare('SELECT game, ign FROM user_igns WHERE user_id = ?1')
    .bind(userId).all<{ game: string; ign: string }>()
  const igns: Record<string, string> = {}
  for (const r of results) igns[r.game] = r.ign
  return { igns }
}

export async function getUserIgn(db: D1Database, userId: string, game: string): Promise<string | undefined> {
  const row = await db.prepare('SELECT ign FROM user_igns WHERE user_id = ?1 AND game = ?2')
    .bind(userId, game).first<{ ign: string }>()
  return row?.ign
}

/** Bulk-fetch several users' IGNs for one game (for game-switch refreshes). */
export async function getIgnMap(db: D1Database, userIds: string[], game: string): Promise<Record<string, string>> {
  const map: Record<string, string> = {}
  if (userIds.length === 0) return map
  const placeholders = userIds.map((_, i) => `?${i + 2}`).join(', ')
  const { results } = await db.prepare(
    `SELECT user_id, ign FROM user_igns WHERE game = ?1 AND user_id IN (${placeholders})`,
  ).bind(game, ...userIds).all<{ user_id: string; ign: string }>()
  for (const r of results) map[r.user_id] = r.ign
  return map
}

export async function saveUserIgn(db: D1Database, userId: string, game: string, ign: string): Promise<void> {
  const trimmed = ign.trim()
  if (!trimmed) {
    await db.prepare('DELETE FROM user_igns WHERE user_id = ?1 AND game = ?2').bind(userId, game).run()
    return
  }
  const parsed = parseIgn(trimmed)
  await db.prepare(`
    INSERT INTO user_igns (user_id, game, ign, norm_name, norm_tag) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT (user_id, game) DO UPDATE SET ign = ?3, norm_name = ?4, norm_tag = ?5
  `).bind(userId, game, trimmed, parsed?.name ?? null, parsed?.tag ?? '').run()
}

/**
 * Which Discord user (if any) has registered this Riot ID for the given game.
 * A registration saved without a tagline matches any tagline — same
 * "no tag = wildcard" rule the client itself uses to match IGNs.
 */
export async function findUserIdByRiotId(
  db: D1Database, game: string, gameName: string, tagLine: string,
): Promise<string | null> {
  const name = normalizeIgnPart(gameName)
  const tag = normalizeIgnPart(tagLine)
  const row = await db.prepare(`
    SELECT user_id FROM user_igns
    WHERE game = ?1 AND norm_name = ?2 AND norm_tag IN (?3, '')
    ORDER BY norm_tag DESC LIMIT 1
  `).bind(game, name, tag).first<{ user_id: string }>()
  return row?.user_id ?? null
}
