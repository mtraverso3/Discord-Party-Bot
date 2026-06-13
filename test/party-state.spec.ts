import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import type { PartyData } from '../src/types'

let seq = 0

async function call<T = any>(stub: DurableObjectStub, action: string, body?: unknown): Promise<T> {
  const res = await stub.fetch(`http://do/${action}`, body !== undefined
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined)
  return res.json() as Promise<T>
}

/** Fresh DO with a party of `maxSize` owned by "owner". */
async function makeParty(opts: Partial<{ maxSize: number; game: string }> = {}) {
  const stub = env.PARTY_STATE.get(env.PARTY_STATE.idFromName(`test-${Date.now()}-${seq++}`))
  const party = await call<PartyData>(stub, 'create', {
    id: 'TEST01',
    guildId: 'g1',
    name: 'Test party',
    description: '',
    game: opts.game ?? 'Other',
    ownerId: 'owner',
    ownerUsername: 'owner_un',
    ownerName: 'Owner',
    maxSize: opts.maxSize ?? 3,
  })
  return { stub, party }
}

const user = (id: string) => ({ userId: id, username: `${id}_un`, displayName: id.toUpperCase() })

describe('create', () => {
  it('starts with the owner as the only member', async () => {
    const { party } = await makeParty()
    expect(party.members).toHaveLength(1)
    expect(party.members[0]!.userId).toBe('owner')
    expect(party.queue).toHaveLength(0)
    expect(party.isClosed).toBe(false)
  })

  it('does not clobber an existing party on a duplicate create', async () => {
    const { stub } = await makeParty({ maxSize: 3 })
    await call(stub, 'join', user('a'))
    // A retried/duplicate create must return the live party untouched.
    const again = await call<PartyData>(stub, 'create', {
      id: 'TEST01', guildId: 'g1', name: 'Clobbered', game: 'Other',
      ownerId: 'owner', ownerUsername: 'owner_un', ownerName: 'Owner', maxSize: 3,
    })
    expect(again.name).toBe('Test party')
    expect(again.members.map(m => m.userId)).toEqual(['owner', 'a'])
  })

  it('rejects malformed create payloads', async () => {
    const bad = (body: any) =>
      call(env.PARTY_STATE.get(env.PARTY_STATE.idFromName(`bad-${Date.now()}-${seq++}`)), 'create', body)
    expect((await bad({ id: 'X', guildId: 'g1', ownerName: 'O', maxSize: 3 })).error).toBeTruthy()       // no owner
    expect((await bad({ id: 'X', guildId: 'g1', ownerId: 'o', ownerName: 'O', maxSize: 99 })).error).toBeTruthy()  // cap too high
    expect((await bad({ id: 'X', guildId: 'g1', ownerId: 'o', ownerName: 'O', maxSize: 0 })).error).toBeTruthy()   // cap too low
    expect((await bad({ id: 'X', guildId: 'g1', ownerId: 'o', ownerName: 'O', maxSize: 2.5 })).error).toBeTruthy() // fractional
  })

  it('falls back to the owner name when no name is given', async () => {
    const stub = env.PARTY_STATE.get(env.PARTY_STATE.idFromName(`noname-${Date.now()}-${seq++}`))
    const party = await call<PartyData>(stub, 'create', {
      id: 'X', guildId: 'g1', ownerId: 'o', ownerName: 'Zara', maxSize: 3,
    })
    expect(party.name).toBe("Zara's party")
  })
})

describe('owner mutex (claim/release)', () => {
  it('grants one holder at a time and frees on release', async () => {
    const stub = env.PARTY_STATE.get(env.PARTY_STATE.idFromName(`lock-${Date.now()}-${seq++}`))
    expect((await call(stub, 'claim', { ttl: 5000 })).ok).toBe(true)
    expect((await call(stub, 'claim', { ttl: 5000 })).ok).toBe(false)
    await call(stub, 'release')
    expect((await call(stub, 'claim', { ttl: 5000 })).ok).toBe(true)
  })

  it('expires a stale lease so an owner is never locked out', async () => {
    const stub = env.PARTY_STATE.get(env.PARTY_STATE.idFromName(`lock-${Date.now()}-${seq++}`))
    expect((await call(stub, 'claim', { ttl: 1 })).ok).toBe(true)
    await new Promise(r => setTimeout(r, 5))
    expect((await call(stub, 'claim', { ttl: 5000 })).ok).toBe(true)
  })

  it('defaults the lease when no ttl is given and tolerates release of an unheld lock', async () => {
    const stub = env.PARTY_STATE.get(env.PARTY_STATE.idFromName(`lock-${Date.now()}-${seq++}`))
    expect((await call(stub, 'release')).ok).toBe(true)   // no-op, must not throw
    expect((await call(stub, 'claim', {})).ok).toBe(true) // default ttl
    expect((await call(stub, 'claim', {})).ok).toBe(false)
  })
})

describe('join', () => {
  it('adds members until full, then queues', async () => {
    const { stub } = await makeParty({ maxSize: 2 })
    const r1 = await call(stub, 'join', user('a'))
    expect(r1.status).toBe('joined')
    const r2 = await call(stub, 'join', user('b'))
    expect(r2.status).toBe('queued')
    expect(r2.data.queue.map((q: any) => q.userId)).toEqual(['b'])
  })

  it('queues joiners when the party is closed', async () => {
    const { stub } = await makeParty()
    await call(stub, 'close', { requesterId: 'owner' })
    const r = await call(stub, 'join', user('a'))
    expect(r.status).toBe('queued')
  })

  it('rejects duplicate joins', async () => {
    const { stub } = await makeParty({ maxSize: 2 })
    await call(stub, 'join', user('a'))
    expect((await call(stub, 'join', user('a'))).status).toBe('already_member')
    await call(stub, 'join', user('b'))
    expect((await call(stub, 'join', user('b'))).status).toBe('already_queued')
  })
})

describe('leave', () => {
  it('blocks the owner from leaving', async () => {
    const { stub } = await makeParty()
    expect((await call(stub, 'leave', { userId: 'owner' })).status).toBe('is_owner')
  })

  it('promotes the first queued user when a member leaves', async () => {
    const { stub } = await makeParty({ maxSize: 2 })
    await call(stub, 'join', user('a'))
    await call(stub, 'join', user('b'))
    await call(stub, 'join', user('c'))
    const r = await call(stub, 'leave', { userId: 'a' })
    expect(r.status).toBe('left')
    expect(r.promoted).toBe('b')
    expect(r.data.members.map((m: any) => m.userId)).toEqual(['owner', 'b'])
    expect(r.data.queue.map((q: any) => q.userId)).toEqual(['c'])
  })

  it('does not promote from queue while closed', async () => {
    const { stub } = await makeParty({ maxSize: 2 })
    await call(stub, 'join', user('a'))
    await call(stub, 'join', user('b'))
    await call(stub, 'close', { requesterId: 'owner' })
    const r = await call(stub, 'leave', { userId: 'a' })
    expect(r.promoted).toBeUndefined()
    expect(r.data.queue).toHaveLength(1)
  })

  it('dequeues a queued user', async () => {
    const { stub } = await makeParty({ maxSize: 1 })
    await call(stub, 'join', user('a'))
    expect((await call(stub, 'leave', { userId: 'a' })).status).toBe('dequeued')
  })
})

describe('approve / deny', () => {
  it('requires the owner', async () => {
    const { stub } = await makeParty({ maxSize: 1 })
    await call(stub, 'join', user('a'))
    expect((await call(stub, 'approve', { requesterId: 'a', userId: 'a' })).status).toBe('unauthorized')
    expect((await call(stub, 'deny', { requesterId: 'a', userId: 'a' })).status).toBe('unauthorized')
  })

  it('refuses to approve into a full party', async () => {
    const { stub } = await makeParty({ maxSize: 1 })
    await call(stub, 'join', user('a'))
    expect((await call(stub, 'approve', { requesterId: 'owner', userId: 'a' })).status).toBe('full')
  })

  it('moves an approved user from queue to members', async () => {
    const { stub } = await makeParty({ maxSize: 2 })
    await call(stub, 'close', { requesterId: 'owner' })
    await call(stub, 'join', user('a'))
    const r = await call(stub, 'approve', { requesterId: 'owner', userId: 'a' })
    expect(r.status).toBe('approved')
    expect(r.data.members.map((m: any) => m.userId)).toContain('a')
    expect(r.data.queue).toHaveLength(0)
  })
})

describe('open / close', () => {
  it('auto-promotes from the queue on open, up to the cap', async () => {
    const { stub } = await makeParty({ maxSize: 3 })
    await call(stub, 'close', { requesterId: 'owner' })
    await call(stub, 'join', user('a'))
    await call(stub, 'join', user('b'))
    await call(stub, 'join', user('c'))
    const r = await call(stub, 'open', { requesterId: 'owner' })
    expect(r.status).toBe('opened')
    expect(r.promoted).toEqual(['a', 'b'])
    expect(r.data.queue.map((q: any) => q.userId)).toEqual(['c'])
  })
})

describe('promote', () => {
  it('transfers ownership to a member', async () => {
    const { stub } = await makeParty()
    await call(stub, 'join', user('a'))
    const r = await call(stub, 'promote', { requesterId: 'owner', userId: 'a' })
    expect(r.status).toBe('promoted')
    expect(r.data.ownerId).toBe('a')
  })
})

describe('banlist', () => {
  it('assigns bans to members in paste order and recycles freed bans', async () => {
    const { stub } = await makeParty({ maxSize: 3 })
    await call(stub, 'join', user('a'))
    const r = await call(stub, 'setbanlist', { requesterId: 'owner', banlist: 'Aatrox\nAhri\nAkali' })
    expect(r.data.banlist.assignments).toEqual({ owner: 'Aatrox', a: 'Ahri' })

    // a leaves → their ban returns to the pool; next joiner gets the next pool entry
    await call(stub, 'leave', { userId: 'a' })
    const r2 = await call(stub, 'join', user('b'))
    expect(r2.data.banlist.assignments['b']).toBe('Akali')
    expect(r2.data.banlist.pool).toEqual(['Ahri'])
  })
})

describe('movequeue', () => {
  it('reorders queue entries and clamps at the edges', async () => {
    const { stub } = await makeParty({ maxSize: 1 })
    await call(stub, 'join', user('a'))
    await call(stub, 'join', user('b'))
    await call(stub, 'join', user('c'))

    const up = await call(stub, 'movequeue', { requesterId: 'owner', userId: 'c', direction: 'up' })
    expect(up.status).toBe('moved')
    expect(up.data.queue.map((q: any) => q.userId)).toEqual(['a', 'c', 'b'])

    const noop = await call(stub, 'movequeue', { requesterId: 'owner', userId: 'a', direction: 'up' })
    expect(noop.status).toBe('noop')

    expect((await call(stub, 'movequeue', { requesterId: 'a', userId: 'b', direction: 'up' })).status).toBe('unauthorized')
    expect((await call(stub, 'movequeue', { requesterId: 'owner', userId: 'zz', direction: 'up' })).status).toBe('not_queued')
  })
})

describe('update', () => {
  it('validates name and cap', async () => {
    const { stub } = await makeParty()
    await call(stub, 'join', user('a'))
    expect((await call(stub, 'update', { requesterId: 'owner', name: '  ' })).status).toBe('invalid')
    expect((await call(stub, 'update', { requesterId: 'owner', maxSize: 1 })).status).toBe('invalid')
    expect((await call(stub, 'update', { requesterId: 'owner', maxSize: 99 })).status).toBe('invalid')
    expect((await call(stub, 'update', { requesterId: 'a', name: 'x' })).status).toBe('unauthorized')
  })

  it('pulls from the queue when the cap grows on an open party', async () => {
    const { stub } = await makeParty({ maxSize: 1 })
    await call(stub, 'join', user('a'))
    await call(stub, 'join', user('b'))
    const r = await call(stub, 'update', { requesterId: 'owner', maxSize: 2 })
    expect(r.status).toBe('updated')
    expect(r.promoted).toEqual(['a'])
    expect(r.data.queue.map((q: any) => q.userId)).toEqual(['b'])
  })

  it('refreshes IGNs from the provided map when the game changes', async () => {
    const { stub } = await makeParty({ game: 'Other' })
    await call(stub, 'join', { ...user('a'), ign: 'old-ign' })
    const r = await call(stub, 'update', {
      requesterId: 'owner', game: 'Valorant', ignMap: { a: 'val-ign' },
    })
    expect(r.gameChanged).toBe(true)
    const a = r.data.members.find((m: any) => m.userId === 'a')
    expect(a.ign).toBe('val-ign')
    const owner = r.data.members.find((m: any) => m.userId === 'owner')
    expect(owner.ign).toBeUndefined()
  })
})

describe('setign', () => {
  it('updates a member IGN', async () => {
    const { stub } = await makeParty()
    await call(stub, 'join', user('a'))
    const r = await call(stub, 'setign', { userId: 'a', ign: 'NewName' })
    expect(r.status).toBe('updated')
    expect(r.data.members.find((m: any) => m.userId === 'a').ign).toBe('NewName')
  })
})

describe('toggleaway', () => {
  it('toggles the away marker on and off for members', async () => {
    const { stub } = await makeParty()
    await call(stub, 'join', user('a'))

    const on = await call(stub, 'toggleaway', { userId: 'a' })
    expect(on.status).toBe('toggled')
    expect(on.away).toBe(true)
    expect(on.data.members.find((m: any) => m.userId === 'a').away).toBe(true)

    const off = await call(stub, 'toggleaway', { userId: 'a' })
    expect(off.status).toBe('toggled')
    expect(off.away).toBe(false)
    expect(off.data.members.find((m: any) => m.userId === 'a').away).toBeUndefined()
  })

  it('rejects non-members (including queued users)', async () => {
    const { stub } = await makeParty({ maxSize: 1 })
    await call(stub, 'join', user('q'))  // party full → queued
    expect((await call(stub, 'toggleaway', { userId: 'q' })).status).toBe('not_in')
    expect((await call(stub, 'toggleaway', { userId: 'stranger' })).status).toBe('not_in')
  })
})

describe('disband', () => {
  it('only the owner can disband; forcedisband on empty storage reports gone', async () => {
    const { stub } = await makeParty()
    expect((await call(stub, 'disband', { requesterId: 'a' })).status).toBe('unauthorized')
    expect((await call(stub, 'disband', { requesterId: 'owner' })).status).toBe('disbanded')
    expect((await call(stub, 'forcedisband', {})).status).toBe('gone')
    // and the party is really gone
    expect(await call(stub, 'get')).toBeNull()
  })
})
