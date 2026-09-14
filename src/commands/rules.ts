import type { ComponentContext } from 'discord-hono'
import type { AppBindings, AppEnv, RulesConfig, RulesSession } from '../types'
import { extractMemberInfo } from '../lib/party'
import { addRole } from '../lib/discord'
import {
  clearSession, getMember, getRulesConfig, getRulesGate, getSession,
  grantApproval, saveSession,
} from '../store/rules'

/**
 * The member-facing rules check, as Discord interactions.
 *
 * This was a gateway bot: a persistent connection, an in-memory session per
 * member, and asyncio locks around every step. A Worker has none of those, so
 * the session lives in D1 and each click re-reads it. That is strictly better
 * in one way — a deploy no longer loses everyone's progress.
 *
 * One ephemeral message per check, edited in place the whole way through:
 * rules pages, then questions, then the agreement.
 */

export const START_BUTTON = 'rules_start'
export const STEP_BUTTON = 'rules_step'

/** custom_id payload: `<step>;<action>`, where action is next | agree | a<n>. */
function stepId(step: number, action: string): string {
  return `${STEP_BUTTON};${step};${action}`
}

const LETTERS = 'ABCDEFGH'

export function buildStartComponents() {
  return [{
    type: 1,
    components: [{ type: 2, style: 1, label: 'Start rules check', custom_id: `${START_BUTTON};go` }],
  }]
}

export function startMessage(config: RulesConfig) {
  const steps = config.questions.length
    ? `answer ${config.questions.length} question${config.questions.length === 1 ? '' : 's'}, and agree`
    : 'and agree'
  return {
    content: `**Rules & Conduct**\nRead all rules, ${steps} to get queue access. The check is private —`
      + ' only you can see it. Use `/party rules` to check your status.',
    components: buildStartComponents(),
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

/** The one embed, showing whichever step the session is on. */
export function renderStep(config: RulesConfig, session: RulesSession) {
  const total = config.questions.length
  if (session.page < config.pages.length) {
    const page = config.pages[session.page]!
    const last = session.page === config.pages.length - 1
    return {
      embeds: [{
        title: page.title,
        description: page.text.slice(0, 4000),
        color: 0x5865f2,
        footer: { text: `Rules ${session.page + 1}/${config.pages.length} · Version ${config.version}` },
      }],
      components: [{
        type: 1,
        components: [{
          type: 2, style: 1,
          label: last && total === 0 ? 'Continue to agreement' : last ? 'Continue to quiz' : 'Next rules page',
          custom_id: stepId(session.step, 'next'),
        }],
      }],
    }
  }

  if (session.question < total) {
    const question = config.questions[session.question]!
    const lines = session.answers.map((a, i) => `**${LETTERS[i]}.** ${a.text}`).join('\n')
    return {
      embeds: [{
        title: `Question ${session.question + 1}/${total}`,
        description: (session.feedback ? session.feedback + '\n\n' : '') + question.text + '\n\n' + lines,
        color: 0x5865f2,
        footer: { text: 'Every answer is explained. A wrong one can be retried.' },
      }],
      // Five per row is Discord's limit, and there can be up to eight answers.
      components: chunk(session.answers.map((_, i) => ({
        type: 2, style: 1, label: LETTERS[i]!, custom_id: stepId(session.step, `a${i}`),
      })), 5),
    }
  }

  return {
    embeds: [{
      title: total === 0 ? 'Final agreement' : `${total}/${total} correct — final agreement`,
      // Carries the last question's explanation, which nothing else would show.
      description: (session.feedback ? session.feedback + '\n\n' : '') + config.agreement,
      color: 0x5865f2,
      footer: { text: `Rules version ${config.version} · Agreeing gives you queue access.` },
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 3, label: 'I understand and agree', custom_id: stepId(session.step, 'agree') }],
    }],
  }
}

function chunk<T>(items: T[], size: number) {
  const rows = []
  for (let i = 0; i < items.length; i += size) {
    rows.push({ type: 1, components: items.slice(i, i + size) })
  }
  return rows
}

/** Lay out one question's answers in a random order, recording which are right. */
function shuffleAnswers(config: RulesConfig, index: number): RulesSession['answers'] {
  const question = config.questions[index]
  if (!question) return []
  const answers = [
    ...question.correct.map(text => ({ text, correct: true })),
    ...question.incorrect.map(text => ({ text, correct: false })),
  ]
  for (let i = answers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [answers[i], answers[j]] = [answers[j]!, answers[i]!]
  }
  return answers
}

// ── Start ────────────────────────────────────────────────────────────────────

export async function handleRulesStart(c: ComponentContext<AppEnv>) {
  return c.ephemeral().resDefer(async (c) => {
    const guildId = c.interaction.guild_id
    if (!guildId) return c.followup({ content: 'Use this inside the server.', flags: 64 })
    const { userId } = extractMemberInfo(c.interaction)

    try {
      const gate = await getRulesGate(c.env.DB, guildId)
      if (!gate?.enabled) {
        return c.followup({ content: 'The rules check is not switched on for this server.', flags: 64 })
      }

      const member = await getMember(c.env.DB, guildId, userId)
      if (member.state === 'approved') {
        return c.followup({ content: "You're already approved — you can join the queue.", flags: 64 })
      }
      if (member.state === 'granting' || member.state === 'revoking') {
        return c.followup({
          content: 'A role update is still being applied. Try again in a minute, or ask a moderator.',
          flags: 64,
        })
      }

      const config = await getRulesConfig(c.env.DB, guildId)
      const session: RulesSession = {
        page: 0, question: 0, step: 1,
        generation: member.generation, version: config.version,
        answers: config.pages.length === 0 ? shuffleAnswers(config, 0) : [],
        feedback: '', updatedAt: Date.now(),
      }
      await saveSession(c.env.DB, guildId, userId, session)
      return c.followup({ ...renderStep(config, session), flags: 64 })
    } catch (e) {
      console.error('rules start failed:', e)
      return c.followup({ content: 'Could not start the rules check. Please try again.', flags: 64 })
    }
  })
}

// ── Each step ────────────────────────────────────────────────────────────────

export async function handleRulesStep(c: ComponentContext<AppEnv>) {
  const raw = (c.interaction.data as any).custom_id as string
  const [stepRaw, action = ''] = raw.split(';')
  const guildId = c.interaction.guild_id!
  const { userId } = extractMemberInfo(c.interaction)

  const stale = (message: string) => c.resUpdate({ content: message, embeds: [], components: [] })

  try {
    const [session, member, config] = await Promise.all([
      getSession(c.env.DB, guildId, userId),
      getMember(c.env.DB, guildId, userId),
      getRulesConfig(c.env.DB, guildId),
    ])

    // Re-checked on every click, exactly as the Python bot did under its lock:
    // a revocation, a publish, or a second Start makes this view stale.
    if (!session || session.generation !== member.generation || session.version !== config.version
        || member.state !== 'unapproved') {
      return stale('This rules check is no longer valid. Start a fresh one.')
    }
    // A click from an already-replaced render: ignore rather than double-advance.
    if (Number(stepRaw) !== session.step) return c.resUpdate(renderStep(config, session))

    const next: RulesSession = { ...session, step: session.step + 1 }

    if (action === 'next') {
      next.page++
      if (next.page >= config.pages.length && next.question < config.questions.length) {
        next.answers = shuffleAnswers(config, next.question)
      }
    } else if (/^a\d+$/.test(action)) {   // an answer button, not 'agree'
      const picked = session.answers[Number(action.slice(1))]
      if (!picked) return c.resUpdate(renderStep(config, session))
      const question = config.questions[session.question]!
      // The explanation is shown either way: heading the retry when wrong,
      // heading whatever comes next when right.
      if (picked.correct) {
        next.feedback = `**Correct.** ${question.explanation}`
        next.question++
        next.answers = shuffleAnswers(config, next.question)
      } else {
        next.feedback = `**Please try again.** ${question.explanation}`
        next.answers = shuffleAnswers(config, session.question)
      }
    } else if (action === 'agree') {
      if (next.page < config.pages.length || next.question < config.questions.length) {
        return c.resUpdate(renderStep(config, session))
      }
      return await finish(c, guildId, userId, session, config)
    }

    await saveSession(c.env.DB, guildId, userId, next)
    return c.resUpdate(renderStep(config, next))
  } catch (e) {
    console.error('rules step failed:', e)
    return stale('That step could not finish. Start a fresh rules check.')
  }
}

/** Grant approval, and mirror it into a Discord role if the guild wants one. */
async function finish(
  c: ComponentContext<AppEnv>, guildId: string, userId: string,
  session: RulesSession, config: RulesConfig,
) {
  const gate = await getRulesGate(c.env.DB, guildId)
  const roleId = gate?.roleId
  const granted = await grantApproval(
    c.env.DB, guildId, userId, session.generation, config.version, !!roleId,
  )
  if (!granted) {
    return c.resUpdate({ content: 'This rules check is no longer valid. Start a fresh one.', embeds: [], components: [] })
  }
  await clearSession(c.env.DB, guildId, userId)

  let note = ''
  if (roleId) {
    try {
      await addRole(c.env.DISCORD_BOT_TOKEN, guildId, userId, roleId)
      await c.env.DB.prepare(
        "UPDATE rules_members SET state = 'approved' WHERE guild_id = ?1 AND user_id = ?2 AND state = 'granting'",
      ).bind(guildId, userId).run()
    } catch (e) {
      // Queue access already works; only the visible role is behind, and the
      // cron retries it.
      console.warn(`rules role grant pending for ${userId} in ${guildId}:`, e)
      note = '\nYour rules role is still being applied — that part will catch up shortly.'
    }
  }

  const member = await getMember(c.env.DB, guildId, userId)
  return c.resUpdate({
    content: `Approved — you can now join the queue.\nCompleted checks: **${member.completions}**`
      + ` · Lifetime revocations: **${member.revocations}**${note}`,
    embeds: [],
    components: [],
  })
}

/** Text for `/party rules`, and for the admin panel's member lookup. */
export function formatStatus(member: { state: string; completions: number; revocations: number; version: number | null }): string {
  const label = member.state === 'approved' ? 'Approved'
    : member.state === 'granting' ? 'Approved — role still being applied'
      : member.state === 'revoking' ? 'Not approved — role still being removed'
        : 'Not approved'
  return `**${label}**\nCompleted checks: **${member.completions}** · Lifetime revocations: **${member.revocations}**`
    + (member.version ? `\nAgreed to rules version ${member.version}.` : '')
}

export async function postRulesMessage(
  env: AppBindings, guildId: string, channelId: string,
): Promise<RulesConfig> {
  const config = await getRulesConfig(env.DB, guildId)
  const { postMessage } = await import('../lib/discord')
  await postMessage(env.DISCORD_BOT_TOKEN, channelId, startMessage(config))
  return config
}
