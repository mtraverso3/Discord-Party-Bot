import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import * as parties from '../src/store/parties'
import * as history from '../src/store/history'

let seq = 0

const user = (id: string) => ({ userId: id, username: `${id}_un`, displayName: id.toUpperCase() })

async function makeParty(opts: Partial<{ maxSize: number; game: string; name: string }> = {}) {
  const guildId = `hg-${Date.now()}-${seq++}`
  const created = await parties.createParty(env.DB, {
    id: 'HIST01',
    guildId,
    name: opts.name ?? 'History party',
    description: '',
    game: opts.game ?? 'Other',
    owner: user('owner'),
    maxSize: opts.maxSize ?? 3,
  })
  if (!created.ok) throw new Error(created.message)
  return { guildId, party: created.party }
}

async function events(guildId: string, partyId: string) {
  const id = await history.activeSessionId(env.DB, guildId, partyId)
  if (id == null) return []
  return history.getSessionEvents(env.DB, id)
}

describe('party history', () => {
  it('opens a session and logs creation', async () => {
    const { guildId, party } = await makeParty()
    const sessions = await history.listSessions(env.DB, guildId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.partyId).toBe(party.id)
    expect(sessions[0]!.endedAt).toBeUndefined()

    const ev = await events(guildId, party.id)
    expect(ev.map(e => e.event)).toEqual(['created'])
    expect(ev[0]!.userId).toBe('owner')
  })

  it('logs joins, queues, and leaves as people move in and out', async () => {
    const { guildId, party } = await makeParty({ maxSize: 2 })
    await parties.joinParty(env.DB, guildId, party.id, user('a'))  // joins as member
    await parties.joinParty(env.DB, guildId, party.id, user('b'))  // full → queued
    await parties.leaveParty(env.DB, guildId, party.id, 'a')       // b promoted

    const ev = await events(guildId, party.id)
    expect(ev.map(e => e.event)).toEqual(['created', 'joined', 'queued', 'left', 'promoted'])
    const left = ev.find(e => e.event === 'left')!
    expect(left.userId).toBe('a')
    const promoted = ev.find(e => e.event === 'promoted')!
    expect(promoted.userId).toBe('b')
  })

  it('labels an admin removal distinctly from a self-leave', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.removeMember(env.DB, guildId, party.id, 'owner', 'a')
    const ev = await events(guildId, party.id)
    expect(ev.map(e => e.event)).toContain('removed')
    expect(ev.map(e => e.event)).not.toContain('left')
  })

  it('logs close/open/game-changed/owner-changed', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.closeParty(env.DB, guildId, party.id, 'owner')
    await parties.openParty(env.DB, guildId, party.id, 'owner')
    await parties.updateParty(env.DB, guildId, party.id, { requesterId: 'owner', game: 'Valorant' })
    await parties.promoteOwner(env.DB, guildId, party.id, 'owner', 'a')

    const kinds = (await events(guildId, party.id)).map(e => e.event)
    expect(kinds).toContain('closed')
    expect(kinds).toContain('opened')
    expect(kinds).toContain('game_changed')
    expect(kinds).toContain('owner_changed')
  })

  it('closes the session with a reason on disband, preserving the log', async () => {
    const { guildId, party } = await makeParty()
    await parties.joinParty(env.DB, guildId, party.id, user('a'))
    await parties.disbandParty(env.DB, guildId, party.id, 'owner')

    // Party row is gone, but history survives.
    expect(await parties.getParty(env.DB, guildId, party.id)).toBeNull()
    const sessions = await history.listSessions(env.DB, guildId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]!.endReason).toBe('disbanded')
    expect(sessions[0]!.endedAt).toBeGreaterThan(0)

    const ev = await history.getSessionEvents(env.DB, sessions[0]!.historyId)
    expect(ev.map(e => e.event)).toContain('disbanded')
    expect(ev.map(e => e.event)).toContain('joined')
  })

  it('records inactivity sweeps with the tier reason', async () => {
    const { guildId, party } = await makeParty()
    await env.DB.prepare('UPDATE parties SET last_activity_at = ?3 WHERE guild_id = ?1 AND id = ?2')
      .bind(guildId, party.id, Date.now() - parties.INACTIVITY_SOLO_MS - 60_000).run()
    await parties.sweepInactiveParties(env.DB)
    const sessions = await history.listSessions(env.DB, guildId)
    expect(sessions[0]!.endReason).toMatch(/inactive/)
  })

  it('keeps separate sessions when a party id is reused after disband', async () => {
    const { guildId, party } = await makeParty()
    await parties.disbandParty(env.DB, guildId, party.id, 'owner')
    // Same id, fresh party.
    const again = await parties.createParty(env.DB, {
      id: party.id, guildId, name: 'Reused', description: '', game: 'Other',
      owner: user('owner2'), maxSize: 3,
    })
    expect(again.ok).toBe(true)
    const sessions = await history.listSessions(env.DB, guildId)
    expect(sessions).toHaveLength(2)
    // The active session is the newest, and logging targets only it.
    const activeId = await history.activeSessionId(env.DB, guildId, party.id)
    expect(activeId).toBe(sessions[0]!.historyId)
    expect(sessions[0]!.name).toBe('Reused')
    expect(sessions[1]!.endReason).toBe('disbanded')
  })
})
