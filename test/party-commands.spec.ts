import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleParty, handlePartyAutocomplete } from '../src/commands/party'
import { SETTINGS_DEFAULTS, saveGuildSettings } from '../src/store/settings'
import * as parties from '../src/store/parties'
import { IGN_MAX, getUserIgn } from '../src/store/profiles'

let seq = 0
const guild = () => String(600000000000000000n + BigInt(++seq))
const ME = '610000000000000001'

const original = globalThis.fetch
beforeEach(() => {
  globalThis.fetch = vi.fn(async () => Response.json({ id: 'posted', channel_id: 'chan' })) as any
})
afterEach(() => { globalThis.fetch = original })

/** Run one /party subcommand as ME and return the last payload it replied with. */
async function run(guildId: string, name: string, opts: Record<string, any> = {}) {
  const sent: any[] = []
  const c: any = {
    env,
    interaction: {
      guild_id: guildId,
      channel_id: '700000000000000009',
      member: { user: { id: ME, username: 'me' }, permissions: '0' },
      data: { options: [{ type: 1, name, options: Object.entries(opts).map(([k, v]) => ({ name: k, value: v })) }] },
    },
    followup: (payload: any) => { sent.push(payload); return payload },
  }
  c.ephemeral = () => c
  c.res = (payload: any) => { sent.push(payload); return payload }
  c.resDefer = async (fn: any) => fn(c)
  await handleParty(c)
  return sent.at(-1)
}

describe('/party ign', () => {
  it('saves the IGN and refreshes it in a party playing that game', async () => {
    const g = guild()
    await parties.createParty(env.DB, {
      id: 'IGN001', guildId: g, name: 'p', description: '', game: 'Valorant',
      owner: { userId: ME, username: 'me', displayName: 'Me' }, maxSize: 5,
    })
    await run(g, 'ign', { game: 'Valorant', name: '  Shooty#NA1  ' })
    expect(await getUserIgn(env.DB, ME, 'Valorant')).toBe('Shooty#NA1')
    expect((await parties.getParty(env.DB, g, 'IGN001'))!.members[0]!.ign).toBe('Shooty#NA1')
  })

  it(`caps the name at ${IGN_MAX} characters`, async () => {
    const reply = await run(guild(), 'ign', { game: 'Other', name: 'x'.repeat(500) })
    expect(await getUserIgn(env.DB, ME, 'Other')).toBe('x'.repeat(IGN_MAX))
    expect(reply.content.length).toBeLessThan(200)
  })

  it("matches the typed game to the server's list, custom games included", async () => {
    const g = guild()
    await saveGuildSettings(env.DB, g, { ...SETTINGS_DEFAULTS, customGames: ['Deadlock'] })
    await run(g, 'ign', { game: 'deadlock', name: 'Haze' })
    expect(await getUserIgn(env.DB, ME, 'Deadlock')).toBe('Haze')
    await run(g, 'ign', { game: 'lol na', name: 'Me#NA1' })
    expect(await getUserIgn(env.DB, ME, 'LoL NA')).toBe('Me#NA1')
  })

  it('refuses a game the server does not have', async () => {
    const reply = await run(guild(), 'ign', { game: 'Not A Game', name: 'x' })
    expect(reply.content).toContain("not a game on this server")
    expect(await getUserIgn(env.DB, ME, 'Not A Game')).toBeFalsy()
  })
})

describe('/party ign autocomplete', () => {
  const complete = async (guildId: string, typed: string) => {
    const res = await handlePartyAutocomplete({
      type: 4, guild_id: guildId,
      data: { name: 'party', options: [{ type: 1, name: 'ign', options: [{ name: 'game', value: typed, focused: true }] }] },
    }, env)
    return (await res.json<any>()).data.choices.map((c: any) => c.value)
  }

  it("suggests the server's enabled games matching what's typed", async () => {
    const g = guild()
    await saveGuildSettings(env.DB, g, { ...SETTINGS_DEFAULTS, customGames: ['Deadlock'], disabledGames: ['LoL PBE'] })
    expect(await complete(g, 'lol')).toEqual(['LoL NA', 'LoL EUW'])
    expect(await complete(g, 'DEAD')).toEqual(['Deadlock'])
    expect(await complete(g, '')).toContain('Other')
  })
})
