import type {
  RulesConfig, RulesEvent, RulesGate, RulesMemberRow, RulesQuestion, RulesSession,
} from '../types'
import { DEFAULT_RULES } from '../lib/rules-content'

// All rules state: the published text and quiz, who has passed, the audit
// trail, and any quiz in flight. Mutations are guarded statements, the same
// way the party store works.

export const MAX_PAGES = 8
export const ANSWER_MAX = 4
/** A question needs a right answer; wrong ones are optional. */
export const ANSWER_MIN = { correct: 1, incorrect: 0 } as const
/** A quiz left untouched this long is abandoned and can be swept. */
export const SESSION_TTL_MS = 15 * 60 * 1000

// ── Config ───────────────────────────────────────────────────────────────────

export async function getRulesConfig(db: D1Database, guildId: string): Promise<RulesConfig> {
  const row = await db.prepare('SELECT * FROM rules_config WHERE guild_id = ?1').bind(guildId)
    .first<{ version: number; pages: string; questions: string; agreement: string; passing_score: number }>()
  if (!row) return structuredClone(DEFAULT_RULES)
  return {
    version: row.version,
    pages: JSON.parse(row.pages),
    questions: JSON.parse(row.questions),
    agreement: row.agreement,
    passingScore: row.passing_score,
  }
}

/** Whether the guild has published rules of its own, rather than the defaults. */
export async function hasPublishedRules(db: D1Database, guildId: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM rules_config WHERE guild_id = ?1').bind(guildId).first()
  return !!row
}

export type PublishResult =
  | { ok: true; config: RulesConfig; requeued: number }
  | { ok: false; error: string; conflict?: boolean }

/**
 * Store a new version. `expectedVersion` is the version the editor loaded: a
 * mismatch means someone else published first, and this write is refused
 * rather than silently overwriting them.
 *
 * `requireReapproval` marks every approved member for a fresh check. It does
 * not touch revocation counts — it is not disciplinary.
 */
export async function publishRulesConfig(
  db: D1Database, guildId: string, input: unknown, expectedVersion: number,
  requireReapproval: boolean, actor: string,
): Promise<PublishResult> {
  const validated = validateRulesConfig(input)
  if (!validated.ok) return { ok: false, error: validated.error }

  const current = await getRulesConfig(db, guildId)
  if (current.version !== expectedVersion) {
    return { ok: false, error: 'Another admin published changes. Reload before editing.', conflict: true }
  }

  const version = current.version + 1
  const now = Date.now()
  const config = { ...validated.config, version }
  await db.prepare(`
    INSERT INTO rules_config
      (guild_id, version, pages, questions, agreement, passing_score, updated_at, updated_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT (guild_id) DO UPDATE SET
      version = ?2, pages = ?3, questions = ?4, agreement = ?5, passing_score = ?6,
      updated_at = ?7, updated_by = ?8
  `).bind(guildId, version, JSON.stringify(config.pages), JSON.stringify(config.questions),
    config.agreement, config.passingScore, now, actor).run()

  // Any quiz in flight referenced the old version and is now stale; the next
  // click on it reports that rather than grading against replaced questions.
  await db.prepare('DELETE FROM rules_sessions WHERE guild_id = ?1').bind(guildId).run()

  let requeued = 0
  if (requireReapproval) {
    // Who is losing approval has to be read before the update, since
    // afterwards they are indistinguishable from everyone else unapproved.
    const { results } = await db.prepare(
      "SELECT user_id FROM rules_members WHERE guild_id = ?1 AND state = 'approved'",
    ).bind(guildId).all<{ user_id: string }>()
    requeued = results.length

    if (requeued > 0) {
      await db.prepare(`
        UPDATE rules_members SET state = 'unapproved', generation = generation + 1,
          version = NULL, accepted_at = NULL
        WHERE guild_id = ?1 AND state = 'approved'
      `).bind(guildId).run()
      // Not disciplinary, so revoked_at stays clear and an exempt admin keeps
      // their exemption.
      await db.prepare(`
        INSERT INTO rules_events (guild_id, user_id, kind, actor, reason, created_at)
        SELECT ?1, value, 'reset', ?2, ?3, ?4 FROM json_each(?5)
      `).bind(guildId, actor, `Rules version ${version} published; fresh check required`, now,
        JSON.stringify(results.map(r => r.user_id))).run()
    }
  }
  return { ok: true, config, requeued }
}

export type ValidationResult =
  | { ok: true; config: Omit<RulesConfig, 'version'> }
  | { ok: false; error: string }

/** The same bounds the editor enforces, checked again before anything stores. */
export function validateRulesConfig(raw: any): ValidationResult {
  const text = (value: unknown, label: string, limit: number): string | null => {
    if (typeof value !== 'string' || !value.trim() || value.length > limit) return null
    return value.trim()
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid rules document.' }

  const agreement = text(raw.agreement, 'Agreement', 3000)
  if (!agreement) return { ok: false, error: 'The agreement must be 1–3000 characters.' }

  if (!Array.isArray(raw.pages) || raw.pages.length < 1 || raw.pages.length > MAX_PAGES) {
    return { ok: false, error: `Provide 1–${MAX_PAGES} rules pages.` }
  }
  const pages = []
  for (const page of raw.pages) {
    const title = text(page?.title, 'Page title', 200)
    const body = text(page?.text, 'Page text', 3800)
    if (!title || !body) return { ok: false, error: 'Every page needs a title and text.' }
    pages.push({ title, text: body })
  }

  // No cap on how many questions a server asks: the quiz is walked one
  // question at a time, so length costs nothing at render. The request size
  // limit in admin/rules.ts is the only practical ceiling.
  if (!Array.isArray(raw.questions)) return { ok: false, error: 'Invalid quiz.' }
  const questions: RulesQuestion[] = []
  for (const question of raw.questions) {
    const prompt = text(question?.text, 'Question', 600)
    const explanation = text(question?.explanation, 'Explanation', 1000)
    if (!prompt || !explanation) return { ok: false, error: 'Every question needs text and an explanation.' }
    const groups: Record<'correct' | 'incorrect', string[]> = { correct: [], incorrect: [] }
    for (const field of ['correct', 'incorrect'] as const) {
      const values = question?.[field]
      if (!Array.isArray(values) || values.length < ANSWER_MIN[field] || values.length > ANSWER_MAX) {
        return { ok: false, error: `Each question needs ${ANSWER_MIN[field]}–${ANSWER_MAX} ${field} answers.` }
      }
      for (const value of values) {
        const answer = text(value, 'Answer', 400)
        if (!answer) return { ok: false, error: 'Every answer needs text.' }
        groups[field].push(answer)
      }
    }
    const all = [...groups.correct, ...groups.incorrect]
    if (new Set(all.map(a => a.toLowerCase())).size !== all.length) {
      return { ok: false, error: 'Every answer within a question must be distinct.' }
    }
    questions.push({ text: prompt, correct: groups.correct, incorrect: groups.incorrect, explanation })
  }

  // Absent in configs published before the passing score existed.
  const passingScore = raw.passingScore === undefined ? 100 : Number(raw.passingScore)
  if (!Number.isInteger(passingScore) || passingScore < 0 || passingScore > 100) {
    return { ok: false, error: 'The passing score must be a whole number from 0 to 100.' }
  }

  return { ok: true, config: { pages, questions, agreement, passingScore } }
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export async function getRulesGate(db: D1Database, guildId: string): Promise<RulesGate | null> {
  const row = await db.prepare('SELECT * FROM rules_gate WHERE guild_id = ?1').bind(guildId)
    .first<{ enabled: number; default_required: number; channel_id: string | null }>()
  if (!row) return null
  return {
    enabled: !!row.enabled,
    defaultRequired: !!row.default_required,
    channelId: row.channel_id ?? undefined,
  }
}

export async function saveRulesGate(
  db: D1Database, guildId: string, gate: Partial<RulesGate>,
): Promise<RulesGate> {
  const current = await getRulesGate(db, guildId)
  const next: RulesGate = {
    // A row created as a side effect — posting the Start button, say — must not
    // turn the gate on. Only an explicit `enabled: true` does that, so nothing
    // starts refusing members without someone choosing it.
    enabled: gate.enabled ?? current?.enabled ?? false,
    defaultRequired: gate.defaultRequired ?? current?.defaultRequired ?? false,
    channelId: gate.channelId !== undefined ? gate.channelId : current?.channelId,
  }
  await db.prepare(`
    INSERT INTO rules_gate (guild_id, enabled, channel_id, default_required)
    VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (guild_id) DO UPDATE SET enabled = ?2, channel_id = ?3, default_required = ?4
  `).bind(guildId, next.enabled ? 1 : 0, next.channelId || null, next.defaultRequired ? 1 : 0).run()
  return next
}

// ── Members ──────────────────────────────────────────────────────────────────

export async function getMember(db: D1Database, guildId: string, userId: string): Promise<RulesMemberRow> {
  const row = await db.prepare('SELECT * FROM rules_members WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).first<RulesMemberRow>()
  return row ?? {
    guild_id: guildId, user_id: userId, state: 'unapproved',
    generation: 0, revocations: 0, completions: 0, version: null, accepted_at: null,
  }
}

export async function listMembers(db: D1Database, guildId: string): Promise<RulesMemberRow[]> {
  const { results } = await db.prepare('SELECT * FROM rules_members WHERE guild_id = ?1 ORDER BY user_id')
    .bind(guildId).all<RulesMemberRow>()
  return results
}

export async function memberCounts(
  db: D1Database, guildId: string,
): Promise<{ total: number; approved: number }> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(state = 'approved'), 0) AS approved
    FROM rules_members WHERE guild_id = ?1
  `).bind(guildId).first<{ total: number; approved: number }>()
  return row ?? { total: 0, approved: 0 }
}

/**
 * Those of `userIds` whose approval was taken away as discipline and who have
 * not passed since. Admins are exempt from the check, but not from this.
 */
export async function filterRevoked(
  db: D1Database, guildId: string, userIds: string[],
): Promise<string[]> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return []
  const { results } = await db.prepare(`
    SELECT user_id FROM rules_members
    WHERE guild_id = ?1 AND revoked_at IS NOT NULL AND user_id IN (SELECT value FROM json_each(?2))
  `).bind(guildId, JSON.stringify(ids)).all<{ user_id: string }>()
  return results.map(r => r.user_id)
}

/** The approved subset of `userIds` — what the party gate asks for. */
export async function filterApproved(
  db: D1Database, guildId: string, userIds: string[],
): Promise<string[]> {
  const ids = [...new Set(userIds)]
  if (ids.length === 0) return []
  const { results } = await db.prepare(`
    SELECT user_id FROM rules_members
    WHERE guild_id = ?1 AND state = 'approved' AND user_id IN (SELECT value FROM json_each(?2))
  `).bind(guildId, JSON.stringify(ids)).all<{ user_id: string }>()
  return results.map(r => r.user_id)
}

export async function logEvent(
  db: D1Database, guildId: string, userId: string,
  kind: 'verified' | 'approved' | 'revoked' | 'reset', actor: string | null, reason: string,
): Promise<void> {
  await db.prepare(`
    INSERT INTO rules_events (guild_id, user_id, kind, actor, reason, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  `).bind(guildId, userId, kind, actor, reason, Date.now()).run()
}

export async function memberHistory(
  db: D1Database, guildId: string, userId: string, limit = 10,
): Promise<RulesEvent[]> {
  const { results } = await db.prepare(`
    SELECT id, user_id, kind, actor, reason, created_at FROM rules_events
    WHERE guild_id = ?1 AND user_id = ?2 ORDER BY id DESC LIMIT ?3
  `).bind(guildId, userId, limit).all<{
    id: number; user_id: string; kind: string; actor: string | null; reason: string; created_at: number
  }>()
  return results.map(r => ({
    id: r.id, userId: r.user_id, kind: r.kind,
    actor: r.actor ?? undefined, reason: r.reason, createdAt: r.created_at,
  }))
}

/**
 * Record a pass. Guarded on the generation the quiz started with, so a
 * revocation mid-quiz makes this a no-op rather than approving someone whose
 * approval was just pulled.
 */
export async function grantApproval(
  db: D1Database, guildId: string, userId: string, generation: number, version: number,
): Promise<boolean> {
  // Most members have no row until their first pass, so this inserts as well
  // as updates. The guard rides on the conflict branch: an existing row only
  // moves if it is still on the generation the quiz started with.
  const res = await db.prepare(`
    INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
    VALUES (?1, ?2, 'approved', ?3, 0, 1, ?4, ?5)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      state = 'approved', completions = completions + 1, version = ?4, accepted_at = ?5, revoked_at = NULL
    WHERE rules_members.generation = ?3 AND rules_members.state = 'unapproved'
  `).bind(guildId, userId, generation, version, Date.now()).run()
  if (!res.meta.changes) return false
  await logEvent(db, guildId, userId, 'verified', userId, 'Completed quiz and agreement')
  return true
}

/**
 * Approve without the quiz — a moderator vouching for someone. Returns false
 * if they were already approved, so the caller can say so instead of writing a
 * second identical history entry.
 *
 * `completions` is deliberately untouched: it counts checks actually taken,
 * and inflating it here would make the history lie about who sat the quiz.
 * `revoked_at` is cleared, so this also lifts a revocation.
 */
export async function approveManually(
  db: D1Database, guildId: string, userId: string, actor: string, reason: string, version: number,
): Promise<boolean> {
  const member = await getMember(db, guildId, userId)
  if (member.state === 'approved') return false

  await db.prepare(`
    INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at, revoked_at)
    VALUES (?1, ?2, 'approved', 0, 0, 0, ?3, ?4, NULL)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      state = 'approved', version = ?3, accepted_at = ?4, revoked_at = NULL
  `).bind(guildId, userId, version, Date.now()).run()
  // Any quiz they had open is moot now; it would refuse to grant anyway.
  await db.prepare('DELETE FROM rules_sessions WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).run()
  await logEvent(db, guildId, userId, 'approved', actor, reason)
  return true
}

/**
 * Withdraw approval. `disciplinary` separates a revocation, which counts
 * against the member for good, from a reset that only asks them to take the
 * check again. Returns whether the lifetime counter moved.
 */
export async function revokeApproval(
  db: D1Database, guildId: string, userId: string, actor: string | null, reason: string,
  disciplinary: boolean,
): Promise<{ counted: boolean }> {
  const now = Date.now()

  // Counting is done by a statement that only matches a live approval, rather
  // than by reading the state and then writing: two moderators revoking the
  // same member at once would both have read 'approved' and both counted it.
  // Only one UPDATE can match, so only one counts.
  let counted = false
  if (disciplinary) {
    const res = await db.prepare(`
      UPDATE rules_members
      SET state = 'unapproved', generation = generation + 1, revocations = revocations + 1,
          version = NULL, accepted_at = NULL, revoked_at = ?3
      WHERE guild_id = ?1 AND user_id = ?2 AND state = 'approved'
    `).bind(guildId, userId, now).run()
    counted = !!res.meta.changes
  }

  if (!counted) {
    await db.prepare(`
      INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at, revoked_at)
      VALUES (?1, ?2, 'unapproved', 1, 0, 0, NULL, NULL, ?3)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET
        state = 'unapproved', generation = generation + 1,
        version = NULL, accepted_at = NULL, revoked_at = ?3
    `).bind(guildId, userId, disciplinary ? now : null).run()
  }
  await db.prepare('DELETE FROM rules_sessions WHERE guild_id = ?1 AND user_id = ?2').bind(guildId, userId).run()
  await logEvent(db, guildId, userId, counted ? 'revoked' : 'reset', actor, reason)
  return { counted }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function getSession(db: D1Database, guildId: string, userId: string): Promise<RulesSession | null> {
  const row = await db.prepare('SELECT * FROM rules_sessions WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).first<{
      page: number; question: number; step: number; generation: number
      version: number; answers: string; correct: number; feedback: string; updated_at: number
    }>()
  if (!row) return null
  return {
    page: row.page, question: row.question, step: row.step, generation: row.generation,
    version: row.version, answers: JSON.parse(row.answers), correct: row.correct,
    feedback: row.feedback, updatedAt: row.updated_at,
  }
}

export async function saveSession(
  db: D1Database, guildId: string, userId: string, session: RulesSession,
): Promise<void> {
  await db.prepare(`
    INSERT INTO rules_sessions
      (guild_id, user_id, page, question, step, generation, version, answers, correct, feedback, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      page = ?3, question = ?4, step = ?5, generation = ?6, version = ?7,
      answers = ?8, correct = ?9, feedback = ?10, updated_at = ?11
  `).bind(guildId, userId, session.page, session.question, session.step, session.generation,
    session.version, JSON.stringify(session.answers), session.correct, session.feedback,
    Date.now()).run()
}

export async function clearSession(db: D1Database, guildId: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM rules_sessions WHERE guild_id = ?1 AND user_id = ?2').bind(guildId, userId).run()
}

export async function sweepStaleSessions(db: D1Database, now = Date.now()): Promise<number> {
  const res = await db.prepare('DELETE FROM rules_sessions WHERE updated_at < ?1')
    .bind(now - SESSION_TTL_MS).run()
  return res.meta.changes ?? 0
}
