/**
 * Per-guild audit log for admin actions. Each guild keeps its most recent
 * MAX_ENTRIES rows; older rows are trimmed on insert.
 */

export interface AuditEntry {
  ts: number
  email?: string
  method: string
  path: string  // admin API path including party/user IDs, e.g. "/parties/AB12CD/close"
}

const MAX_ENTRIES = 200

export async function appendAudit(db: D1Database, guildId: string, entry: AuditEntry): Promise<void> {
  await db.batch([
    db.prepare('INSERT INTO audit_log (guild_id, ts, email, method, path) VALUES (?1, ?2, ?3, ?4, ?5)')
      .bind(guildId, entry.ts, entry.email ?? null, entry.method, entry.path),
    db.prepare(`
      DELETE FROM audit_log WHERE guild_id = ?1 AND id <= (
        SELECT id FROM audit_log WHERE guild_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET ?2
      )
    `).bind(guildId, MAX_ENTRIES),
  ])
}

export async function getAudit(db: D1Database, guildId: string): Promise<AuditEntry[]> {
  const { results } = await db.prepare(
    'SELECT ts, email, method, path FROM audit_log WHERE guild_id = ?1 ORDER BY id DESC LIMIT ?2',
  ).bind(guildId, MAX_ENTRIES).all<{ ts: number; email: string | null; method: string; path: string }>()
  return results.map(r => ({ ts: r.ts, email: r.email ?? undefined, method: r.method, path: r.path }))
}
