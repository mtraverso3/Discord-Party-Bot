import { describe, expect, it } from 'vitest'
import { buildPartyEmbed, embedSize } from '../src/lib/embeds'
import type { PartyData } from '../src/types'

const id = (i: number) => String(100000000000000000n + BigInt(i))

function party(opts: { members: number; queue?: number; ign?: string; ban?: string; voice?: boolean }): PartyData {
  const members = Array.from({ length: opts.members }, (_, i) => ({
    userId: id(i), username: `u${i}`, displayName: `U${i}`, ign: opts.ign, joinedAt: i,
  }))
  return {
    id: 'EMB001', guildId: 'g', name: 'N'.repeat(100), description: 'D'.repeat(1000), game: 'LoL NA',
    ownerId: id(0), ownerName: 'U0', maxSize: 50, isClosed: false, rulesRequired: true,
    voiceChannelId: opts.voice ? id(999) : undefined, createdAt: 0,
    members,
    queue: Array.from({ length: opts.queue ?? 0 }, (_, i) => ({
      userId: id(1000 + i), username: `q${i}`, displayName: `Q${i}`, ign: opts.ign, queuedAt: i,
    })),
    banlist: opts.ban
      ? { source: [], pool: [], assignments: Object.fromEntries(members.map(m => [m.userId, opts.ban!])) }
      : undefined,
  }
}

function expectWithinLimits(embed: ReturnType<typeof buildPartyEmbed>) {
  expect(embedSize(embed)).toBeLessThanOrEqual(6000)
  expect(embed.fields.length).toBeLessThanOrEqual(25)
  for (const f of embed.fields) {
    expect(f.value.length).toBeGreaterThan(0)
    expect(f.value.length).toBeLessThanOrEqual(1024)
    expect(f.name.length).toBeLessThanOrEqual(256)
  }
}

const text = (embed: ReturnType<typeof buildPartyEmbed>) => embed.fields.map(f => f.value).join('\n')

describe('party embed limits', () => {
  it('keeps a small party in one members field', () => {
    const embed = buildPartyEmbed(party({ members: 3 }))
    expect(embed.fields).toHaveLength(1)
    expect(embed.fields[0]!.name).toBe('Members — 3/50')
  })

  it('spreads a full roster over several fields and lists everyone', () => {
    const embed = buildPartyEmbed(party({ members: 50, voice: true }))
    expectWithinLimits(embed)
    expect(embed.fields.filter(f => f.value.includes('<@')).length).toBeGreaterThan(1)
    for (let i = 0; i < 50; i++) expect(text(embed)).toContain(`<@${id(i)}>`)
    expect(text(embed)).not.toContain('more')
  })

  it('summarises what does not fit, and still shows the queue', () => {
    const embed = buildPartyEmbed(party({ members: 50, queue: 80, ign: 'I'.repeat(100), ban: 'B'.repeat(80), voice: true }))
    expectWithinLimits(embed)
    expect(text(embed)).toMatch(/…and \d+ more/)
    expect(embed.fields.some(f => f.name === 'Queue — 80 waiting')).toBe(true)
    expect(embed.fields.some(f => f.name === 'Voice Channel')).toBe(true)
  })

  it('clips one oversized line instead of dropping the rest', () => {
    const embed = buildPartyEmbed(party({ members: 5, ban: 'X'.repeat(2000) }))
    expectWithinLimits(embed)
    for (let i = 0; i < 5; i++) expect(text(embed)).toContain(`<@${id(i)}>`)
  })
})
