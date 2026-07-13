// Discord-identity admin login: the allow-list of Discord users who may reach
// /admin, plus the two short-lived credential types the login flow issues —
// single-use magic-link tokens (from /party admin) and single-use OIDC
// authorization codes (minted for Cloudflare Access during the login redirect).

export interface AdminUser {
  guildId: string
  userId: string
  displayName: string
  addedBy: string | null
  addedAt: number
}

const LINK_TTL_MS = 24 * 60 * 60 * 1000   // magic links: 24h to click, single use
const CODE_TTL_MS = 5 * 60 * 1000          // OIDC auth codes: 5 minutes, single use

function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return [...buf].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Admin allow-list (per guild) ────────────────────────────────────────────

export async function isAdmin(db: D1Database, guildId: string, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM admin_users WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).first()
  return !!row
}

export async function listAdmins(db: D1Database, guildId: string): Promise<AdminUser[]> {
  const { results } = await db.prepare(
    'SELECT guild_id, user_id, display_name, added_by, added_at FROM admin_users WHERE guild_id = ?1 ORDER BY added_at DESC',
  ).bind(guildId).all<{ guild_id: string; user_id: string; display_name: string; added_by: string | null; added_at: number }>()
  return results.map(r => ({
    guildId: r.guild_id,
    userId: r.user_id,
    displayName: r.display_name,
    addedBy: r.added_by,
    addedAt: r.added_at,
  }))
}

export async function addAdmin(
  db: D1Database, entry: { guildId: string; userId: string; displayName: string; addedBy: string | null },
): Promise<void> {
  await db.prepare(`
    INSERT INTO admin_users (guild_id, user_id, display_name, added_by, added_at) VALUES (?1, ?2, ?3, ?4, ?5)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET display_name = ?3
  `).bind(entry.guildId, entry.userId, entry.displayName, entry.addedBy, Date.now()).run()
}

/** Record a successful magic-link login. Not surfaced in the UI. */
export async function touchAdminLogin(db: D1Database, guildId: string, userId: string): Promise<void> {
  await db.prepare('UPDATE admin_users SET last_login_at = ?3 WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId, Date.now()).run()
}

export async function removeAdmin(db: D1Database, guildId: string, userId: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM admin_users WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).run()
  return (res.meta.changes ?? 0) > 0
}

// ── Magic-link tokens ─────────────────────────────────────────────────────────

export function generateAdminToken(): string {
  return randomHex(32)
}

export async function writeAdminLinkToken(
  db: D1Database, token: string, rec: { guildId: string; userId: string; displayName: string },
): Promise<void> {
  await db.prepare(
    'INSERT INTO admin_link_tokens (token, guild_id, user_id, display_name, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)',
  ).bind(token, rec.guildId, rec.userId, rec.displayName, Date.now() + LINK_TTL_MS).run()
}

/** Consume a magic-link token (single use); null if unknown or expired. */
export async function consumeAdminLinkToken(
  db: D1Database, token: string,
): Promise<{ guildId: string; userId: string; displayName: string } | null> {
  const row = await db.prepare('DELETE FROM admin_link_tokens WHERE token = ?1 AND expires_at > ?2 RETURNING *')
    .bind(token, Date.now())
    .first<{ guild_id: string; user_id: string; display_name: string }>()
  return row ? { guildId: row.guild_id, userId: row.user_id, displayName: row.display_name } : null
}

// ── OIDC authorization codes ───────────────────────────────────────────────────

export interface OidcCodeRecord {
  guildId: string
  userId: string
  displayName: string
  nonce: string | null
  codeChallenge: string | null
  redirectUri: string
}

export function generateOidcCode(): string {
  return randomHex(32)
}

export async function writeOidcCode(db: D1Database, code: string, rec: OidcCodeRecord): Promise<void> {
  await db.prepare(`
    INSERT INTO oidc_codes (code, guild_id, user_id, display_name, nonce, code_challenge, redirect_uri, expires_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
  `).bind(
    code, rec.guildId, rec.userId, rec.displayName, rec.nonce, rec.codeChallenge, rec.redirectUri, Date.now() + CODE_TTL_MS,
  ).run()
}

/** Consume an OIDC auth code (single use); null if unknown or expired. */
export async function consumeOidcCode(db: D1Database, code: string): Promise<OidcCodeRecord | null> {
  const row = await db.prepare('DELETE FROM oidc_codes WHERE code = ?1 AND expires_at > ?2 RETURNING *')
    .bind(code, Date.now())
    .first<{ guild_id: string; user_id: string; display_name: string; nonce: string | null; code_challenge: string | null; redirect_uri: string }>()
  return row ? {
    guildId: row.guild_id,
    userId: row.user_id,
    displayName: row.display_name,
    nonce: row.nonce,
    codeChallenge: row.code_challenge,
    redirectUri: row.redirect_uri,
  } : null
}

/** Cron cleanup: purge expired magic-link tokens and OIDC codes. */
export async function sweepExpiredAdminAuth(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM admin_link_tokens WHERE expires_at <= ?1').bind(now),
    db.prepare('DELETE FROM oidc_codes WHERE expires_at <= ?1').bind(now),
  ])
}
