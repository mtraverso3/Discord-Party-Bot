import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import * as parties from '../src/store/parties'

let seq = 0

const user = (id: string) => ({ userId: id, username: `${id}_un`, displayName: id.toUpperCase() })

/** Fresh guild with a party of `maxSize` owned by "owner". */
async function makeParty(opts: Partial<{ maxSize: number; game: string; name: string }> = {}) {
  const guildId = `g-${Date.now()}-${seq++}`
  const created = await parties.createParty(env.DB, {
    id: 'TEST01',
    guildId,
    name: opts.name ?? 'Test party',
    description: '',
    game: opts.game ?? 'Other',
    owner: user('owner'),
    maxSize: opts.maxSize ?? 3,
  })
  if (!created.ok) throw new Error(created.message)
  return { guildId, party: created.party }
}

describe('create', () => {
  it('starts with the owner as the only member', async () => {
    const { party } = await makeParty()
    expect(party.members).toHaveLength(1)
    expect(party.members[0]!.userId).toBe('owner')
    expect(party.ownerName).toBe('OWNER')
    expect(party.queue).toHaveLength(0)
    expect(party.isClosed).toBe(false)
  })

  it('rejects a second party for the same owner (constraint, not a lock)', async () => {
    const { guildId } = await makeParty()
    const second = await parties.createParty(env.DB, {
      id: 'TEST02', guildId, name: 'Second', description: '', game: 'Other',
      owner: user('owner'), maxSize: 3,
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toBe('owner_in_party')
    // and no orphaned party row survived the rolled-back transaction
    expect(await parties.getParty(env.DB, guildId, 'TEST02')).toBeNull()
  })

  it('rejects an ID collision without touching the existing party', async () => {
    const { guildId } = await makeParty()
    const dup = await parties.createParty(env.DB, {
      id: 'TEST01', guildId, name: 'Clobbered', description: '', game: 'Other',
      owner: user('other'), maxSize: 3,
    })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toBe('id_taken')
    const untouched = await parties.getParty(env.DB, guildId, 'TEST01')
    expect(untouched!.name).toBe('Test party')
    expect(untouched!.members.map(m => m.userId)).toEqual(['owner'])
  })

  it('rejects malformed create payloads', async () => {
    const bad = async (patch: any) => {
      const r = await parties.createParty(env.DB, {
        id: 'X', guildId: `g-bad-${seq++}`, name: '', description: '', game: 'Other',
        owner: user('o'), maxSize: 3, ...patch,
      })
      expect(r.ok).toBe(false)
    }
    await bad({ owner: { userId: '', username: '', displayName: '' } })  // no owner
    await bad({ maxSize: 99 })   // cap too high
    await bad({ maxSize: 0 })    // cap too low
    await bad({ maxSize: 2.5 })  // fractional
  })

  it('falls back to the owner name when no name is given', async () => {
    const { party } = await makeParty({ name: '' })
    expect(party.name).toBe("OWNER's party")
  })
})

describe('join', () => {
  it('adds members until full, then queues', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    const r1 = await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect(r1.status).toBe('joined')
    const r2 = await parties.joinParty(env.DB, guildId, party.id, user('b'))
    expect(r2.status).toBe('queued')
    expect(r2.data!.queue.map(q => q.userId)).toEqual(['b'])
  })

  it('queues joiners when the party is closed', async () => {
    const { guildId, party } = await makeParty()
    await parties.closeParty(env.DB, guildId, party.id, 'owner')
    const r = await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect(r.status).toBe('queued')
  })

  it('rejects duplicate joins', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect((await parties.joinParty(env.DB, guildId, party.id, user('a'))).status).toBe('already_member')
    await parties.joinParty(env.DB, guildId, party.id, user('b'))
    expect((await parties.joinParty(env.DB, guildId, party.id, user('b'))).status).toBe('already_queued')
  })

  it('rejects joining a second party in the same guild', async () => {
    const { guildId, party } = await makeParty()
    const other = await parties.createParty(env.DB, {
      id: 'OTHER1', guildId, name: 'Other party', description: '', game: 'Other',
      owner: user('owner2'), maxSize: 3,
    })
    expect(other.ok).toBe(true)
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    const r = await parties.joinParty(env.DB, guildId, 'OTHER1', user('a'))
    expect(r.status).toBe('in_other_party')
  })

  it('reports not_found for a missing party', async () => {
    const r = await parties.joinParty(env.DB, `g-none-${seq++}`, 'NOPE', user('a'))
    expect(r.status).toBe('not_found')
  })
})

describe('leave', () => {
  it('blocks the owner from leaving', async () => {
    const { guildId, party } = await makeParty()
    expect((await parties.leaveParty(env.DB, guildId, party.id, 'owner')).status).toBe('is_owner')
  })

  it('promotes the first queued user when a member leaves', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.joinParty(env.DB, guildId, party.id, user('b'))
    await parties.joinParty(env.DB, guildId, party.id, user('c'))
    const r = await parties.leaveParty(env.DB, guildId, party.id, 'a')
    expect(r.status).toBe('left')
    expect(r.promoted).toBe('b')
    expect(r.data!.members.map(m => m.userId)).toEqual(['owner', 'b'])
    expect(r.data!.queue.map(q => q.userId)).toEqual(['c'])
  })

  it('does not promote from queue while closed', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.joinParty(env.DB, guildId, party.id, user('b'))
    await parties.closeParty(env.DB, guildId, party.id, 'owner')
    const r = await parties.leaveParty(env.DB, guildId, party.id, 'a')
    expect(r.promoted).toBeUndefined()
    expect(r.data!.queue).toHaveLength(1)
  })

  it('dequeues a queued user', async () => {
    const { guildId, party } = await makeParty({ maxSize: 1 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect((await parties.leaveParty(env.DB, guildId, party.id, 'a')).status).toBe('dequeued')
  })
})

describe('approve / deny', () => {
  it('requires the owner', async () => {
    const { guildId, party } = await makeParty({ maxSize: 1 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect((await parties.approveQueued(env.DB, guildId, party.id, 'a', 'a')).status).toBe('unauthorized')
    expect((await parties.denyQueued(env.DB, guildId, party.id, 'a', 'a')).status).toBe('unauthorized')
  })

  it('refuses to approve into a full party', async () => {
    const { guildId, party } = await makeParty({ maxSize: 1 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect((await parties.approveQueued(env.DB, guildId, party.id, 'owner', 'a')).status).toBe('full')
  })

  it('moves an approved user from queue to members', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    await parties.closeParty(env.DB, guildId, party.id, 'owner')
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    const r = await parties.approveQueued(env.DB, guildId, party.id, 'owner', 'a')
    expect(r.status).toBe('approved')
    expect(r.data!.members.map(m => m.userId)).toContain('a')
    expect(r.data!.queue).toHaveLength(0)
  })
})

describe('open / close', () => {
  it('auto-promotes from the queue on open, up to the cap', async () => {
    const { guildId, party } = await makeParty({ maxSize: 3 })
    await parties.closeParty(env.DB, guildId, party.id, 'owner')
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.joinParty(env.DB, guildId, party.id, user('b'))
    await parties.joinParty(env.DB, guildId, party.id, user('c'))
    const r = await parties.openParty(env.DB, guildId, party.id, 'owner')
    expect(r.status).toBe('opened')
    expect(r.promoted).toEqual(['a', 'b'])
    expect(r.data!.queue.map(q => q.userId)).toEqual(['c'])
  })
})

describe('promote', () => {
  it('transfers ownership to a member', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    const r = await parties.promoteOwner(env.DB, guildId, party.id, 'owner', 'a')
    expect(r.status).toBe('promoted')
    expect(r.data!.ownerId).toBe('a')
    expect(r.data!.ownerName).toBe('A')
  })
})

describe('banlist', () => {
  it('assigns bans to members in paste order and recycles freed bans', async () => {
    const { guildId, party } = await makeParty({ maxSize: 3 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    const r = await parties.setBanlist(env.DB, guildId, party.id, 'owner', 'Aatrox\nAhri\nAkali')
    expect(r.data!.banlist!.assignments).toEqual({ owner: 'Aatrox', a: 'Ahri' })

    // a leaves → their ban returns to the pool; next joiner gets the next pool entry
    await parties.leaveParty(env.DB, guildId, party.id, 'a')
    const r2 = await parties.joinParty(env.DB, guildId, party.id, user('b'))
    expect(r2.data!.banlist!.assignments['b']).toBe('Akali')
    expect(r2.data!.banlist!.pool).toEqual(['Ahri'])
  })

  it('assigns a recycled ban to a promoted queue member', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.setBanlist(env.DB, guildId, party.id, 'owner', 'Aatrox\nAhri')
    await parties.joinParty(env.DB, guildId, party.id, user('b'))  // queued, pool empty
    const r = await parties.leaveParty(env.DB, guildId, party.id, 'a')
    expect(r.promoted).toBe('b')
    expect(r.data!.banlist!.assignments).toEqual({ owner: 'Aatrox', b: 'Ahri' })
  })

  it('clears the banlist on an empty paste', async () => {
    const { guildId, party } = await makeParty()
    await parties.setBanlist(env.DB, guildId, party.id, 'owner', 'Aatrox')
    const r = await parties.setBanlist(env.DB, guildId, party.id, 'owner', '  \n ')
    expect(r.data!.banlist).toBeUndefined()
  })
})

describe('movequeue', () => {
  it('reorders queue entries and clamps at the edges', async () => {
    const { guildId, party } = await makeParty({ maxSize: 1 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.joinParty(env.DB, guildId, party.id, user('b'))
    await parties.joinParty(env.DB, guildId, party.id, user('c'))

    const up = await parties.moveQueued(env.DB, guildId, party.id, 'owner', 'c', 'up')
    expect(up.status).toBe('moved')
    expect(up.data!.queue.map(q => q.userId)).toEqual(['a', 'c', 'b'])

    const noop = await parties.moveQueued(env.DB, guildId, party.id, 'owner', 'a', 'up')
    expect(noop.status).toBe('noop')

    expect((await parties.moveQueued(env.DB, guildId, party.id, 'a', 'b', 'up')).status).toBe('unauthorized')
    expect((await parties.moveQueued(env.DB, guildId, party.id, 'owner', 'zz', 'up')).status).toBe('not_queued')
  })
})

describe('update', () => {
  it('validates name and cap', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect((await parties.updateParty(env.DB, guildId, party.id, { requesterId: 'owner', name: '  ' })).status).toBe('invalid')
    expect((await parties.updateParty(env.DB, guildId, party.id, { requesterId: 'owner', maxSize: 1 })).status).toBe('invalid')
    expect((await parties.updateParty(env.DB, guildId, party.id, { requesterId: 'owner', maxSize: 99 })).status).toBe('invalid')
    expect((await parties.updateParty(env.DB, guildId, party.id, { requesterId: 'a', name: 'x' })).status).toBe('unauthorized')
  })

  it('pulls from the queue when the cap grows on an open party', async () => {
    const { guildId, party } = await makeParty({ maxSize: 1 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.joinParty(env.DB, guildId, party.id, user('b'))
    const r = await parties.updateParty(env.DB, guildId, party.id, { requesterId: 'owner', maxSize: 2 })
    expect(r.status).toBe('updated')
    expect(r.promoted).toEqual(['a'])
    expect(r.data!.queue.map(q => q.userId)).toEqual(['b'])
  })

  it('refreshes IGNs from the provided map when the game changes', async () => {
    const { guildId, party } = await makeParty({ game: 'Other' })
    await parties.joinParty(env.DB, guildId, party.id, { ...user('a'), ign: 'old-ign' })
    const r = await parties.updateParty(env.DB, guildId, party.id, {
      requesterId: 'owner', game: 'Valorant', ignMap: { a: 'val-ign' },
    })
    expect(r.gameChanged).toBe(true)
    const a = r.data!.members.find(m => m.userId === 'a')
    expect(a!.ign).toBe('val-ign')
    const owner = r.data!.members.find(m => m.userId === 'owner')
    expect(owner!.ign).toBeUndefined()
  })
})

describe('setign / toggleaway', () => {
  it('updates a member IGN', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    const r = await parties.setMemberIgn(env.DB, guildId, party.id, 'a', 'NewName')
    expect(r.status).toBe('updated')
    expect(r.data!.members.find(m => m.userId === 'a')!.ign).toBe('NewName')
  })

  it('toggles the away marker on and off for members', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))

    const on = await parties.toggleAway(env.DB, guildId, party.id, 'a')
    expect(on.status).toBe('toggled')
    expect(on.away).toBe(true)
    expect(on.data!.members.find(m => m.userId === 'a')!.away).toBe(true)

    const off = await parties.toggleAway(env.DB, guildId, party.id, 'a')
    expect(off.status).toBe('toggled')
    expect(off.away).toBe(false)
    expect(off.data!.members.find(m => m.userId === 'a')!.away).toBeUndefined()
  })

  it('rejects non-members (including queued users)', async () => {
    const { guildId, party } = await makeParty({ maxSize: 1 })
    await parties.joinParty(env.DB, guildId, party.id, user('q'))  // party full → queued
    expect((await parties.toggleAway(env.DB, guildId, party.id, 'q')).status).toBe('not_in')
    expect((await parties.toggleAway(env.DB, guildId, party.id, 'stranger')).status).toBe('not_in')
  })
})

describe('disband', () => {
  it('only the owner can disband; membership rows are cascaded away', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    expect((await parties.disbandParty(env.DB, guildId, party.id, 'a')).status).toBe('unauthorized')
    expect((await parties.disbandParty(env.DB, guildId, party.id, 'owner')).status).toBe('disbanded')
    expect((await parties.disbandParty(env.DB, guildId, party.id)).status).toBe('not_found')
    // the party and everyone's membership really are gone
    expect(await parties.getParty(env.DB, guildId, party.id)).toBeNull()
    expect(await parties.getUserPartyId(env.DB, guildId, 'owner')).toBeNull()
    expect(await parties.getUserPartyId(env.DB, guildId, 'a')).toBeNull()
  })
})

describe('find / list', () => {
  it('finds parties by ID (case-insensitive) and exact name', async () => {
    const { guildId, party } = await makeParty({ name: 'My Party' })
    expect(await parties.findPartyId(env.DB, guildId, 'test01')).toBe(party.id)
    expect(await parties.findPartyId(env.DB, guildId, 'MY PARTY')).toBe(party.id)
    expect(await parties.findPartyId(env.DB, guildId, 'nope')).toBeNull()
  })

  it('lists all parties in a guild with members attached', async () => {
    const { guildId, party } = await makeParty()
    await parties.createParty(env.DB, {
      id: 'SECOND', guildId, name: 'Second', description: '', game: 'Other',
      owner: user('owner2'), maxSize: 3,
    })
    const all = await parties.listParties(env.DB, guildId)
    expect(all.map(p => p.id)).toEqual([party.id, 'SECOND'])
    expect(all[0]!.members).toHaveLength(1)
    expect(await parties.countParties(env.DB, guildId)).toBe(2)
  })
})

describe('inactivity sweep', () => {
  async function ageParty(guildId: string, partyId: string, ms: number) {
    await env.DB.prepare('UPDATE parties SET last_activity_at = ?3 WHERE guild_id = ?1 AND id = ?2')
      .bind(guildId, partyId, Date.now() - ms).run()
  }

  it('disbands solo parties after the solo threshold only', async () => {
    const { guildId, party } = await makeParty()
    await ageParty(guildId, party.id, parties.INACTIVITY_SOLO_MS - 60_000)
    expect(await parties.sweepInactiveParties(env.DB)).toHaveLength(0)

    await ageParty(guildId, party.id, parties.INACTIVITY_SOLO_MS + 60_000)
    const swept = await parties.sweepInactiveParties(env.DB)
    expect(swept).toHaveLength(1)
    expect(swept[0]!.party.id).toBe(party.id)
    expect(await parties.getParty(env.DB, guildId, party.id)).toBeNull()
  })

  it('gives full parties the long rope', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))  // full now
    await ageParty(guildId, party.id, parties.INACTIVITY_PARTIAL_MS + 60_000)
    expect(await parties.sweepInactiveParties(env.DB)).toHaveLength(0)

    await ageParty(guildId, party.id, parties.INACTIVITY_FULL_MS + 60_000)
    expect(await parties.sweepInactiveParties(env.DB)).toHaveLength(1)
  })

  it('uses the partial tier for multi-member (not full) parties', async () => {
    const { guildId, party } = await makeParty({ maxSize: 5 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await ageParty(guildId, party.id, parties.INACTIVITY_SOLO_MS + 60_000)
    expect(await parties.sweepInactiveParties(env.DB)).toHaveLength(0)

    await ageParty(guildId, party.id, parties.INACTIVITY_PARTIAL_MS + 60_000)
    expect(await parties.sweepInactiveParties(env.DB)).toHaveLength(1)
  })
})
