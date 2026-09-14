import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRulesStart, handleRulesStep } from '../src/commands/rules'
import { getMember, getSession, publishRulesConfig, revokeApproval, saveRulesGate } from '../src/store/rules'
import { rulesAccess } from '../src/lib/rules'

// The member-facing rules check, which used to be the Python bot's in-memory
// quiz. The session lives in D1 now, so each click re-reads it — which is what
// makes the staleness checks below meaningful rather than theoretical.

let seq = 0
const guild = () => String(200000000000000000n + BigInt(++seq))
const MEMBER = '800000000000000001'

const CONFIG = {
  pages: [
    { title: 'Page one', text: 'Read this.' },
    { title: 'Page two', text: 'And this.' },
  ],
  questions: [
    { text: 'First?', correct: ['Right one'], incorrect: ['Wrong one'], explanation: 'Because first.' },
    { text: 'Second?', correct: ['Also right'], incorrect: ['Also wrong'], explanation: 'Because second.' },
  ],
  agreement: 'I agree to everything.',
}

let discord: ReturnType<typeof vi.fn>
const originalFetch = globalThis.fetch

beforeEach(() => {
  discord = vi.fn(async () => new Response(null, { status: 204 }))
  globalThis.fetch = discord as any
})
afterEach(() => { globalThis.fetch = originalFetch })

/** Stands in for discord-hono's ComponentContext, capturing what it renders. */
function context(guildId: string, customId: string, userId = MEMBER) {
  const sent: any[] = []
  const c: any = {
    env,
    sent,
    interaction: { guild_id: guildId, data: { custom_id: customId }, member: { user: { id: userId, username: 'member' } } },
    followup: (payload: any) => { sent.push(payload); return payload },
    resUpdate: (payload: any) => { sent.push(payload); return payload },
  }
  c.ephemeral = () => c
  c.resDefer = async (fn: any) => fn(c)
  return c
}

const lastEmbed = (c: any) => c.sent.at(-1)?.embeds?.[0]
const lastText = (c: any) => c.sent.at(-1)?.content ?? ''
/**
 * The payload a handler actually receives for the button showing `label`.
 * discord-hono routes on the part before the first ';' and hands the handler
 * only what follows, so the fixture drops it the same way.
 */
function buttonFor(c: any, label: string): string {
  for (const row of c.sent.at(-1)?.components ?? []) {
    for (const button of row.components) {
      if (button.label === label) return button.custom_id.split(';').slice(1).join(';')
    }
  }
  throw new Error(`no button labelled ${label}`)
}

async function setup(config: any = CONFIG, gate: { roleId?: string } = {}) {
  const guildId = guild()
  await saveRulesGate(env.DB, guildId, { enabled: true, ...gate })
  const published = await publishRulesConfig(env.DB, guildId, config, 1, false, 'admin')
  if (!published.ok) throw new Error(published.error)
  return guildId
}

/** Click through to the first question, returning the context that rendered it. */
async function toFirstQuestion(guildId: string) {
  const start = context(guildId, 'rules_start;go')
  await handleRulesStart(start)
  let c = start
  for (let i = 0; i < CONFIG.pages.length; i++) {
    const next = context(guildId, buttonFor(c, i === CONFIG.pages.length - 1 ? 'Continue to quiz' : 'Next rules page'))
    await handleRulesStep(next)
    c = next
  }
  return c
}

/** Answer the question on screen, correctly or not. */
async function answer(guildId: string, c: any, correct: boolean) {
  const embed = lastEmbed(c)
  const session = await getSession(env.DB, guildId, MEMBER)
  const index = session!.answers.findIndex(a => a.correct === correct)
  expect(embed.description).toContain(session!.answers[index]!.text)
  const next = context(guildId, buttonFor(c, 'ABCDEFGH'[index]!))
  await handleRulesStep(next)
  return next
}

describe('rules quiz', () => {
  it('walks the rules pages, then the questions, then the agreement', async () => {
    const guildId = await setup()
    const start = context(guildId, 'rules_start;go')
    await handleRulesStart(start)
    expect(lastEmbed(start).title).toBe('Page one')
    expect(lastEmbed(start).footer.text).toContain('Rules 1/2')

    const page2 = context(guildId, buttonFor(start, 'Next rules page'))
    await handleRulesStep(page2)
    expect(lastEmbed(page2).title).toBe('Page two')

    const q1 = context(guildId, buttonFor(page2, 'Continue to quiz'))
    await handleRulesStep(q1)
    expect(lastEmbed(q1).title).toBe('Question 1/2')
    expect(lastEmbed(q1).description).toContain('First?')
  })

  it('explains a wrong answer and keeps the same question', async () => {
    const guildId = await setup()
    const q1 = await toFirstQuestion(guildId)
    const retry = await answer(guildId, q1, false)

    expect(lastEmbed(retry).title).toBe('Question 1/2')
    expect(lastEmbed(retry).description).toContain('Please try again.')
    expect(lastEmbed(retry).description).toContain('Because first.')
    expect((await getSession(env.DB, guildId, MEMBER))!.question).toBe(0)
  })

  it('explains a correct answer too, heading the next question', async () => {
    const guildId = await setup()
    const q1 = await toFirstQuestion(guildId)
    const q2 = await answer(guildId, q1, true)

    expect(lastEmbed(q2).title).toBe('Question 2/2')
    expect(lastEmbed(q2).description).toContain('**Correct.** Because first.')
    expect(lastEmbed(q2).description).toContain('Second?')
  })

  it('carries the last explanation onto the agreement', async () => {
    const guildId = await setup()
    const q2 = await answer(guildId, await toFirstQuestion(guildId), true)
    const agreement = await answer(guildId, q2, true)

    expect(lastEmbed(agreement).title).toBe('2/2 correct — final agreement')
    expect(lastEmbed(agreement).description).toContain('**Correct.** Because second.')
    expect(lastEmbed(agreement).description).toContain('I agree to everything.')
  })

  it('approves on agreement, and the queue gate sees it immediately', async () => {
    const guildId = await setup()
    const agreement = await answer(guildId, await answer(guildId, await toFirstQuestion(guildId), true), true)

    const done = context(guildId, buttonFor(agreement, 'I understand and agree'))
    await handleRulesStep(done)

    expect(lastText(done)).toContain('Approved')
    expect(lastText(done)).toContain('Completed checks: **1**')
    expect((await getMember(env.DB, guildId, MEMBER)).state).toBe('approved')
    expect(await getSession(env.DB, guildId, MEMBER)).toBeNull()
    await rulesAccess(env).require(guildId, MEMBER)
  })

  it('goes straight to the agreement when there is no quiz', async () => {
    const guildId = await setup({ ...CONFIG, questions: [] })
    const start = context(guildId, 'rules_start;go')
    await handleRulesStart(start)

    let c = start
    for (let i = 0; i < CONFIG.pages.length; i++) {
      const next = context(guildId, buttonFor(c, i === CONFIG.pages.length - 1 ? 'Continue to agreement' : 'Next rules page'))
      await handleRulesStep(next)
      c = next
    }
    expect(lastEmbed(c).title).toBe('Final agreement')

    const done = context(guildId, buttonFor(c, 'I understand and agree'))
    await handleRulesStep(done)
    expect((await getMember(env.DB, guildId, MEMBER)).state).toBe('approved')
  })

  it('ignores a click from an already-replaced render', async () => {
    const guildId = await setup()
    const q1 = await toFirstQuestion(guildId)
    const staleId = buttonFor(q1, 'A')
    await answer(guildId, q1, true)   // now on question 2

    const doubleClick = context(guildId, staleId)
    await handleRulesStep(doubleClick)

    // Redrawn where we actually are, not advanced a second time.
    expect(lastEmbed(doubleClick).title).toBe('Question 2/2')
    expect((await getSession(env.DB, guildId, MEMBER))!.question).toBe(1)
  })

  it('invalidates a quiz when approval is revoked underneath it', async () => {
    const guildId = await setup()
    const q1 = await toFirstQuestion(guildId)
    await revokeApproval(env.DB, guildId, MEMBER, 'mod', 'Mid-quiz', true, false)

    const click = context(guildId, buttonFor(q1, 'A'))
    await handleRulesStep(click)
    expect(lastText(click)).toContain('no longer valid')
  })

  it('invalidates a quiz when an admin publishes new rules', async () => {
    const guildId = await setup()
    const q1 = await toFirstQuestion(guildId)
    await publishRulesConfig(env.DB, guildId, { ...CONFIG, agreement: 'New terms.' }, 2, false, 'admin')

    const click = context(guildId, buttonFor(q1, 'A'))
    await handleRulesStep(click)
    expect(lastText(click)).toContain('no longer valid')
  })

  it('tells an approved member there is nothing to do', async () => {
    const guildId = await setup()
    const agreement = await answer(guildId, await answer(guildId, await toFirstQuestion(guildId), true), true)
    await handleRulesStep(context(guildId, buttonFor(agreement, 'I understand and agree')))

    const again = context(guildId, 'rules_start;go')
    await handleRulesStart(again)
    expect(lastText(again)).toContain('already approved')
  })

  it('refuses to start when the gate is off', async () => {
    const guildId = await setup()
    await saveRulesGate(env.DB, guildId, { enabled: false })
    const start = context(guildId, 'rules_start;go')
    await handleRulesStart(start)
    expect(lastText(start)).toContain('not switched on')
  })

  it('mirrors approval into the Discord role when one is configured', async () => {
    const roleId = '900000000000000009'
    const guildId = await setup(CONFIG, { roleId })
    const agreement = await answer(guildId, await answer(guildId, await toFirstQuestion(guildId), true), true)
    await handleRulesStep(context(guildId, buttonFor(agreement, 'I understand and agree')))

    const [url, init] = discord.mock.calls.at(-1) as any
    expect(url).toContain(`/guilds/${guildId}/members/${MEMBER}/roles/${roleId}`)
    expect(init.method).toBe('PUT')
    expect((await getMember(env.DB, guildId, MEMBER)).state).toBe('approved')
  })

  it('still approves when Discord will not apply the role, leaving it pending', async () => {
    discord = vi.fn(async () => new Response('nope', { status: 403 }))
    globalThis.fetch = discord as any

    const guildId = await setup(CONFIG, { roleId: '900000000000000009' })
    const agreement = await answer(guildId, await answer(guildId, await toFirstQuestion(guildId), true), true)
    const done = context(guildId, buttonFor(agreement, 'I understand and agree'))
    await handleRulesStep(done)

    expect(lastText(done)).toContain('still being applied')
    // Queue access does not wait on the role; only the role is behind.
    expect((await getMember(env.DB, guildId, MEMBER)).state).toBe('granting')
    expect((await getMember(env.DB, guildId, MEMBER)).completions).toBe(1)
  })
})
