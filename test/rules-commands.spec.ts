import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleParty } from '../src/commands/party'
import { getMember, memberHistory, saveRulesGate } from '../src/store/rules'
import { rulesAccess } from '../src/lib/rules'

// The rules-* moderator commands. Discord does not enforce
// default_member_permissions on subcommands, so the Manage Roles requirement
// is ours to apply — which is most of what is worth testing here.

const MANAGE_ROLES = (0x10000000).toString()
const ADMINISTRATOR = (0x8).toString()
const NO_PERMS = '0'

let seq = 0
const guild = () => String(500000000000000000n + BigInt(++seq))
const MOD = '510000000000000001'
const TARGET = '510000000000000002'

let discord: ReturnType<typeof vi.fn>
const original = globalThis.fetch

beforeEach(() => {
  discord = vi.fn(async () => Response.json({ id: 'posted', channel_id: 'chan' }))
  globalThis.fetch = discord as any
})
afterEach(() => { globalThis.fetch = original })

/** Run one /party subcommand and return whatever it replied with. */
async function run(guildId: string, name: string, opts: Record<string, any> = {}, permissions = MANAGE_ROLES) {
  const sent: any[] = []
  const c: any = {
    env,
    interaction: {
      guild_id: guildId,
      channel_id: '700000000000000009',
      member: { user: { id: MOD, username: 'mod' }, permissions },
      data: { options: [{ name, options: Object.entries(opts).map(([k, v]) => ({ name: k, value: v })) }] },
    },
    followup: (payload: any) => { sent.push(payload); return payload },
  }
  c.ephemeral = () => c
  c.res = (payload: any) => { sent.push(payload); return payload }
  c.resDefer = async (fn: any) => fn(c)
  await handleParty(c)
  return (sent.at(-1)?.content ?? '') as string
}

const gated = async (guildId: string, channelId?: string) =>
  saveRulesGate(env.DB, guildId, { enabled: true, ...(channelId ? { channelId } : {}) })

describe('rules moderator commands', () => {
  it.each([
    ['rules-post', {}],
    ['rules-history', { member: TARGET }],
    ['rules-revoke', { member: TARGET, reason: 'Because' }],
    ['rules-reset', { member: TARGET, reason: 'Because' }],
  ])('refuses /party %s without Manage Roles', async (name, opts) => {
    const g = guild()
    await gated(g, '700000000000000001')
    expect(await run(g, name, opts, NO_PERMS)).toContain('Manage Roles')
    // Nothing happened: no post, no state change.
    expect(discord).not.toHaveBeenCalled()
    expect((await getMember(env.DB, g, TARGET)).state).toBe('unapproved')
    expect(await memberHistory(env.DB, g, TARGET)).toHaveLength(0)
  })

  it('accepts Administrator in place of Manage Roles', async () => {
    const g = guild()
    await gated(g, '700000000000000001')
    expect(await run(g, 'rules-post', {}, ADMINISTRATOR)).toContain('Posted the rules check')
  })

  it('posts the Start button in the configured channel', async () => {
    const g = guild()
    await gated(g, '700000000000000002')
    expect(await run(g, 'rules-post')).toContain('<#700000000000000002>')

    const [url, init] = discord.mock.calls[0] as any
    expect(url).toContain('/channels/700000000000000002/messages')
    expect(JSON.parse(init.body).components[0].components[0].custom_id).toContain('rules_start')
  })

  it('says what is missing rather than posting nowhere', async () => {
    const off = guild()
    expect(await run(off, 'rules-post')).toContain("hasn't switched the rules check on")

    const noChannel = guild()
    await gated(noChannel)
    expect(await run(noChannel, 'rules-post')).toContain('No rules channel is set')
    expect(discord).not.toHaveBeenCalled()
  })

  it('shows a member’s counters and history', async () => {
    const g = guild()
    await gated(g)
    // Approve first: revoking someone who never passed takes nothing away, so
    // it records a reset rather than a revocation.
    await env.DB.prepare(`
      INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
      VALUES (?1, ?2, 'approved', 0, 0, 1, 1, ?3)
    `).bind(g, TARGET, Date.now()).run()
    await run(g, 'rules-revoke', { member: TARGET, reason: 'Left mid-series' })

    const text = await run(g, 'rules-history', { member: TARGET })
    expect(text).toContain(`<@${TARGET}>`)
    expect(text).toContain('Not approved')
    expect(text).toContain('Left mid-series')
    expect(text).toContain('revoked')
  })

  it('revokes with a count, and resets without one', async () => {
    const g = guild()
    await gated(g)
    await env.DB.prepare(`
      INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
      VALUES (?1, ?2, 'approved', 0, 0, 1, 1, ?3)
    `).bind(g, TARGET, Date.now()).run()

    const revoked = await run(g, 'rules-revoke', { member: TARGET, reason: 'Left mid-series' })
    expect(revoked).toContain('increased by 1')
    await expect(rulesAccess(env).require(g, TARGET)).rejects.toThrow('rules check')

    const reset = await run(g, 'rules-reset', { member: TARGET, reason: 'New season' })
    expect(reset).toContain('No disciplinary count')
    expect((await getMember(env.DB, g, TARGET)).revocations).toBe(1)
  })

  it('records who acted, so history is attributable', async () => {
    const g = guild()
    await gated(g)
    await run(g, 'rules-revoke', { member: TARGET, reason: 'Ignored a ruling' })

    const [event] = await memberHistory(env.DB, g, TARGET)
    expect(event!.actor).toContain(MOD)
  })

  it('lets anyone check their own status', async () => {
    const g = guild()
    await gated(g)
    const text = await run(g, 'rules-status', {}, NO_PERMS)
    expect(text).toContain('Not approved')
    expect(text).toContain('Start rules check')
  })
})
