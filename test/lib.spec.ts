import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { gameAllowed, getGuildSettings, sanitizeSettings, saveGuildSettings, SETTINGS_DEFAULTS } from '../src/lib/settings'
import { appendAudit, getAudit } from '../src/lib/audit'
import {
  addToIndex, findParty, getPartyIndex, getUserPartyId, getUserProfile,
  randomId, removeFromIndex, saveUserIgn, setUserPartyId, uniquePartyId, updateIndexEntry,
} from '../src/lib/party'
import { parseCreateModalSubmit } from '../src/lib/modal'

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

  it('falls back to defaults on missing or corrupt KV data', async () => {
    expect(await getGuildSettings(env.PARTY_KV, 'g-none')).toEqual(SETTINGS_DEFAULTS)
    await env.PARTY_KV.put('guild:g-bad:settings', 'not json{')
    expect(await getGuildSettings(env.PARTY_KV, 'g-bad')).toEqual(SETTINGS_DEFAULTS)
  })

  it('round-trips through KV', async () => {
    const s = { maxParties: 5, defaultCap: 4, allowedGames: ['Other'] }
    await saveGuildSettings(env.PARTY_KV, 'g1', s)
    expect(await getGuildSettings(env.PARTY_KV, 'g1')).toEqual(s)
  })
})

describe('audit log', () => {
  it('stores newest entries first and trims to 200', async () => {
    for (let i = 0; i < 205; i++) {
      await appendAudit(env.PARTY_KV, 'g1', { ts: i, email: 'a@b.c', method: 'POST', path: `/n/${i}` })
    }
    const log = await getAudit(env.PARTY_KV, 'g1')
    expect(log).toHaveLength(200)
    expect(log[0]!.path).toBe('/n/204')
    expect(log[199]!.path).toBe('/n/5')
  })

  it('returns an empty array for corrupt data', async () => {
    await env.PARTY_KV.put('guild:g-bad:audit', '{nope')
    expect(await getAudit(env.PARTY_KV, 'g-bad')).toEqual([])
  })
})

describe('party IDs', () => {
  it('generates 6-char uppercase alphanumeric IDs', () => {
    for (let i = 0; i < 50; i++) expect(randomId()).toMatch(/^[0-9A-Z]{6}$/)
  })

  it('never returns an ID already in the index', () => {
    for (let i = 0; i < 50; i++) {
      const index = [{ id: 'AAAAAA', name: 'x', game: 'Other' }]
      const id = uniquePartyId(index)
      expect(id).not.toBe('AAAAAA')
      expect(id).toMatch(/^[0-9A-Z]{6}$/)
    }
  })
})

describe('guild index', () => {
  it('adds, updates, finds (case-insensitive), and removes entries', async () => {
    await addToIndex(env.PARTY_KV, 'g1', { id: 'ABC123', name: 'My Party', game: 'Other' })

    expect((await findParty(env.PARTY_KV, 'g1', 'abc123'))?.id).toBe('ABC123')
    expect((await findParty(env.PARTY_KV, 'g1', 'MY PARTY'))?.id).toBe('ABC123')
    expect(await findParty(env.PARTY_KV, 'g1', 'nope')).toBeNull()

    await updateIndexEntry(env.PARTY_KV, 'g1', 'ABC123', { name: 'Renamed' })
    expect((await getPartyIndex(env.PARTY_KV, 'g1'))[0]!.name).toBe('Renamed')

    await removeFromIndex(env.PARTY_KV, 'g1', 'ABC123')
    expect(await getPartyIndex(env.PARTY_KV, 'g1')).toEqual([])
  })
})

describe('user mappings and profiles', () => {
  it('sets and clears user→party mappings', async () => {
    await setUserPartyId(env.PARTY_KV, 'g1', 'u1', 'ABC123')
    expect(await getUserPartyId(env.PARTY_KV, 'g1', 'u1')).toBe('ABC123')
    await setUserPartyId(env.PARTY_KV, 'g1', 'u1', null)
    expect(await getUserPartyId(env.PARTY_KV, 'g1', 'u1')).toBeNull()
  })

  it('stores IGNs per game', async () => {
    await saveUserIgn(env.PARTY_KV, 'u1', 'Valorant', 'Shooty#NA1')
    await saveUserIgn(env.PARTY_KV, 'u1', 'Other', 'just-me')
    const profile = await getUserProfile(env.PARTY_KV, 'u1')
    expect(profile.igns).toEqual({ Valorant: 'Shooty#NA1', Other: 'just-me' })
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
