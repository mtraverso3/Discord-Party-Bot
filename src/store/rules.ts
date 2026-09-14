import type {
  ApprovalState, RulesConfig, RulesEvent, RulesGate, RulesMemberRow, RulesQuestion, RulesSession,
} from '../types'
import { DEFAULT_RULES } from '../lib/rules-content'

// All rules state: the published text and quiz, who has passed, the audit
// trail, and any quiz in flight. This is the half of the old Python bot that
// lived in its own SQLite file; the mutations it did under asyncio locks are
// guarded statements here, the same way the party store works.

export const MAX_PAGES = 8
export const ANSWER_MAX = 4
/** A question needs a right answer; wrong ones are optional. */
export const ANSWER_MIN = { correct: 1, incorrect: 0 } as const
/** A quiz left untouched this long is abandoned and can be swept. */
export const SESSION_TTL_MS = 15 * 60 * 1000

// ── Config ───────────────────────────────────────────────────────────────────

export async function getRulesConfig(db: D1Database, guildId: string): Promise<RulesConfig> {
  const row = await db.prepare('SELECT * FROM rules_config WHERE guild_id = ?1').bind(guildId)
    .first<{ version: number; pages: string; questions: string; agreement: string }>()
  if (!row) return structuredClone(DEFAULT_RULES)
  return {
    version: row.version,
    pages: JSON.parse(row.pages),
    questions: JSON.parse(row.questions),
    agreement: row.agreement,
  }
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
    INSERT INTO rules_config (guild_id, version, pages, questions, agreement, updated_at, updated_by)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT (guild_id) DO UPDATE SET
      version = ?2, pages = ?3, questions = ?4, agreement = ?5, updated_at = ?6, updated_by = ?7
  `).bind(guildId, version, JSON.stringify(config.pages), JSON.stringify(config.questions),
    config.agreement, now, actor).run()

  // Any quiz in flight referenced the old version and is now stale; the next
  // click on it reports that rather than grading against replaced questions.
  await db.prepare('DELETE FROM rules_sessions WHERE guild_id = ?1').bind(guildId).run()

  let requeued = 0
  if (requireReapproval) {
    const res = await db.prepare(`
      UPDATE rules_members SET state = 'revoking', generation = generation + 1
      WHERE guild_id = ?1 AND state IN ('approved', 'granting')
    `).bind(guildId).run()
    requeued = res.meta.changes ?? 0
    if (requeued > 0) {
      await db.prepare(`
        INSERT INTO rules_events (guild_id, user_id, kind, actor, reason, created_at)
        SELECT guild_id, user_id, 'reset', ?2, ?3, ?4 FROM rules_members
        WHERE guild_id = ?1 AND state = 'revoking'
      `).bind(guildId, actor, `Rules version ${version} published; fresh check required`, now).run()
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
  return { ok: true, config: { pages, questions, agreement } }
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export async function getRulesGate(db: D1Database, guildId: string): Promise<RulesGate | null> {
  const row = await db.prepare('SELECT * FROM rules_gate WHERE guild_id = ?1').bind(guildId)
    .first<{ enabled: number; role_id: string | null; channel_id: string | null }>()
  if (!row) return null
  return { enabled: !!row.enabled, roleId: row.role_id ?? undefined, channelId: row.channel_id ?? undefined }
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
    roleId: gate.roleId !== undefined ? gate.roleId : current?.roleId,
    channelId: gate.channelId !== undefined ? gate.channelId : current?.channelId,
  }
  await db.prepare(`
    INSERT INTO rules_gate (guild_id, enabled, role_id, channel_id) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (guild_id) DO UPDATE SET enabled = ?2, role_id = ?3, channel_id = ?4
  `).bind(guildId, next.enabled ? 1 : 0, next.roleId || null, next.channelId || null).run()
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
): Promise<{ total: number; approved: number; pending: number }> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(state = 'approved'), 0) AS approved,
      COALESCE(SUM(state IN ('granting', 'revoking')), 0) AS pending
    FROM rules_members WHERE guild_id = ?1
  `).bind(guildId).first<{ total: number; approved: number; pending: number }>()
  return row ?? { total: 0, approved: 0, pending: 0 }
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
  kind: 'verified' | 'revoked' | 'reset', actor: string | null, reason: string,
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
  needsRole: boolean,
): Promise<boolean> {
  // Most members have no row until their first pass, so this inserts as well
  // as updates. The guard rides on the conflict branch: an existing row only
  // moves if it is still on the generation the quiz started with.
  const res = await db.prepare(`
    INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at)
    VALUES (?1, ?2, ?5, ?3, 0, 1, ?4, ?6)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      state = ?5, completions = completions + 1, version = ?4, accepted_at = ?6, revoked_at = NULL
    WHERE rules_members.generation = ?3 AND rules_members.state = 'unapproved'
  `).bind(guildId, userId, generation, version, needsRole ? 'granting' : 'approved', Date.now()).run()
  if (!res.meta.changes) return false
  await logEvent(db, guildId, userId, 'verified', userId, 'Completed quiz and agreement')
  return true
}

/**
 * Withdraw approval. `disciplinary` separates a revocation, which counts
 * against the member for good, from a reset that only asks them to take the
 * check again. Returns whether the lifetime counter moved.
 */
export async function revokeApproval(
  db: D1Database, guildId: string, userId: string, actor: string | null, reason: string,
  disciplinary: boolean, needsRole: boolean,
): Promise<{ counted: boolean; pending: boolean }> {
  const member = await getMember(db, guildId, userId)
  const wasActive = member.state === 'approved' || member.state === 'granting'
  const counted = disciplinary && wasActive
  const state: ApprovalState = wasActive && needsRole ? 'revoking' : 'unapproved'
  await db.prepare(`
    INSERT INTO rules_members (guild_id, user_id, state, generation, revocations, completions, version, accepted_at, revoked_at)
    VALUES (?1, ?2, ?3, 1, ?4, 0, NULL, NULL, ?5)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      state = ?3, generation = generation + 1, revocations = revocations + ?4,
      version = NULL, accepted_at = NULL, revoked_at = ?5
  `).bind(guildId, userId, state, counted ? 1 : 0, disciplinary ? Date.now() : null).run()
  await db.prepare('DELETE FROM rules_sessions WHERE guild_id = ?1 AND user_id = ?2').bind(guildId, userId).run()
  await logEvent(db, guildId, userId, counted ? 'revoked' : 'reset', actor, reason)
  return { counted, pending: state === 'revoking' }
}

/** Settle a member once Discord has actually applied the role change. */
export async function finishRoleChange(
  db: D1Database, guildId: string, userId: string, from: 'granting' | 'revoking',
): Promise<void> {
  await db.prepare('UPDATE rules_members SET state = ?4 WHERE guild_id = ?1 AND user_id = ?2 AND state = ?3')
    .bind(guildId, userId, from, from === 'granting' ? 'approved' : 'unapproved').run()
}

/** Members whose Discord role is still to be added or removed. */
export async function pendingRoleChanges(db: D1Database): Promise<Array<{ guildId: string; userId: string; state: 'granting' | 'revoking' }>> {
  const { results } = await db.prepare(`
    SELECT m.guild_id, m.user_id, m.state FROM rules_members m
    JOIN rules_gate g ON g.guild_id = m.guild_id
    WHERE m.state IN ('granting', 'revoking') AND g.role_id IS NOT NULL
  `).all<{ guild_id: string; user_id: string; state: 'granting' | 'revoking' }>()
  return results.map(r => ({ guildId: r.guild_id, userId: r.user_id, state: r.state }))
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function getSession(db: D1Database, guildId: string, userId: string): Promise<RulesSession | null> {
  const row = await db.prepare('SELECT * FROM rules_sessions WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).first<{
      page: number; question: number; step: number; generation: number
      version: number; answers: string; feedback: string; updated_at: number
    }>()
  if (!row) return null
  return {
    page: row.page, question: row.question, step: row.step, generation: row.generation,
    version: row.version, answers: JSON.parse(row.answers), feedback: row.feedback,
    updatedAt: row.updated_at,
  }
}

export async function saveSession(
  db: D1Database, guildId: string, userId: string, session: RulesSession,
): Promise<void> {
  await db.prepare(`
    INSERT INTO rules_sessions (guild_id, user_id, page, question, step, generation, version, answers, feedback, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET
      page = ?3, question = ?4, step = ?5, generation = ?6, version = ?7,
      answers = ?8, feedback = ?9, updated_at = ?10
  `).bind(guildId, userId, session.page, session.question, session.step, session.generation,
    session.version, JSON.stringify(session.answers), session.feedback, Date.now()).run()
}

export async function clearSession(db: D1Database, guildId: string, userId: string): Promise<void> {
  await db.prepare('DELETE FROM rules_sessions WHERE guild_id = ?1 AND user_id = ?2').bind(guildId, userId).run()
}

export async function sweepStaleSessions(db: D1Database, now = Date.now()): Promise<number> {
  const res = await db.prepare('DELETE FROM rules_sessions WHERE updated_at < ?1')
    .bind(now - SESSION_TTL_MS).run()
  return res.meta.changes ?? 0
}
