import type { ComponentContext } from 'discord-hono'
import type { AppBindings, AppEnv, RulesConfig, RulesSession } from '../types'
import { extractMemberInfo } from '../lib/party'
import {
  clearSession, getMember, getRulesConfig, getRulesGate, getSession,
  grantApproval, revokeApproval, saveSession,
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
export const PAGE_BUTTON = 'rules_page'

/** custom_id payload: `<step>;<action>`, where action is next | agree | a<n>. */
function stepId(step: number, action: string): string {
  return `${STEP_BUTTON};${step};${action}`
}

const LETTERS = 'ABCDEFGH'

// Discord rejects an embed whose description passes this, and the editor's own
// limits allow a question that would: 600 for the question, 400 per answer with
// up to eight of them, and 1000 for the explanation carried in as feedback.
const EMBED_DESCRIPTION_MAX = 4096

/**
 * Question, answers, and the explanation from the last one, trimmed to fit.
 * The answers are what the member has to act on, so the explanation gives way
 * first and only then is the whole thing clipped.
 */
function questionDescription(feedback: string, question: string, answers: string): string {
  const body = question + '\n\n' + answers
  if (!feedback) return body.slice(0, EMBED_DESCRIPTION_MAX)

  const room = EMBED_DESCRIPTION_MAX - body.length - 2   // the blank line
  if (room >= feedback.length) return feedback + '\n\n' + body
  if (room > 40) return feedback.slice(0, room - 1) + '…' + '\n\n' + body
  return body.slice(0, EMBED_DESCRIPTION_MAX)
}

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
      + ' only you can see it. Use `/party rules-status` to check your status.',
    components: buildStartComponents(),
  }
}

// ── Read-only viewer ─────────────────────────────────────────────────────────

/**
 * The rules, for anyone who wants to read them without taking the check. No
 * session: the page number rides in the custom_id, so paging costs one
 * database read and nothing is left behind if they wander off.
 */
export function renderRulesPage(config: RulesConfig, page: number, approved: boolean) {
  const total = config.pages.length
  const index = Math.min(Math.max(page, 0), Math.max(total - 1, 0))
  const current = config.pages[index]
  if (!current) {
    return { content: 'This server has not written any rules yet.', embeds: [], components: [], flags: 64 }
  }
  return {
    embeds: [{
      title: current.title,
      description: current.text.slice(0, 4000),
      color: 0x5865f2,
      footer: {
        text: `Page ${index + 1}/${total} · Version ${config.version}`
          + (approved ? ' · You have passed the check' : ''),
      },
    }],
    components: [{
      type: 1,
      components: [
        {
          type: 2, style: 2, label: '◀ Previous',
          custom_id: `${PAGE_BUTTON};${index - 1}`, disabled: index <= 0,
        },
        {
          type: 2, style: 2, label: 'Next ▶',
          custom_id: `${PAGE_BUTTON};${index + 1}`, disabled: index >= total - 1,
        },
      ],
    }],
    flags: 64,
  }
}

/** Paging the read-only viewer. Editing in place keeps it to one message. */
export async function handleRulesPage(c: ComponentContext<AppEnv>) {
  const guildId = c.interaction.guild_id!
  const { userId } = extractMemberInfo(c.interaction)
  const page = parseInt((c.interaction.data as any).custom_id as string, 10)
  const [config, member] = await Promise.all([
    getRulesConfig(c.env.DB, guildId),
    getMember(c.env.DB, guildId, userId),
  ])
  const { flags, ...payload } = renderRulesPage(config, Number.isFinite(page) ? page : 0, member.state === 'approved')
  return c.resUpdate(payload)
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
        description: questionDescription(session.feedback, question.text, lines),
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
      description: ((session.feedback ? session.feedback + '\n\n' : '') + config.agreement)
        .slice(0, EMBED_DESCRIPTION_MAX),
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

/** Record the pass. Approval is ours, so it takes effect at once. */
async function finish(
  c: ComponentContext<AppEnv>, guildId: string, userId: string,
  session: RulesSession, config: RulesConfig,
) {
  const granted = await grantApproval(c.env.DB, guildId, userId, session.generation, config.version)
  if (!granted) {
    return c.resUpdate({ content: 'This rules check is no longer valid. Start a fresh one.', embeds: [], components: [] })
  }
  await clearSession(c.env.DB, guildId, userId)

  const member = await getMember(c.env.DB, guildId, userId)
  return c.resUpdate({
    content: `Approved — you can now join the queue.\nCompleted checks: **${member.completions}**`
      + ` · Lifetime revocations: **${member.revocations}**`,
    embeds: [],
    components: [],
  })
}

export interface ApprovalChange {
  counted: boolean    // a lifetime revocation was added
  message: string
}

/**
 * Withdraw approval, optionally as discipline. Shared by the moderator slash
 * commands and the dashboard so the two cannot drift apart on what a
 * revocation means. It takes effect immediately: approval is a row here, not a
 * Discord role that might refuse to come off.
 */
export async function changeApproval(
  env: AppBindings, guildId: string, userId: string,
  opts: { disciplinary: boolean; reason: string; actor: string },
): Promise<ApprovalChange> {
  const { counted } = await revokeApproval(
    env.DB, guildId, userId, opts.actor, opts.reason, opts.disciplinary,
  )
  return {
    counted,
    message: opts.disciplinary
      ? `Approval removed. Lifetime revocations: ${counted ? 'increased by 1' : 'unchanged'}.`
      : 'They must take the rules check again. No disciplinary count was added.',
  }
}

/** Text for `/party rules-status`, and for the admin panel's member lookup. */
export function formatStatus(member: { state: string; completions: number; revocations: number; version: number | null }): string {
  const label = member.state === 'approved' ? 'Approved' : 'Not approved'
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
