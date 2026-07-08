// Desktop-client auth: short-lived one-time link codes (from /party link)
// exchanged for long-lived bearer tokens with a sliding expiry.

export interface LinkRecord {
  guildId: string
  discordUserId: string
  displayName: string
}

export interface TokenRecord {
  userId: string
  guildId: string
  displayName: string
  createdAt: number
  refreshedAt: number
}

const LINK_TTL_MS = 10 * 60 * 1000                       // link codes: 10 minutes
export const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000     // tokens: 90 days, sliding
const TOKEN_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000    // re-extend at most daily

const CODE_LENGTH = 8
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // omit ambiguous chars

export function generateLinkCode(): string {
  const buf = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[buf[i]! % CODE_ALPHABET.length]
  return out
}

export function generateToken(): string {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function writeLinkCode(db: D1Database, code: string, record: LinkRecord): Promise<void> {
  await db.prepare(`
    INSERT INTO link_codes (code, guild_id, user_id, display_name, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT (code) DO UPDATE SET guild_id = ?2, user_id = ?3, display_name = ?4, expires_at = ?5
  `).bind(code, record.guildId, record.discordUserId, record.displayName, Date.now() + LINK_TTL_MS).run()
}

/** Consume a link code (single use); null if unknown or expired. */
export async function consumeLinkCode(db: D1Database, code: string): Promise<LinkRecord | null> {
  const row = await db.prepare('DELETE FROM link_codes WHERE code = ?1 AND expires_at > ?2 RETURNING *')
    .bind(code, Date.now())
    .first<{ guild_id: string; user_id: string; display_name: string }>()
  return row ? { guildId: row.guild_id, discordUserId: row.user_id, displayName: row.display_name } : null
}

export async function createClientToken(db: D1Database, link: LinkRecord): Promise<string> {
  const token = generateToken()
  const now = Date.now()
  await db.prepare(`
    INSERT INTO client_tokens (token, user_id, guild_id, display_name, created_at, refreshed_at, expires_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
  `).bind(token, link.discordUserId, link.guildId, link.displayName, now, now + TOKEN_TTL_MS).run()
  return token
}

/**
 * Resolve a bearer token to its record, sliding its expiry while in active
 * use; null if missing or expired.
 */
export async function resolveClientToken(db: D1Database, token: string): Promise<TokenRecord | null> {
  const now = Date.now()
  const row = await db.prepare('SELECT * FROM client_tokens WHERE token = ?1 AND expires_at > ?2')
    .bind(token, now)
    .first<{ user_id: string; guild_id: string; display_name: string; created_at: number; refreshed_at: number }>()
  if (!row) return null

  if (now - row.refreshed_at > TOKEN_REFRESH_INTERVAL_MS) {
    await db.prepare('UPDATE client_tokens SET refreshed_at = ?2, expires_at = ?3 WHERE token = ?1')
      .bind(token, now, now + TOKEN_TTL_MS).run()
  }
  return {
    userId: row.user_id,
    guildId: row.guild_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    refreshedAt: row.refreshed_at,
  }
}

export async function deleteClientToken(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM client_tokens WHERE token = ?1').bind(token).run()
}

/** Cron cleanup: purge expired link codes and client tokens. */
export async function sweepExpiredAuth(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM link_codes WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM client_tokens WHERE expires_at <= ?1').bind(now),
  ])
}
