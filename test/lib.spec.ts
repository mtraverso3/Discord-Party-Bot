import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { canBump, gameAllowed, getGuildSettings, sanitizeSettings, saveGuildSettings, SETTINGS_DEFAULTS } from '../src/store/settings'
import { appendAudit, getAudit } from '../src/store/audit'
import { findUserIdByRiotId, getUserProfile, saveUserIgn } from '../src/store/profiles'
import { randomId } from '../src/lib/id'
import { parseCreateModalSubmit } from '../src/lib/modal'
import {
  createTemplate, deleteTemplate, getTemplate, getTemplates,
  sanitizeTemplateInput, updateTemplate,
} from '../src/store/templates'

describe('settings', () => {
  it('clamps numbers and filters unknown games', () => {
    const s = sanitizeSettings({ maxParties: 999, defaultCap: 0, allowedGames: ['Valorant', 'NotAGame', 42] })
    expect(s.maxParties).toBe(SETTINGS_DEFAULTS.maxParties)
    expect(s.defaultCap).toBe(SETTINGS_DEFAULTS.defaultCap)
    expect(s.allowedGames).toEqual(['Valorant'])
  })

  it('empty allowlist allows every game', () => {
    expect(gameAllowed({ ...SETTINGS_DEFAULTS, allowedGames: [] }, 'Valorant')).toBe(true)
    expect(gameAllowed({ ...SETTINGS_DEFAULTS, allowedGames: ['Other'] }, 'Valorant')).toBe(false)
    expect(gameAllowed({ ...SETTINGS_DEFAULTS, allowedGames: ['Other'] }, 'Other')).toBe(true)
  })

  it('falls back to defaults for guilds with no stored settings', async () => {
    expect(await getGuildSettings(env.DB, 'g-none')).toEqual(SETTINGS_DEFAULTS)
  })

  it('round-trips through the database', async () => {
    const s = { maxParties: 5, defaultCap: 4, allowedGames: ['Other'], clientInviters: ['123456789012345678'], partyBumpers: ['234567890123456789'] }
    await saveGuildSettings(env.DB, 'g1', s)
    expect(await getGuildSettings(env.DB, 'g1')).toEqual(s)
    // and an update overwrites, not duplicates
    await saveGuildSettings(env.DB, 'g1', { ...s, maxParties: 7 })
    expect((await getGuildSettings(env.DB, 'g1')).maxParties).toBe(7)
  })

  it('sanitizes client inviters to unique valid Discord IDs', () => {
    const s = sanitizeSettings({ clientInviters: ['123456789012345678', '123456789012345678', 'not-an-id', 42, '12'] })
    expect(s.clientInviters).toEqual(['123456789012345678'])
    expect(sanitizeSettings({}).clientInviters).toEqual([])
    expect(sanitizeSettings({ clientInviters: 'nope' }).clientInviters).toEqual([])
  })

  it('sanitizes party bumpers to unique valid Discord IDs', () => {
    const s = sanitizeSettings({ partyBumpers: ['123456789012345678', '123456789012345678', 'not-an-id', 42, '12'] })
    expect(s.partyBumpers).toEqual(['123456789012345678'])
    expect(sanitizeSettings({}).partyBumpers).toEqual([])
    expect(sanitizeSettings({ partyBumpers: 'nope' }).partyBumpers).toEqual([])
  })

  it('canBump allows the owner and designated bumpers only', () => {
    const settings = { ...SETTINGS_DEFAULTS, partyBumpers: ['bumper'] }
    expect(canBump(settings, { ownerId: 'owner' }, 'owner')).toBe(true)
    expect(canBump(settings, { ownerId: 'owner' }, 'bumper')).toBe(true)
    expect(canBump(settings, { ownerId: 'owner' }, 'rando')).toBe(false)
    expect(canBump(SETTINGS_DEFAULTS, { ownerId: 'owner' }, 'rando')).toBe(false)
  })
})

describe('party templates', () => {
  it('clamps cap, filters unknown games, and trims fields', () => {
    const t = sanitizeTemplateInput({
      label: '  Friday ARAM  ', name: 'x'.repeat(200), game: 'NotAGame',
      maxSize: 999, description: 'd', voiceChannelId: '', banlist: '  Ahri\nZed  ',
    })
    expect(t.label).toBe('Friday ARAM')
    expect(t.name.length).toBe(100)
    expect(t.game).toBe('Other')
    expect(t.maxSize).toBe(10)
    expect(t.voiceChannelId).toBeUndefined()
    expect(t.banlist).toBe('Ahri\nZed')
  })

  it('rejects a template without a label', async () => {
    const res = await createTemplate(env.DB, 'gt', { label: '   ', game: 'Valorant' })
    expect(res.ok).toBe(false)
  })

  it('creates, lists, fetches, updates, and deletes', async () => {
    const created = await createTemplate(env.DB, 'gt2', {
      label: 'Inhouse', name: 'Inhouse 5s', game: 'Valorant', maxSize: 10,
    })
    expect(created.ok).toBe(true)
    const id = (created as any).template.id

    expect(await getTemplates(env.DB, 'gt2')).toHaveLength(1)
    expect((await getTemplate(env.DB, 'gt2', id))!.label).toBe('Inhouse')

    const updated = await updateTemplate(env.DB, 'gt2', id, { label: 'Inhouse v2', game: 'Overwatch', maxSize: 6 })
    expect(updated.ok).toBe(true)
    const after = (await getTemplate(env.DB, 'gt2', id))!
    expect(after.label).toBe('Inhouse v2')
    expect(after.game).toBe('Overwatch')
    expect(after.maxSize).toBe(6)

    expect(await deleteTemplate(env.DB, 'gt2', id)).toBe(true)
    expect(await deleteTemplate(env.DB, 'gt2', id)).toBe(false)
    expect(await getTemplates(env.DB, 'gt2')).toHaveLength(0)
  })

  it('updating a missing template fails', async () => {
    const res = await updateTemplate(env.DB, 'gt3', 'nope', { label: 'x' })
    expect(res.ok).toBe(false)
  })
})

describe('audit log', () => {
  it('stores newest entries first and trims to 200', async () => {
    for (let i = 0; i < 205; i++) {
      await appendAudit(env.DB, 'g1', { ts: i, email: 'a@b.c', method: 'POST', path: `/n/${i}` })
    }
    const log = await getAudit(env.DB, 'g1')
    expect(log).toHaveLength(200)
    expect(log[0]!.path).toBe('/n/204')
    expect(log[199]!.path).toBe('/n/5')
  })

  it('trims per guild, not globally', async () => {
    await appendAudit(env.DB, 'g-a', { ts: 1, method: 'POST', path: '/a' })
    for (let i = 0; i < 201; i++) {
      await appendAudit(env.DB, 'g-b', { ts: i, method: 'POST', path: `/b/${i}` })
    }
    expect(await getAudit(env.DB, 'g-a')).toHaveLength(1)
    expect(await getAudit(env.DB, 'g-b')).toHaveLength(200)
  })
})

describe('party IDs', () => {
  it('generates 6-char uppercase alphanumeric IDs', () => {
    for (let i = 0; i < 50; i++) expect(randomId()).toMatch(/^[0-9A-Z]{6}$/)
  })
})

describe('user profiles and Riot ID lookup', () => {
  it('stores IGNs per game and clears them on empty input', async () => {
    await saveUserIgn(env.DB, 'u1', 'Valorant', 'Shooty#NA1')
    await saveUserIgn(env.DB, 'u1', 'Other', 'just-me')
    expect((await getUserProfile(env.DB, 'u1')).igns).toEqual({ Valorant: 'Shooty#NA1', Other: 'just-me' })

    await saveUserIgn(env.DB, 'u1', 'Other', '  ')
    expect((await getUserProfile(env.DB, 'u1')).igns).toEqual({ Valorant: 'Shooty#NA1' })
  })

  it('reverse-resolves Riot IDs case-insensitively with tag wildcards', async () => {
    await saveUserIgn(env.DB, 'u-tagged', 'LoL NA', 'Faker#KR1')
    await saveUserIgn(env.DB, 'u-untagged', 'LoL NA', 'Chovy')

    // Exact match, any casing.
    expect(await findUserIdByRiotId(env.DB, 'LoL NA', 'faker', 'kr1')).toBe('u-tagged')
    // Wrong tag → no match for a tagged registration.
    expect(await findUserIdByRiotId(env.DB, 'LoL NA', 'Faker', 'NA1')).toBeNull()
    // Untagged registration matches any tagline.
    expect(await findUserIdByRiotId(env.DB, 'LoL NA', 'CHOVY', 'KR2')).toBe('u-untagged')
    // Different game → no crossover.
    expect(await findUserIdByRiotId(env.DB, 'Valorant', 'Faker', 'KR1')).toBeNull()
  })

  it('re-registering an IGN moves the reverse index', async () => {
    await saveUserIgn(env.DB, 'u2', 'LoL NA', 'OldName#NA1')
    await saveUserIgn(env.DB, 'u2', 'LoL NA', 'NewName#NA1')
    expect(await findUserIdByRiotId(env.DB, 'LoL NA', 'OldName', 'NA1')).toBeNull()
    expect(await findUserIdByRiotId(env.DB, 'LoL NA', 'NewName', 'NA1')).toBe('u2')
  })
})

describe('modal submit parsing', () => {
  it('collects text inputs and selects from label-wrapped components', () => {
    const interaction = {
      data: {
        components: [
          { type: 18, component: { type: 4, custom_id: 'name', value: 'My Party' } },
          { type: 18, component: { type: 4, custom_id: 'capacity', value: '10' } },
          { type: 18, component: { type: 3, custom_id: 'game', values: ['Valorant'] } },
          { type: 18, component: { type: 8, custom_id: 'voice-channel', values: ['123'] } },
          { type: 1, components: [{ type: 4, custom_id: 'description', value: 'desc' }] },
        ],
      },
    }
    expect(parseCreateModalSubmit(interaction)).toEqual({
      name: 'My Party',
      description: 'desc',
      capacity: '10',
      game: 'Valorant',
      voiceChannelId: '123',
    })
  })

  it('returns empty strings for missing fields', () => {
    expect(parseCreateModalSubmit({ data: { components: [] } })).toEqual({
      name: '', description: '', capacity: '', game: '', voiceChannelId: '',
    })
  })
})
