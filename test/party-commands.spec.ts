import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleParty } from '../src/commands/party'
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
})
