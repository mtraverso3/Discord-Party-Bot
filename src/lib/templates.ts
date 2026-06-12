import type { PartyTemplate } from '../types'
import { GAMES } from './games'
import { randomId } from './party'

// Per-guild list of party templates, stored under a single KV key.
const MAX_TEMPLATES = 50
const VALID_GAMES = new Set<string>(GAMES.map(g => g.value))

function keyFor(guildId: string): string {
  return `guild:${guildId}:templates`
}

export async function getTemplates(kv: KVNamespace, guildId: string): Promise<PartyTemplate[]> {
  const raw = await kv.get(keyFor(guildId))
  if (!raw) return []
  try {
    const list = JSON.parse(raw)
    return Array.isArray(list) ? list as PartyTemplate[] : []
  } catch {
    return []
  }
}

async function saveTemplates(kv: KVNamespace, guildId: string, templates: PartyTemplate[]): Promise<void> {
  await kv.put(keyFor(guildId), JSON.stringify(templates))
}

export async function getTemplate(kv: KVNamespace, guildId: string, id: string): Promise<PartyTemplate | null> {
  const templates = await getTemplates(kv, guildId)
  return templates.find(t => t.id === id) ?? null
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

export async function createTemplate(kv: KVNamespace, guildId: string, raw: any): Promise<{ ok: true; template: PartyTemplate } | { ok: false; error: string }> {
  const templates = await getTemplates(kv, guildId)
  if (templates.length >= MAX_TEMPLATES) return { ok: false, error: `Guild already has ${MAX_TEMPLATES} templates` }

  const input = sanitizeTemplateInput(raw)
  if (!input.label) return { ok: false, error: 'A template label is required' }

  const now = Date.now()
  let id = randomId()
  for (let i = 0; i < 10 && templates.some(t => t.id === id); i++) id = randomId()

  const template: PartyTemplate = { id, ...input, createdAt: now, updatedAt: now }
  templates.push(template)
  await saveTemplates(kv, guildId, templates)
  return { ok: true, template }
}

export async function updateTemplate(kv: KVNamespace, guildId: string, id: string, raw: any): Promise<{ ok: true; template: PartyTemplate } | { ok: false; error: string }> {
  const templates = await getTemplates(kv, guildId)
  const idx = templates.findIndex(t => t.id === id)
  if (idx === -1) return { ok: false, error: 'Template not found' }

  const input = sanitizeTemplateInput(raw)
  if (!input.label) return { ok: false, error: 'A template label is required' }

  const template: PartyTemplate = { ...templates[idx]!, ...input, updatedAt: Date.now() }
  templates[idx] = template
  await saveTemplates(kv, guildId, templates)
  return { ok: true, template }
}

export async function deleteTemplate(kv: KVNamespace, guildId: string, id: string): Promise<boolean> {
  const templates = await getTemplates(kv, guildId)
  const next = templates.filter(t => t.id !== id)
  if (next.length === templates.length) return false
  await saveTemplates(kv, guildId, next)
  return true
}
