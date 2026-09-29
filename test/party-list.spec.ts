import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { handleParty } from '../src/commands/party'
import * as parties from '../src/store/parties'

let seq = 0
const guild = () => String(700000000000000000n + BigInt(++seq))

async function list(guildId: string) {
  const sent: any[] = []
  const c: any = {
    env,
    interaction: {
      guild_id: guildId,
      channel_id: '700000000000000009',
      member: { user: { id: '710000000000000001', username: 'me' }, permissions: '0' },
      data: { options: [{ type: 1, name: 'list', options: [] }] },
    },
    followup: (payload: any) => { sent.push(payload); return payload },
  }
  c.ephemeral = () => c
  c.resDefer = async (fn: any) => fn(c)
  await handleParty(c)
  return sent.at(-1)
}

async function seed(guildId: string, count: number, name: (i: number) => string) {
  for (let i = 0; i < count; i++) {
    await parties.createParty(env.DB, {
      id: `L${String(i).padStart(5, '0')}`, guildId, name: name(i), description: '', game: 'Goose Goose Duck',
      owner: { userId: `owner-${i}`, username: 'o', displayName: 'O' }, maxSize: 50,
    })
  }
}

describe('/party list', () => {
  it('lists every party when they fit', async () => {
    const g = guild()
    await seed(g, 3, i => `Party ${i}`)
    const { description } = (await list(g)).embeds[0]
    for (let i = 0; i < 3; i++) expect(description).toContain(`**Party ${i}**`)
    expect(description).not.toContain('more')
  })

  it("stays within Discord's description limit and says how many were left out", async () => {
    const g = guild()
    await seed(g, 50, i => `${i}`.padEnd(100, 'n'))
    const { description } = (await list(g)).embeds[0]
    expect(description.length).toBeLessThanOrEqual(4096)
    const more = Number(description.match(/…and (\d+) more$/)?.[1])
    expect(description.split('\n').length - 1 + more).toBe(50)
  })
})
