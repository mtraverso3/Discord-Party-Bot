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

async function setup(config: any = CONFIG, gate: { defaultRequired?: boolean } = {}) {
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

  it('explains a wrong answer and moves on without scoring it', async () => {
    const guildId = await setup()
    const q1 = await toFirstQuestion(guildId)
    const q2 = await answer(guildId, q1, false)

    expect(lastEmbed(q2).title).toBe('Question 2/2')
    expect(lastEmbed(q2).description).toContain('**Incorrect.** Because first.')
    const session = (await getSession(env.DB, guildId, MEMBER))!
    expect(session.question).toBe(1)
    expect(session.correct).toBe(0)
  })

  it('refuses the run when it lands under the passing score', async () => {
    const guildId = await setup()
    // Default is 100%: one wrong answer out of two is 50%.
    const agreement = await answer(guildId, await answer(guildId, await toFirstQuestion(guildId), false), true)
    const done = context(guildId, buttonFor(agreement, 'I understand and agree'))
    await handleRulesStep(done)

    expect(lastText(done)).toContain('50%')
    expect(lastText(done)).toContain('100%')
    expect((await getMember(env.DB, guildId, MEMBER)).state).toBe('unapproved')
    // The failed run is cleared, so starting again is a clean slate.
    expect(await getSession(env.DB, guildId, MEMBER)).toBeNull()
  })

  it('approves a run that clears a lowered bar', async () => {
    const guildId = await setup({ ...CONFIG, passingScore: 50 })
    const agreement = await answer(guildId, await answer(guildId, await toFirstQuestion(guildId), false), true)
    const done = context(guildId, buttonFor(agreement, 'I understand and agree'))
    await handleRulesStep(done)

    expect(lastText(done)).toContain('Approved')
    expect(lastText(done)).toContain('50%')
    expect((await getMember(env.DB, guildId, MEMBER)).state).toBe('approved')
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

  it('approves immediately, with nothing left pending', async () => {
    const guildId = await setup()
    const agreement = await answer(guildId, await answer(guildId, await toFirstQuestion(guildId), true), true)
    const done = context(guildId, buttonFor(agreement, 'I understand and agree'))
    await handleRulesStep(done)

    // No Discord role to wait on, so approval is final the moment it is given.
    expect((await getMember(env.DB, guildId, MEMBER)).state).toBe('approved')
    expect(lastText(done)).not.toContain('still being applied')
    expect(discord).not.toHaveBeenCalled()
  })

  it('keeps the biggest question Discord will allow inside its embed limit', async () => {
    // Every value here is the maximum the editor accepts, which together came
    // to 4889 characters — past the 4096 Discord takes.
    const long = (n: number) => 'x'.repeat(n)
    // Distinct, as the validator requires, but still the full 400 each.
    // Not named `answer`: that would shadow the helper this test calls.
    const maxAnswer = (tag: string) => 'x'.repeat(399) + tag
    const maxQuestion = () => ({
      text: long(600),
      correct: ['a', 'b', 'c', 'd'].map(maxAnswer),
      incorrect: ['e', 'f', 'g', 'h'].map(maxAnswer),
      explanation: long(1000),
    })
    // Two of them: the second is what renders with an explanation carried in,
    // now that a wrong answer advances rather than re-asking.
    const huge = {
      pages: [{ title: 'P', text: 'read' }],
      questions: [maxQuestion(), maxQuestion()],
      agreement: long(3000),
      passingScore: 100,
    }
    const guildId = await setup(huge)
    // One page here, so walk it directly rather than via the shared helper.
    const start = context(guildId, 'rules_start;go')
    await handleRulesStart(start)
    const q1 = context(guildId, buttonFor(start, 'Continue to quiz'))
    await handleRulesStep(q1)
    expect(lastEmbed(q1).description.length).toBeLessThanOrEqual(4096)

    // And the next one, which carries the previous explanation in too.
    const q2 = await answer(guildId, q1, false)
    expect(lastEmbed(q2).description.length).toBeLessThanOrEqual(4096)
    // The answers survive the trim — they are what the member has to act on.
    for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
      expect(() => buttonFor(q2, letter)).not.toThrow()
    }

    const agreement = await answer(guildId, q2, true)
    expect(lastEmbed(agreement).description.length).toBeLessThanOrEqual(4096)
  })
})
