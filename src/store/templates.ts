import type { PartyTemplate } from '../types'
import { GAMES } from '../lib/games'
import { randomId } from '../lib/id'

const MAX_TEMPLATES = 50
const VALID_GAMES = new Set<string>(GAMES.map(g => g.value))

interface TemplateRow {
  id: string
  label: string
  name: string
  description: string
  game: string
  max_size: number
  voice_channel_id: string | null
  banlist: string | null
  created_at: number
  updated_at: number
}

function toTemplate(r: TemplateRow): PartyTemplate {
  return {
    id: r.id,
    label: r.label,
    name: r.name,
    description: r.description,
    game: r.game,
    maxSize: r.max_size,
    voiceChannelId: r.voice_channel_id ?? undefined,
    banlist: r.banlist ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export async function getTemplates(db: D1Database, guildId: string): Promise<PartyTemplate[]> {
  const { results } = await db.prepare('SELECT * FROM templates WHERE guild_id = ?1 ORDER BY created_at')
    .bind(guildId).all<TemplateRow>()
  return results.map(toTemplate)
}

export async function getTemplate(db: D1Database, guildId: string, id: string): Promise<PartyTemplate | null> {
  const row = await db.prepare('SELECT * FROM templates WHERE guild_id = ?1 AND id = ?2')
    .bind(guildId, id).first<TemplateRow>()
  return row ? toTemplate(row) : null
}

/** Coerce admin-submitted fields into the stored template shape. */
export function sanitizeTemplateInput(raw: any): {
  label: string
  name: string
  description: string
  game: string
  maxSize: number
  voiceChannelId?: string
  banlist?: string
} {
  const game = (raw?.game ?? 'Other').toString()
  const maxSize = Number(raw?.maxSize)
  const banlist = (raw?.banlist ?? '').toString().trim()
  return {
    label: (raw?.label ?? '').toString().trim().slice(0, 100),
    name: (raw?.name ?? '').toString().trim().slice(0, 100),
    description: (raw?.description ?? '').toString().slice(0, 1000),
    game: VALID_GAMES.has(game) ? game : 'Other',
    maxSize: Number.isInteger(maxSize) && maxSize >= 2 && maxSize <= 50 ? maxSize : 10,
    voiceChannelId: (raw?.voiceChannelId ?? '').toString() || undefined,
    banlist: banlist || undefined,
  }
}

export async function createTemplate(
  db: D1Database, guildId: string, raw: any,
): Promise<{ ok: true; template: PartyTemplate } | { ok: false; error: string }> {
  const count = await db.prepare('SELECT COUNT(*) AS n FROM templates WHERE guild_id = ?1')
    .bind(guildId).first<{ n: number }>()
  if ((count?.n ?? 0) >= MAX_TEMPLATES) return { ok: false, error: `Guild already has ${MAX_TEMPLATES} templates` }

  const input = sanitizeTemplateInput(raw)
  if (!input.label) return { ok: false, error: 'A template label is required' }

  const now = Date.now()
  const id = randomId()
  await db.prepare(`
    INSERT INTO templates (guild_id, id, label, name, description, game, max_size, voice_channel_id, banlist, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
  `).bind(guildId, id, input.label, input.name, input.description, input.game,
    input.maxSize, input.voiceChannelId ?? null, input.banlist ?? null, now).run()

  const template = await getTemplate(db, guildId, id)
  return template ? { ok: true, template } : { ok: false, error: 'Template vanished after create' }
}

export async function updateTemplate(
  db: D1Database, guildId: string, id: string, raw: any,
): Promise<{ ok: true; template: PartyTemplate } | { ok: false; error: string }> {
  const existing = await getTemplate(db, guildId, id)
  if (!existing) return { ok: false, error: 'Template not found' }

  const input = sanitizeTemplateInput(raw)
  if (!input.label) return { ok: false, error: 'A template label is required' }

  await db.prepare(`
    UPDATE templates SET label = ?3, name = ?4, description = ?5, game = ?6, max_size = ?7,
      voice_channel_id = ?8, banlist = ?9, updated_at = ?10
    WHERE guild_id = ?1 AND id = ?2
  `).bind(guildId, id, input.label, input.name, input.description, input.game,
    input.maxSize, input.voiceChannelId ?? null, input.banlist ?? null, Date.now()).run()

  const template = await getTemplate(db, guildId, id)
  return template ? { ok: true, template } : { ok: false, error: 'Template not found' }
}

export async function deleteTemplate(db: D1Database, guildId: string, id: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM templates WHERE guild_id = ?1 AND id = ?2').bind(guildId, id).run()
  return res.meta.changes > 0
}
