import type { AppBindings, GuildSettings, PartyTemplate } from '../types'
import { saveUserIgn } from '../store/profiles'
import { sanitizeSettings, saveGuildSettings } from '../store/settings'

/**
 * One-time migration: copy the durable data from the legacy KV namespace into
 * D1. Covers user profiles (IGNs), guild settings, templates, and client
 * tokens. Live party state, link codes, and audit logs are ephemeral and are
 * intentionally not migrated.
 *
 * Idempotent — safe to re-run; existing D1 rows are overwritten with the KV
 * values. Once run (and verified), the PARTY_KV binding can be deleted from
 * wrangler.toml along with this file.
 */
export async function importFromKv(env: AppBindings): Promise<Response> {
  const kv = env.PARTY_KV
  if (!kv) {
    return Response.json({ error: 'PARTY_KV binding not configured — nothing to import.' }, { status: 400 })
  }

  const counts = { profiles: 0, igns: 0, settings: 0, templates: 0, clientTokens: 0 }

  // User profiles → user_igns
  for await (const key of listAll(kv, 'profile:')) {
    const userId = key.slice('profile:'.length)
    const raw = await kv.get(key)
    if (!raw) continue
    try {
      const profile = JSON.parse(raw) as { igns?: Record<string, string> }
      for (const [game, ign] of Object.entries(profile.igns ?? {})) {
        await saveUserIgn(env.DB, userId, game, ign)
        counts.igns++
      }
      counts.profiles++
    } catch (e) {
      console.warn(`import-kv: skipping malformed profile ${key}:`, e)
    }
  }

  // Guild settings and templates
  for await (const key of listAll(kv, 'guild:')) {
    const m = key.match(/^guild:([^:]+):(settings|templates)$/)
    if (!m) continue
    const guildId = m[1]!
    const raw = await kv.get(key)
    if (!raw) continue
    try {
      if (m[2] === 'settings') {
        await saveGuildSettings(env.DB, guildId, sanitizeSettings(JSON.parse(raw)) as GuildSettings)
        counts.settings++
      } else {
        const templates = JSON.parse(raw) as PartyTemplate[]
        if (!Array.isArray(templates)) continue
        for (const t of templates) {
          await env.DB.prepare(`
            INSERT INTO templates (guild_id, id, label, name, description, game, max_size, voice_channel_id, banlist, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT (guild_id, id) DO UPDATE SET label = ?3, name = ?4, description = ?5, game = ?6,
              max_size = ?7, voice_channel_id = ?8, banlist = ?9, updated_at = ?11
          `).bind(
            guildId, t.id, t.label ?? '', t.name ?? '', t.description ?? '', t.game ?? 'Other',
            t.maxSize ?? 10, t.voiceChannelId ?? null, t.banlist ?? null,
            t.createdAt ?? Date.now(), t.updatedAt ?? Date.now(),
          ).run()
          counts.templates++
        }
      }
    } catch (e) {
      console.warn(`import-kv: skipping malformed ${key}:`, e)
    }
  }

  // Desktop-client tokens, so linked clients survive the cutover.
  const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000
  for await (const key of listAll(kv, 'client-token:')) {
    const token = key.slice('client-token:'.length)
    const raw = await kv.get(key)
    if (!raw) continue
    try {
      const rec = JSON.parse(raw) as {
        userId: string; guildId: string; displayName: string; createdAt: number; refreshedAt: number
      }
      await env.DB.prepare(`
        INSERT INTO client_tokens (token, user_id, guild_id, display_name, created_at, refreshed_at, expires_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT (token) DO NOTHING
      `).bind(token, rec.userId, rec.guildId, rec.displayName,
        rec.createdAt, rec.refreshedAt, rec.refreshedAt + TOKEN_TTL_MS).run()
      counts.clientTokens++
    } catch (e) {
      console.warn(`import-kv: skipping malformed token ${key}:`, e)
    }
  }

  return Response.json({ status: 'imported', counts })
}

async function* listAll(kv: KVNamespace, prefix: string): AsyncGenerator<string> {
  let cursor: string | undefined
  do {
    const page = await kv.list({ prefix, cursor })
    for (const k of page.keys) yield k.name
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
}
