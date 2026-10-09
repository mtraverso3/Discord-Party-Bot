import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleBanlistModal, handleCreateModalRaw, handleEditModalRaw } from '../src/commands/party'
import { handleAwayButton, handleHelpPage, handleLeaveButton } from '../src/components/buttons'
import * as parties from '../src/store/parties'

let seq = 0
const guild = () => String(900000000000000000n + BigInt(++seq))
const OWNER = '910000000000000001'
const OTHER = '910000000000000002'

let replies: string[]
const original = globalThis.fetch
beforeEach(() => {
  replies = []
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    if (String(input).includes('/webhooks/')) replies.push(JSON.parse(init.body).content)
    return Response.json({ id: 'posted', channel_id: 'chan' })
  }) as any
})
afterEach(() => { globalThis.fetch = original })

const member = (id: string) => ({ user: { id, username: id } })
const field = (custom_id: string, value: string) => ({ type: 18, component: { type: 4, custom_id, value } })
const select = (type: number, custom_id: string, value: string) => ({ type: 18, component: { type, custom_id, values: [value] } })

async function makeParty(g: string, maxSize = 5) {
  const created = await parties.createParty(env.DB, {
    id: 'HND001', guildId: g, name: 'Handlers', description: '', game: 'Other',
    owner: { userId: OWNER, username: OWNER, displayName: 'Owner' }, maxSize,
  })
  if (!created.ok) throw new Error(created.message)
  return created.party
}

describe('create modal', () => {
  const submit = (g: string, capacity: string, voice = '700000000000000002', game = 'Other') => handleCreateModalRaw({
    guild_id: g, channel_id: '700000000000000001', token: 't', member: member(OWNER),
    data: {
      custom_id: 'party_create',
      components: [field('name', ''), field('description', 'd'), field('capacity', capacity),
        select(3, 'game', game), select(8, 'voice-channel', voice)],
    },
  }, env)

  it('creates the party, named after the owner when left blank', async () => {
    const g = guild()
    await submit(g, '4')
    const [party] = await parties.listParties(env.DB, g)
    expect(party).toMatchObject({ name: `${OWNER}'s party`, maxSize: 4, voiceChannelId: '700000000000000002' })
    expect(replies.at(-1)).toContain('created')
  })

  it('rejects a bad cap, a missing voice channel, and a disabled game', async () => {
    const g = guild()
    await submit(g, '1')
    expect(replies.at(-1)).toContain('between 2 and 50')
    await submit(g, '5', '')
    expect(replies.at(-1)).toContain('voice channel')
    await submit(g, '5', '700000000000000002', 'Not A Game')
    expect(replies.at(-1)).toContain('not enabled')
    expect(await parties.listParties(env.DB, g)).toHaveLength(0)
  })

  it('refuses an owner who is already in a party', async () => {
    const g = guild()
    await makeParty(g)
    await submit(g, '5')
    expect(replies.at(-1)).toContain('already in party')
  })
})

describe('edit modal', () => {
  const submit = (g: string, who: string, capacity: string) => handleEditModalRaw({
    guild_id: g, token: 't', member: member(who),
    data: {
      custom_id: 'party_edit;HND001',
      components: [field('name', 'Renamed'), field('description', ''), field('capacity', capacity),
        select(3, 'game', 'Other'), select(8, 'voice-channel', '700000000000000003')],
    },
  }, env)

  it('lets the owner update the party', async () => {
    const g = guild()
    await makeParty(g)
    await submit(g, OWNER, '8')
    expect(await parties.getParty(env.DB, g, 'HND001')).toMatchObject({ name: 'Renamed', maxSize: 8, voiceChannelId: '700000000000000003' })
    expect(replies.at(-1)).toContain('Party updated')
  })

  it('refuses anyone else, and a cap below the member count', async () => {
    const g = guild()
    await makeParty(g)
    await submit(g, OTHER, '8')
    expect(replies.at(-1)).toContain('Only the party owner')
    await parties.joinParty(env.DB, g, 'HND001', { userId: OTHER, username: OTHER, displayName: 'Other' })
    await submit(g, OWNER, '1')
    expect((await parties.getParty(env.DB, g, 'HND001'))!.maxSize).toBe(5)
  })
})

/** A discord-hono component/modal context, recording what it sent. */
function context(g: string, who: string, customId: string, values: Record<string, string> = {}) {
  const sent: any[] = []
  const c: any = {
    env,
    interaction: { guild_id: g, data: { custom_id: customId }, member: member(who) },
    followup: (p: any) => { sent.push(p); return p },
    resUpdate: (p: any) => { sent.push(p); return p },
    get: (key: string) => (key === 'custom_id' ? customId : values[key]),
  }
  c.ephemeral = () => c
  c.resDefer = async (fn: any) => fn(c)
  return { c, sent }
}

describe('party buttons', () => {
  it('Leave removes a member and tells the owner to disband instead', async () => {
    const g = guild()
    await makeParty(g)
    await parties.joinParty(env.DB, g, 'HND001', { userId: OTHER, username: OTHER, displayName: 'Other' })

    const leave = context(g, OTHER, 'HND001')
    await handleLeaveButton(leave.c)
    expect(leave.sent.at(-1).content).toContain('You left')
    expect((await parties.getParty(env.DB, g, 'HND001'))!.members.map(m => m.userId)).toEqual([OWNER])

    const owner = context(g, OWNER, 'HND001')
    await handleLeaveButton(owner.c)
    expect(owner.sent.at(-1).content).toContain('disband')
  })

  it('BRB toggles the away marker for members only', async () => {
    const g = guild()
    await makeParty(g)
    const away = context(g, OWNER, 'HND001')
    await handleAwayButton(away.c)
    expect((await parties.getParty(env.DB, g, 'HND001'))!.members[0]!.away).toBe(true)
    await handleAwayButton(away.c)
    expect((await parties.getParty(env.DB, g, 'HND001'))!.members[0]!.away).toBeUndefined()

    const outsider = context(g, OTHER, 'HND001')
    await handleAwayButton(outsider.c)
    expect(outsider.sent.at(-1).content).toContain('join first')
  })

  it('a button for a party that is gone says so', async () => {
    const gone = context(guild(), OTHER, 'NOPE01')
    await handleLeaveButton(gone.c)
    expect(gone.sent.at(-1).content).toContain('no longer exists')
  })

  it('help pages stay within range', async () => {
    const { c, sent } = context(guild(), OTHER, '99')
    await handleHelpPage(c)
    expect(sent.at(-1).embeds[0].footer.text).toContain('Page 3 / 3')
  })
})

describe('banlist modal', () => {
  it('lets the owner set a banlist, assigned to members in order', async () => {
    const g = guild()
    await makeParty(g)
    const { c, sent } = context(g, OWNER, 'HND001', { banlist: 'Ahri\n\nZed\n' })
    await handleBanlistModal(c)
    expect(sent.at(-1).content).toContain('2 entries')
    expect((await parties.getParty(env.DB, g, 'HND001'))!.banlist!.assignments[OWNER]).toBe('Ahri')
  })

  it('refuses anyone but the owner', async () => {
    const g = guild()
    await makeParty(g)
    const { c, sent } = context(g, OTHER, 'HND001', { banlist: 'Ahri' })
    await handleBanlistModal(c)
    expect(sent.at(-1).content).toContain('Only the party owner')
  })
})
