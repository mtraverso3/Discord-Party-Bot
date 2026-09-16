import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleParty } from '../src/commands/party'
import { handleRulesPage } from '../src/commands/rules'
import { publishRulesConfig } from '../src/store/rules'
import { approveManually, getMember, memberHistory, saveRulesGate } from '../src/store/rules'
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

/**
 * Run one /party subcommand and return whatever it replied with. A `rules-*`
 * name is sent the way Discord really sends it — nested inside the `rules`
 * subcommand group — so the dispatcher's unwrapping is covered here too.
 */
async function run(guildId: string, name: string, opts: Record<string, any> = {}, permissions = MANAGE_ROLES) {
  const sent: any[] = []
  const args = Object.entries(opts).map(([k, v]) => ({ name: k, value: v }))
  const options = name.startsWith('rules-')
    ? [{ type: 2, name: 'rules', options: [{ type: 1, name: name.slice(6), options: args }] }]
    : [{ type: 1, name, options: args }]
  const c: any = {
    env,
    interaction: {
      guild_id: guildId,
      channel_id: '700000000000000009',
      member: { user: { id: MOD, username: 'mod' }, permissions },
      data: { options },
    },
    followup: (payload: any) => { sent.push(payload); return payload },
  }
  c.ephemeral = () => c
  c.res = (payload: any) => { sent.push(payload); return payload }
  c.resDefer = async (fn: any) => fn(c)
  await handleParty(c)
  return (sent.at(-1)?.content ?? '') as string
}

/** As `run`, but returns the whole payload — the quiz replies with embeds. */
async function runRaw(guildId: string, name: string, permissions = NO_PERMS) {
  const sent: any[] = []
  const c: any = {
    env,
    interaction: {
      guild_id: guildId,
      channel_id: '700000000000000009',
      member: { user: { id: MOD, username: 'mod' }, permissions },
      data: { options: [{ type: 2, name: 'rules', options: [{ type: 1, name: name.slice(6), options: [] }] }] },
    },
    followup: (payload: any) => { sent.push(payload); return payload },
  }
  c.ephemeral = () => c
  c.res = (payload: any) => { sent.push(payload); return payload }
  c.resDefer = async (fn: any) => fn(c)
  await handleParty(c)
  return sent.at(-1)
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

  it('approves a member without the quiz, and says so in their history', async () => {
    const g = guild()
    await gated(g)

    const text = await run(g, 'rules-approve', { member: TARGET, reason: 'Vouched for by staff' })
    expect(text).toContain('approved without taking the check')
    await rulesAccess(env).require(g, TARGET)   // the queue gate sees it at once

    const member = await getMember(env.DB, g, TARGET)
    expect(member.state).toBe('approved')
    // Not a check they took, so the count of checks taken must not move.
    expect(member.completions).toBe(0)

    const [event] = await memberHistory(env.DB, g, TARGET)
    expect(event!.kind).toBe('approved')
    expect(event!.reason).toBe('Vouched for by staff')
    expect(event!.actor).toContain(MOD)
  })

  it('lifts a revocation, and does not write a second entry for someone already approved', async () => {
    const g = guild()
    await gated(g)
    await env.DB.prepare(`
      INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
      VALUES (?1, ?2, 'approved', 0, 0, 1, 1, ?3)
    `).bind(g, TARGET, Date.now()).run()
    await run(g, 'rules-revoke', { member: TARGET, reason: 'Left mid-series' })

    expect(await run(g, 'rules-approve', { member: TARGET, reason: 'Sorted out' })).toContain('approved without')
    await rulesAccess(env).require(g, TARGET)
    // The lifetime count stands: approving again does not erase the history.
    expect((await getMember(env.DB, g, TARGET)).revocations).toBe(1)

    const before = (await memberHistory(env.DB, g, TARGET)).length
    expect(await run(g, 'rules-approve', { member: TARGET, reason: 'Again' })).toContain('already approved')
    expect(await memberHistory(env.DB, g, TARGET)).toHaveLength(before)
  })

  it('needs Manage Roles and a reason, like the other moderator commands', async () => {
    const g = guild()
    await gated(g)
    expect(await run(g, 'rules-approve', { member: TARGET, reason: 'x' }, NO_PERMS)).toContain('Manage Roles')
    expect(await run(g, 'rules-approve', { member: TARGET, reason: '  ' })).toContain('Give a reason')
    expect((await getMember(env.DB, g, TARGET)).state).toBe('unapproved')

    const off = guild()
    expect(await run(off, 'rules-approve', { member: TARGET, reason: 'x' })).toContain("hasn't switched the rules check on")
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

  describe('/party rules read — the read-only viewer', () => {
    const RULES = {
      pages: [
        { title: 'First page', text: 'Read this first.' },
        { title: 'Second page', text: 'Then this.' },
        { title: 'Third page', text: 'Finally this.' },
      ],
      questions: [],
      agreement: 'I agree.',
    }

    /** Click a pager button, returning what the message was replaced with. */
    async function page(guildId: string, customId: string) {
      const sent: any[] = []
      const c: any = {
        env,
        interaction: {
          guild_id: guildId,
          data: { custom_id: customId },
          member: { user: { id: MOD, username: 'mod' }, permissions: NO_PERMS },
        },
        resUpdate: (payload: any) => { sent.push(payload); return payload },
      }
      await handleRulesPage(c)
      return sent.at(-1)
    }

    const buttons = (payload: any) => payload.components[0].components
      .map((b: any) => ({ label: b.label, id: b.custom_id, disabled: !!b.disabled }))

    it('opens on the first page with Previous disabled', async () => {
      const g = guild()
      await gated(g)
      await publishRulesConfig(env.DB, g, RULES, 1, false, 'admin')

      const sent: any[] = []
      const c: any = {
        env,
        interaction: {
          guild_id: g,
          member: { user: { id: MOD, username: 'mod' }, permissions: NO_PERMS },
          data: { options: [{ type: 2, name: 'rules', options: [{ type: 1, name: 'read', options: [] }] }] },
        },
        followup: (p: any) => { sent.push(p); return p },
      }
      c.ephemeral = () => c
      c.res = (p: any) => { sent.push(p); return p }
      c.resDefer = async (fn: any) => fn(c)
      await handleParty(c)

      const payload = sent.at(-1)
      expect(payload.embeds[0].title).toBe('First page')
      expect(payload.embeds[0].footer.text).toContain('Page 1/3')
      expect(payload.flags).toBe(64)   // only they can see it
      expect(buttons(payload)).toEqual([
        { label: '◀ Previous', id: 'rules_page;-1', disabled: true },
        { label: 'Next ▶', id: 'rules_page;1', disabled: false },
      ])
    })

    it('pages forward and back, and stops at both ends', async () => {
      const g = guild()
      await gated(g)
      await publishRulesConfig(env.DB, g, RULES, 1, false, 'admin')

      const second = await page(g, '1')
      expect(second.embeds[0].title).toBe('Second page')
      expect(buttons(second).every((b: any) => !b.disabled)).toBe(true)

      const third = await page(g, '2')
      expect(third.embeds[0].title).toBe('Third page')
      expect(buttons(third)[1].disabled).toBe(true)   // no Next past the end

      const back = await page(g, '1')
      expect(back.embeds[0].title).toBe('Second page')
    })

    it('clamps a page number that is out of range', async () => {
      const g = guild()
      await gated(g)
      await publishRulesConfig(env.DB, g, RULES, 1, false, 'admin')

      expect((await page(g, '99')).embeds[0].title).toBe('Third page')
      expect((await page(g, '-5')).embeds[0].title).toBe('First page')
      expect((await page(g, 'nonsense')).embeds[0].title).toBe('First page')
    })

    it('keeps a long history inside the message limit', async () => {
      const g = guild()
      await gated(g)
      for (let i = 0; i < 12; i++) {
        await env.DB.prepare(`
          INSERT INTO rules_events (guild_id, user_id, kind, actor, reason, created_at)
          VALUES (?1, ?2, 'revoked', 'Moderator Name (610000000000000009)', ?3, ?4)
        `).bind(g, TARGET, 'r'.repeat(500), Date.now() + i).run()
      }
      // Ten entries at 500 characters each came to 5817 — Discord takes 2000.
      const text = await run(g, 'rules-history', { member: TARGET })
      expect(text.length).toBeLessThanOrEqual(2000)
      expect(text).toContain(`<@${TARGET}>`)
    })

    it('does not show the built-in sample rules as if they were the server’s', async () => {
      const untouched = guild()
      expect(await run(untouched, 'rules-read', {}, NO_PERMS)).toContain("hasn't set up a rules check")
    })
  })
  describe('/party rules quiz — starting the check on demand', () => {
    const RULES = {
      pages: [{ title: 'Conduct', text: 'Be decent.' }],
      questions: [],
      agreement: 'I agree.',
    }

    it('opens the check at the first rules page', async () => {
      const g = guild()
      await gated(g)
      await publishRulesConfig(env.DB, g, RULES, 1, false, 'admin')

      const payload = await runRaw(g, 'rules-quiz')
      expect(payload.embeds[0].title).toBe('Conduct')
      expect(payload.flags).toBe(64)
      // A session exists now, so the button has something to advance.
      expect(payload.components[0].components[0].label).toContain('Continue')
    })

    it('needs no party, and no posted Start button', async () => {
      const g = guild()
      await gated(g)
      await publishRulesConfig(env.DB, g, RULES, 1, false, 'admin')

      const payload = await runRaw(g, 'rules-quiz')
      expect(payload.embeds).toBeTruthy()
      // Nothing had to be posted to Discord to make this reachable.
      expect(discord).not.toHaveBeenCalled()
    })

    it('refuses when the server has the check switched off', async () => {
      const off = guild()
      await publishRulesConfig(env.DB, off, RULES, 1, false, 'admin')
      expect((await runRaw(off, 'rules-quiz')).content).toContain("hasn't switched the rules check on")
    })

    it('tells an approved member there is nothing to take', async () => {
      const g = guild()
      await gated(g)
      await publishRulesConfig(env.DB, g, RULES, 1, false, 'admin')
      await approveManually(env.DB, g, MOD, 'admin', 'Vouched for', 1)

      expect((await runRaw(g, 'rules-quiz')).content).toContain('already approved')
    })
  })

})
