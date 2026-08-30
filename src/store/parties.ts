import type {
  ApproveResult, BanList, CloseResult, DenyResult, DisbandResult, ForceAddResult,
  JoinResult, LeaveResult, MoveQueueResult, OpenResult, PartyData, PartyMember,
  PromoteResult, QueueEntry, RemoveResult, SetBanlistResult, SetIgnResult,
  ToggleAwayResult, UpdateResult, UserRef,
} from '../types'
import * as history from './history'

// All party state lives in D1 (see migrations/0001_init.sql). Mutations follow
// a read → compute → guarded batch → re-read pattern: the batch statements
// re-verify the conditions that matter (role, capacity, ownership) so a stale
// read can't corrupt state, and the (guild_id, user_id) primary key on
// party_members makes "one party per user" a hard constraint.

const HOUR = 60 * 60 * 1000
export const INACTIVITY_SOLO_MS = 2 * HOUR
export const INACTIVITY_PARTIAL_MS = 6 * HOUR
export const INACTIVITY_FULL_MS = 12 * HOUR

const MAX_BANLIST = 50

// ── Row mapping ──────────────────────────────────────────────────────────────

interface PartyRow {
  guild_id: string
  id: string
  name: string
  description: string
  game: string
  owner_id: string
  max_size: number
  voice_channel_id: string | null
  is_closed: number
  embed_message_id: string | null
  embed_channel_id: string | null
  created_at: number
  last_activity_at: number
}

interface MemberRow {
  guild_id: string
  user_id: string
  party_id: string
  role: 'member' | 'queued'
  username: string
  display_name: string
  ign: string | null
  away: number
  position: number
  joined_at: number
  queued_at: number | null
}

interface BanRow {
  idx: number
  value: string
  assigned_to: string | null
  pool_order: number | null
}

function toParty(row: PartyRow, memberRows: MemberRow[], banRows: BanRow[]): PartyData {
  const members: PartyMember[] = []
  const queue: QueueEntry[] = []
  for (const m of memberRows) {
    if (m.role === 'member') {
      members.push({
        userId: m.user_id,
        username: m.username,
        displayName: m.display_name,
        ign: m.ign ?? undefined,
        ...(m.away ? { away: true } : {}),
        joinedAt: m.joined_at,
      })
    } else {
      queue.push({
        userId: m.user_id,
        username: m.username,
        displayName: m.display_name,
        ign: m.ign ?? undefined,
        queuedAt: m.queued_at ?? m.joined_at,
      })
    }
  }

  let banlist: BanList | undefined
  if (banRows.length > 0) {
    const assignments: Record<string, string> = {}
    for (const b of banRows) if (b.assigned_to) assignments[b.assigned_to] = b.value
    banlist = {
      source: [...banRows].sort((a, b) => a.idx - b.idx).map(b => b.value),
      pool: banRows
        .filter(b => b.assigned_to === null)
        .sort((a, b) => (a.pool_order ?? 0) - (b.pool_order ?? 0))
        .map(b => b.value),
      assignments,
    }
  }

  const ownerName = members.find(m => m.userId === row.owner_id)?.displayName ?? ''
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    description: row.description,
    game: row.game,
    ownerId: row.owner_id,
    ownerName,
    maxSize: row.max_size,
    voiceChannelId: row.voice_channel_id ?? undefined,
    isClosed: !!row.is_closed,
    embedMessageId: row.embed_message_id ?? undefined,
    embedChannelId: row.embed_channel_id ?? undefined,
    createdAt: row.created_at,
    lastActivityAt: row.last_activity_at,
    members,
    queue,
    banlist,
  }
}

// Members in the order they became members (promotions land at the bottom),
// queue in explicit position order (the owner can reorder it). The two roles
// are split apart in JS, so the CASE only has to sort correctly within a role.
const MEMBER_ORDER = `ORDER BY CASE role WHEN 'member' THEN joined_at ELSE position END, position`

// ── Reads ────────────────────────────────────────────────────────────────────

export async function getParty(db: D1Database, guildId: string, partyId: string): Promise<PartyData | null> {
  const row = await db.prepare('SELECT * FROM parties WHERE guild_id = ?1 AND id = ?2')
    .bind(guildId, partyId).first<PartyRow>()
  if (!row) return null
  const [members, bans] = await Promise.all([
    db.prepare(`SELECT * FROM party_members WHERE guild_id = ?1 AND party_id = ?2 ${MEMBER_ORDER}`)
      .bind(guildId, partyId).all<MemberRow>(),
    db.prepare('SELECT idx, value, assigned_to, pool_order FROM party_bans WHERE guild_id = ?1 AND party_id = ?2')
      .bind(guildId, partyId).all<BanRow>(),
  ])
  return toParty(row, members.results, bans.results)
}

export async function listParties(db: D1Database, guildId: string): Promise<PartyData[]> {
  const [rows, memberRows, banRows] = await Promise.all([
    db.prepare('SELECT * FROM parties WHERE guild_id = ?1 ORDER BY created_at').bind(guildId).all<PartyRow>(),
    db.prepare(`SELECT * FROM party_members WHERE guild_id = ?1 ${MEMBER_ORDER}`).bind(guildId).all<MemberRow>(),
    db.prepare('SELECT party_id, idx, value, assigned_to, pool_order FROM party_bans WHERE guild_id = ?1')
      .bind(guildId).all<BanRow & { party_id: string }>(),
  ])
  return rows.results.map(row => toParty(
    row,
    memberRows.results.filter(m => m.party_id === row.id),
    banRows.results.filter(b => b.party_id === row.id),
  ))
}

export async function countParties(db: D1Database, guildId: string): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM parties WHERE guild_id = ?1')
    .bind(guildId).first<{ n: number }>()
  return row?.n ?? 0
}

/** Resolve a party by exact ID (case-insensitive) or exact name (case-insensitive). */
export async function findPartyId(db: D1Database, guildId: string, nameOrId: string): Promise<string | null> {
  const row = await db.prepare(
    'SELECT id FROM parties WHERE guild_id = ?1 AND (id = ?2 OR LOWER(name) = LOWER(?3)) LIMIT 1',
  ).bind(guildId, nameOrId.toUpperCase(), nameOrId).first<{ id: string }>()
  return row?.id ?? null
}

/** The party a user currently belongs to (member or queued), if any. */
export async function getUserPartyId(db: D1Database, guildId: string, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT party_id FROM party_members WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).first<{ party_id: string }>()
  return row?.party_id ?? null
}

export async function getUserMembership(
  db: D1Database, guildId: string, userId: string,
): Promise<{ partyId: string; role: 'member' | 'queued' } | null> {
  const row = await db.prepare('SELECT party_id, role FROM party_members WHERE guild_id = ?1 AND user_id = ?2')
    .bind(guildId, userId).first<{ party_id: string; role: 'member' | 'queued' }>()
  return row ? { partyId: row.party_id, role: row.role } : null
}

// ── Statement builders ───────────────────────────────────────────────────────

function touchStmt(db: D1Database, guildId: string, partyId: string, now: number) {
  return db.prepare('UPDATE parties SET last_activity_at = ?3 WHERE guild_id = ?1 AND id = ?2')
    .bind(guildId, partyId, now)
}

/** Assign the next pooled ban (FIFO) to a user, if they're a member and don't have one. */
function assignBanStmt(db: D1Database, guildId: string, partyId: string, userId: string) {
  return db.prepare(`
    UPDATE party_bans SET assigned_to = ?3, pool_order = NULL
    WHERE guild_id = ?1 AND party_id = ?2
      AND idx = (SELECT idx FROM party_bans WHERE guild_id = ?1 AND party_id = ?2 AND assigned_to IS NULL
                 ORDER BY pool_order LIMIT 1)
      AND EXISTS (SELECT 1 FROM party_members
                  WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3 AND role = 'member')
      AND NOT EXISTS (SELECT 1 FROM party_bans WHERE guild_id = ?1 AND party_id = ?2 AND assigned_to = ?3)
  `).bind(guildId, partyId, userId)
}

/** Return a user's assigned ban to the back of the pool. */
function freeBanStmt(db: D1Database, guildId: string, partyId: string, userId: string) {
  return db.prepare(`
    UPDATE party_bans
    SET assigned_to = NULL,
        pool_order = (SELECT COALESCE(MAX(pool_order), 0) + 1 FROM party_bans WHERE guild_id = ?1 AND party_id = ?2)
    WHERE guild_id = ?1 AND party_id = ?2 AND assigned_to = ?3
  `).bind(guildId, partyId, userId)
}

/**
 * Promote queued users into open member slots, in queue order, capped by the
 * live capacity at execution time (re-computed inside the statement).
 */
function promoteStmt(db: D1Database, guildId: string, partyId: string, now: number) {
  return db.prepare(`
    UPDATE party_members SET role = 'member', joined_at = ?3, queued_at = NULL
    WHERE guild_id = ?1 AND party_id = ?2 AND role = 'queued' AND user_id IN (
      SELECT user_id FROM party_members
      WHERE guild_id = ?1 AND party_id = ?2 AND role = 'queued'
      ORDER BY position
      LIMIT MAX(0,
        (SELECT max_size FROM parties WHERE guild_id = ?1 AND id = ?2)
        - (SELECT COUNT(*) FROM party_members WHERE guild_id = ?1 AND party_id = ?2 AND role = 'member'))
    )
  `).bind(guildId, partyId, now)
}

function nextPositionSql(): string {
  return `(SELECT COALESCE(MAX(position), 0) + 1 FROM party_members m WHERE m.guild_id = ?1 AND m.party_id = ?2)`
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message)
}

/** Diff helper: which users were queued before and are members after. */
function promotedUsers(before: PartyData, after: PartyData): string[] {
  const wasMember = new Set(before.members.map(m => m.userId))
  return after.members.filter(m => !wasMember.has(m.userId)).map(m => m.userId)
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreatePartyInput {
  id: string
  guildId: string
  name: string
  description: string
  game: string
  owner: UserRef
  maxSize: number
  voiceChannelId?: string
}

export type CreatePartyResult =
  | { ok: true; party: PartyData }
  | { ok: false; error: 'owner_in_party' | 'id_taken' | 'invalid'; message: string }

export async function createParty(db: D1Database, input: CreatePartyInput): Promise<CreatePartyResult> {
  if (!input.id || !input.guildId || !input.owner.userId) {
    return { ok: false, error: 'invalid', message: 'create requires id, guildId, and an owner' }
  }
  if (!Number.isInteger(input.maxSize) || input.maxSize < 1 || input.maxSize > 50) {
    return { ok: false, error: 'invalid', message: 'maxSize must be a whole number between 1 and 50' }
  }

  const now = Date.now()
  const name = input.name.trim() || `${input.owner.displayName}'s party`
  try {
    // One transaction: the party row and the owner's membership. The member
    // PK (guild_id, user_id) rejects an owner who's already in a party, and
    // the parties PK rejects an ID collision — either failure rolls back both.
    await db.batch([
      db.prepare(`
        INSERT INTO parties (guild_id, id, name, description, game, owner_id, max_size,
                             voice_channel_id, is_closed, created_at, last_activity_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, ?9)
      `).bind(input.guildId, input.id, name, input.description, input.game,
        input.owner.userId, input.maxSize, input.voiceChannelId ?? null, now),
      db.prepare(`
        INSERT INTO party_members (guild_id, user_id, party_id, role, username, display_name, ign, position, joined_at)
        VALUES (?1, ?2, ?3, 'member', ?4, ?5, ?6, 1, ?7)
      `).bind(input.guildId, input.owner.userId, input.id,
        input.owner.username, input.owner.displayName, input.owner.ign ?? null, now),
    ])
  } catch (e) {
    if (isUniqueViolation(e)) {
      const message = (e as Error).message.includes('parties')
        ? 'Party ID collision — try again.'
        : 'Owner is already in a party.'
      return {
        ok: false,
        error: (e as Error).message.includes('parties') ? 'id_taken' : 'owner_in_party',
        message,
      }
    }
    throw e
  }

  const party = await getParty(db, input.guildId, input.id)
  if (party) await history.openSession(db, party)
  return party ? { ok: true, party } : { ok: false, error: 'invalid', message: 'Party vanished after create.' }
}

// ── Membership mutations ─────────────────────────────────────────────────────

export async function joinParty(db: D1Database, guildId: string, partyId: string, user: UserRef): Promise<JoinResult> {
  const existing = await getUserMembership(db, guildId, user.userId)
  if (existing) {
    if (existing.partyId !== partyId) return { status: 'in_other_party' }
    const data = await getParty(db, guildId, partyId) ?? undefined
    return { status: existing.role === 'member' ? 'already_member' : 'already_queued', data }
  }

  const now = Date.now()
  try {
    // Role is decided inside the statement so a concurrent join can't
    // oversubscribe: last free slot goes to whoever's INSERT lands first.
    await db.batch([
      db.prepare(`
        INSERT INTO party_members (guild_id, user_id, party_id, role, username, display_name, ign, position, joined_at, queued_at)
        SELECT ?1, ?3, ?2,
          CASE WHEN p.is_closed = 0 AND
            (SELECT COUNT(*) FROM party_members m WHERE m.guild_id = ?1 AND m.party_id = ?2 AND m.role = 'member') < p.max_size
            THEN 'member' ELSE 'queued' END,
          ?4, ?5, ?6, ${nextPositionSql()}, ?7,
          CASE WHEN p.is_closed = 0 AND
            (SELECT COUNT(*) FROM party_members m WHERE m.guild_id = ?1 AND m.party_id = ?2 AND m.role = 'member') < p.max_size
            THEN NULL ELSE ?7 END
        FROM parties p WHERE p.guild_id = ?1 AND p.id = ?2
      `).bind(guildId, partyId, user.userId, user.username, user.displayName, user.ign ?? null, now),
      assignBanStmt(db, guildId, partyId, user.userId),
      touchStmt(db, guildId, partyId, now),
    ])
  } catch (e) {
    if (isUniqueViolation(e)) return { status: 'in_other_party' }  // raced into another party
    throw e
  }

  const after = await getParty(db, guildId, partyId)
  if (!after) return { status: 'not_found' }
  if (after.members.some(m => m.userId === user.userId)) {
    await history.logEvent(db, guildId, partyId, 'joined', { userId: user.userId, displayName: user.displayName })
    return { status: 'joined', data: after }
  }
  if (after.queue.some(q => q.userId === user.userId)) {
    await history.logEvent(db, guildId, partyId, 'queued', { userId: user.userId, displayName: user.displayName })
    return { status: 'queued', data: after }
  }
  return { status: 'not_found' }  // INSERT..SELECT matched no party row
}

export async function forceAdd(
  db: D1Database, guildId: string, partyId: string, requesterId: string, user: UserRef,
): Promise<ForceAddResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }
  if (party.members.some(m => m.userId === user.userId)) return { status: 'already_member', data: party }
  if (party.members.length >= party.maxSize) return { status: 'full', data: party }

  const now = Date.now()
  const queued = party.queue.some(q => q.userId === user.userId)
  try {
    await db.batch([
      queued
        // Lift out of the queue — capacity re-checked in the statement.
        ? db.prepare(`
            UPDATE party_members SET role = 'member', joined_at = ?4, queued_at = NULL
            WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3 AND role = 'queued'
              AND (SELECT COUNT(*) FROM party_members m WHERE m.guild_id = ?1 AND m.party_id = ?2 AND m.role = 'member')
                  < (SELECT max_size FROM parties WHERE guild_id = ?1 AND id = ?2)
          `).bind(guildId, partyId, user.userId, now)
        : db.prepare(`
            INSERT INTO party_members (guild_id, user_id, party_id, role, username, display_name, ign, position, joined_at)
            SELECT ?1, ?3, ?2, 'member', ?4, ?5, ?6, ${nextPositionSql()}, ?7
            FROM parties p WHERE p.guild_id = ?1 AND p.id = ?2
              AND (SELECT COUNT(*) FROM party_members m WHERE m.guild_id = ?1 AND m.party_id = ?2 AND m.role = 'member') < p.max_size
          `).bind(guildId, partyId, user.userId, user.username, user.displayName, user.ign ?? null, now),
      assignBanStmt(db, guildId, partyId, user.userId),
      touchStmt(db, guildId, partyId, now),
    ])
  } catch (e) {
    if (isUniqueViolation(e)) return { status: 'in_other_party', data: party }
    throw e
  }

  const after = await getParty(db, guildId, partyId)
  if (!after) return { status: 'not_found' }
  if (after.members.some(m => m.userId === user.userId)) {
    await history.logEvent(db, guildId, partyId, 'joined',
      { userId: user.userId, displayName: user.displayName, detail: { addedBy: requesterId } })
    return { status: 'added', data: after }
  }
  return { status: 'full', data: after }
}

export async function leaveParty(
  db: D1Database, guildId: string, partyId: string, userId: string,
  logAs: 'left' | 'removed' = 'left',
): Promise<LeaveResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (userId === party.ownerId) return { status: 'is_owner', data: party }

  const wasMember = party.members.some(m => m.userId === userId)
  const wasQueued = party.queue.some(q => q.userId === userId)
  if (!wasMember && !wasQueued) return { status: 'not_in', data: party }
  const subject = party.members.find(m => m.userId === userId) ?? party.queue.find(q => q.userId === userId)

  const now = Date.now()
  const stmts = [
    db.prepare('DELETE FROM party_members WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3')
      .bind(guildId, partyId, userId),
  ]
  if (wasMember) {
    stmts.push(freeBanStmt(db, guildId, partyId, userId))
    if (!party.isClosed) stmts.push(promoteStmt(db, guildId, partyId, now))
  }
  stmts.push(touchStmt(db, guildId, partyId, now))
  await db.batch(stmts)

  let after = await getParty(db, guildId, partyId)
  if (!after) return { status: 'not_found' }
  const promoted = promotedUsers(party, after)
  if (promoted.length > 0 && after.banlist) {
    await db.batch(promoted.map(uid => assignBanStmt(db, guildId, partyId, uid)))
    after = (await getParty(db, guildId, partyId)) ?? after
  }
  await history.logEvent(db, guildId, partyId, wasMember ? logAs : 'dequeued',
    { userId, displayName: subject?.displayName })
  await history.logPromotions(db, guildId, partyId, promoted, after)
  return { status: wasMember ? 'left' : 'dequeued', data: after, promoted: promoted[0] }
}

export async function removeMember(
  db: D1Database, guildId: string, partyId: string, requesterId: string, userId: string,
): Promise<RemoveResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }
  if (userId === party.ownerId) return { status: 'is_owner', data: party }
  if (!party.members.some(m => m.userId === userId)) return { status: 'not_in', data: party }

  const result = await leaveParty(db, guildId, partyId, userId, 'removed')
  if (result.status !== 'left') return { status: 'not_in', data: result.data ?? party }
  return { status: 'removed', data: result.data, promoted: result.promoted }
}

export async function approveQueued(
  db: D1Database, guildId: string, partyId: string, requesterId: string, userId: string,
): Promise<ApproveResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }
  if (party.members.length >= party.maxSize) return { status: 'full', data: party }
  if (!party.queue.some(q => q.userId === userId)) return { status: 'not_queued', data: party }

  const now = Date.now()
  await db.batch([
    db.prepare(`
      UPDATE party_members SET role = 'member', joined_at = ?4, queued_at = NULL
      WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3 AND role = 'queued'
        AND (SELECT COUNT(*) FROM party_members m WHERE m.guild_id = ?1 AND m.party_id = ?2 AND m.role = 'member')
            < (SELECT max_size FROM parties WHERE guild_id = ?1 AND id = ?2)
    `).bind(guildId, partyId, userId, now),
    assignBanStmt(db, guildId, partyId, userId),
    touchStmt(db, guildId, partyId, now),
  ])

  const after = await getParty(db, guildId, partyId)
  if (!after) return { status: 'not_found' }
  if (after.members.some(m => m.userId === userId)) {
    await history.logEvent(db, guildId, partyId, 'approved',
      { userId, displayName: after.members.find(m => m.userId === userId)?.displayName })
    return { status: 'approved', data: after }
  }
  return { status: 'full', data: after }
}

export async function denyQueued(
  db: D1Database, guildId: string, partyId: string, requesterId: string, userId: string,
): Promise<DenyResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }
  const subject = party.queue.find(q => q.userId === userId)
  if (!subject) return { status: 'not_queued', data: party }

  await db.batch([
    db.prepare("DELETE FROM party_members WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3 AND role = 'queued'")
      .bind(guildId, partyId, userId),
    touchStmt(db, guildId, partyId, Date.now()),
  ])
  await history.logEvent(db, guildId, partyId, 'denied', { userId, displayName: subject.displayName })
  const after = await getParty(db, guildId, partyId)
  return { status: 'denied', data: after ?? undefined }
}

export async function moveQueued(
  db: D1Database, guildId: string, partyId: string, requesterId: string, userId: string, direction: 'up' | 'down',
): Promise<MoveQueueResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }

  const idx = party.queue.findIndex(q => q.userId === userId)
  if (idx === -1) return { status: 'not_queued', data: party }
  const to = direction === 'up' ? idx - 1 : idx + 1
  if (to < 0 || to >= party.queue.length) return { status: 'noop', data: party }

  const otherId = party.queue[to]!.userId
  // Swap the two entries' positions (queue order == position order).
  const { results: posRows } = await db.prepare(`
    SELECT user_id, position FROM party_members
    WHERE guild_id = ?1 AND party_id = ?2 AND role = 'queued' AND user_id IN (?3, ?4)
  `).bind(guildId, partyId, userId, otherId).all<{ user_id: string; position: number }>()
  if (posRows.length !== 2) return { status: 'not_queued', data: party }

  const setPos = (uid: string, pos: number) => db.prepare(`
    UPDATE party_members SET position = ?4
    WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3 AND role = 'queued'
  `).bind(guildId, partyId, uid, pos)

  const [r1, r2] = posRows as [typeof posRows[0], typeof posRows[0]]
  await db.batch([
    setPos(r1.user_id, r2.position),
    setPos(r2.user_id, r1.position),
    touchStmt(db, guildId, partyId, Date.now()),
  ])
  const after = await getParty(db, guildId, partyId)
  return { status: 'moved', data: after ?? undefined }
}

export async function promoteOwner(
  db: D1Database, guildId: string, partyId: string, requesterId: string, userId: string,
): Promise<PromoteResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }
  if (userId === party.ownerId) return { status: 'already_owner', data: party }
  if (!party.members.some(m => m.userId === userId)) return { status: 'not_in', data: party }

  await db.batch([
    db.prepare(`
      UPDATE parties SET owner_id = ?3, last_activity_at = ?4
      WHERE guild_id = ?1 AND id = ?2
        AND EXISTS (SELECT 1 FROM party_members WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3 AND role = 'member')
    `).bind(guildId, partyId, userId, Date.now()),
  ])
  const after = await getParty(db, guildId, partyId)
  if (after?.ownerId === userId) {
    await history.logEvent(db, guildId, partyId, 'owner_changed', {
      userId, displayName: after.members.find(m => m.userId === userId)?.displayName,
      detail: { from: party.ownerId, to: userId },
    })
  }
  return { status: 'promoted', data: after ?? undefined }
}

// ── Party-level mutations ────────────────────────────────────────────────────

export async function closeParty(db: D1Database, guildId: string, partyId: string, requesterId: string): Promise<CloseResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }
  if (party.isClosed) return { status: 'already_closed', data: party }

  await db.prepare('UPDATE parties SET is_closed = 1, last_activity_at = ?3 WHERE guild_id = ?1 AND id = ?2')
    .bind(guildId, partyId, Date.now()).run()
  await history.logEvent(db, guildId, partyId, 'closed', { userId: requesterId })
  const after = await getParty(db, guildId, partyId)
  return { status: 'closed', data: after ?? undefined }
}

export async function openParty(db: D1Database, guildId: string, partyId: string, requesterId: string): Promise<OpenResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found', promoted: [] }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party, promoted: [] }
  if (!party.isClosed) return { status: 'already_open', data: party, promoted: [] }

  const now = Date.now()
  await db.batch([
    db.prepare('UPDATE parties SET is_closed = 0, last_activity_at = ?3 WHERE guild_id = ?1 AND id = ?2')
      .bind(guildId, partyId, now),
    promoteStmt(db, guildId, partyId, now),
  ])

  let after = await getParty(db, guildId, partyId)
  if (!after) return { status: 'not_found', promoted: [] }
  const promoted = promotedUsers(party, after)
  if (promoted.length > 0 && after.banlist) {
    await db.batch(promoted.map(uid => assignBanStmt(db, guildId, partyId, uid)))
    after = (await getParty(db, guildId, partyId)) ?? after
  }
  await history.logEvent(db, guildId, partyId, 'opened', { userId: requesterId })
  await history.logPromotions(db, guildId, partyId, promoted, after)
  return { status: 'opened', data: after, promoted }
}

export async function setMemberIgn(
  db: D1Database, guildId: string, partyId: string, userId: string, ign: string | undefined,
): Promise<SetIgnResult> {
  const res = await db.prepare('UPDATE party_members SET ign = ?4 WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3')
    .bind(guildId, partyId, userId, ign ?? null).run()
  if (!res.meta.changes) {
    const party = await getParty(db, guildId, partyId)
    return party ? { status: 'not_in', data: party } : { status: 'not_found' }
  }
  await touchStmt(db, guildId, partyId, Date.now()).run()
  const after = await getParty(db, guildId, partyId)
  return { status: 'updated', data: after ?? undefined }
}

export async function toggleAway(db: D1Database, guildId: string, partyId: string, userId: string): Promise<ToggleAwayResult> {
  const res = await db.prepare(`
    UPDATE party_members SET away = 1 - away
    WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3 AND role = 'member'
  `).bind(guildId, partyId, userId).run()
  if (!res.meta.changes) {
    const party = await getParty(db, guildId, partyId)
    return party ? { status: 'not_in', data: party, away: false } : { status: 'not_found', away: false }
  }
  await touchStmt(db, guildId, partyId, Date.now()).run()
  const after = await getParty(db, guildId, partyId)
  return {
    status: 'toggled',
    data: after ?? undefined,
    away: !!after?.members.find(m => m.userId === userId)?.away,
  }
}

export async function setBanlist(
  db: D1Database, guildId: string, partyId: string, requesterId: string, raw: string,
): Promise<SetBanlistResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (party.ownerId !== requesterId) return { status: 'unauthorized', data: party }

  const source = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(0, MAX_BANLIST)
  const now = Date.now()

  const stmts = [
    db.prepare('DELETE FROM party_bans WHERE guild_id = ?1 AND party_id = ?2').bind(guildId, partyId),
    ...source.map((value, i) =>
      db.prepare('INSERT INTO party_bans (guild_id, party_id, idx, value, pool_order) VALUES (?1, ?2, ?3, ?4, ?3)')
        .bind(guildId, partyId, i + 1, value)),
    // Hand out bans to current members in join order.
    ...(source.length > 0
      ? party.members.map(m => assignBanStmt(db, guildId, partyId, m.userId))
      : []),
    touchStmt(db, guildId, partyId, now),
  ]
  await db.batch(stmts)
  await history.logEvent(db, guildId, partyId, 'banlist_set',
    { userId: requesterId, detail: { count: source.length } })
  const after = await getParty(db, guildId, partyId)
  return { status: 'updated', data: after ?? undefined }
}

export interface UpdatePartyInput {
  requesterId: string
  name?: string
  description?: string
  maxSize?: number
  game?: string
  voiceChannelId?: string
  ignMap?: Record<string, string>
}

export async function updateParty(db: D1Database, guildId: string, partyId: string, input: UpdatePartyInput): Promise<UpdateResult> {
  const party = await getParty(db, guildId, partyId)
  const fail = (message: string, status: 'invalid' | 'unauthorized' = 'invalid'): UpdateResult =>
    ({ status, data: party ?? undefined, promoted: [], nameChanged: false, gameChanged: false, message })

  if (!party) return { status: 'not_found', promoted: [], nameChanged: false, gameChanged: false }
  if (party.ownerId !== input.requesterId) return fail('', 'unauthorized')

  let name = party.name
  if (input.name != null) {
    const trimmed = input.name.toString().trim().slice(0, 100)
    if (trimmed.length === 0) return fail('Name cannot be empty.')
    name = trimmed
  }

  let maxSize = party.maxSize
  if (input.maxSize != null) {
    const n = Number(input.maxSize)
    if (!Number.isInteger(n) || n < 2 || n > 50) {
      return fail('Player cap must be a whole number between 2 and 50.')
    }
    if (n < party.members.length) {
      return fail(`Player cap cannot be below the current member count (${party.members.length}).`)
    }
    maxSize = n
  }

  const nameChanged = party.name !== name
  const gameChanged = input.game != null && party.game !== input.game
  const now = Date.now()

  const stmts: D1PreparedStatement[] = [
    db.prepare(`
      UPDATE parties SET name = ?3, max_size = ?4, description = ?5, game = ?6, voice_channel_id = ?7, last_activity_at = ?8
      WHERE guild_id = ?1 AND id = ?2
    `).bind(
      guildId, partyId, name, maxSize,
      input.description != null ? input.description.toString().slice(0, 1000) : party.description,
      gameChanged ? input.game! : party.game,
      input.voiceChannelId != null ? input.voiceChannelId : party.voiceChannelId ?? null,
      now,
    ),
  ]

  if (gameChanged) {
    // Refresh everyone's IGN from their per-game profile for the new game.
    const ignMap = input.ignMap ?? {}
    stmts.push(
      ...[...party.members, ...party.queue].map(u =>
        db.prepare('UPDATE party_members SET ign = ?4 WHERE guild_id = ?1 AND party_id = ?2 AND user_id = ?3')
          .bind(guildId, partyId, u.userId, ignMap[u.userId] ?? null)),
    )
  }

  // Growing the cap on an open party opens spots — pull from the queue.
  if (!party.isClosed) stmts.push(promoteStmt(db, guildId, partyId, now))
  await db.batch(stmts)

  let after = await getParty(db, guildId, partyId)
  if (!after) return { status: 'not_found', promoted: [], nameChanged: false, gameChanged: false }
  const promoted = promotedUsers(party, after)
  if (promoted.length > 0 && after.banlist) {
    await db.batch(promoted.map(uid => assignBanStmt(db, guildId, partyId, uid)))
    after = (await getParty(db, guildId, partyId)) ?? after
  }
  if (gameChanged) {
    await history.logEvent(db, guildId, partyId, 'game_changed',
      { userId: input.requesterId, detail: { from: party.game, to: after.game } })
  }
  await history.logPromotions(db, guildId, partyId, promoted, after)
  return { status: 'updated', data: after, promoted, nameChanged, gameChanged }
}

/**
 * Claim the right to repost this party's embed, parking the pointer at NULL
 * until the caller lands the new message id. Concurrent bumps all read the
 * same `expectedMessageId`, but D1 serializes the writes so only the first
 * UPDATE matches it — the losers see changes = 0 and must not post a second
 * embed. Returns false when someone else already claimed it.
 */
export async function claimEmbedRepost(
  db: D1Database, guildId: string, partyId: string, expectedMessageId: string,
): Promise<boolean> {
  const res = await db.prepare(`
    UPDATE parties SET embed_message_id = NULL
    WHERE guild_id = ?1 AND id = ?2 AND embed_message_id = ?3
  `).bind(guildId, partyId, expectedMessageId).run()
  return !!res.meta.changes
}

export async function setEmbedMessage(
  db: D1Database, guildId: string, partyId: string, messageId: string, channelId: string,
): Promise<PartyData | null> {
  await db.prepare(`
    UPDATE parties SET embed_message_id = ?3, embed_channel_id = ?4, last_activity_at = ?5
    WHERE guild_id = ?1 AND id = ?2
  `).bind(guildId, partyId, messageId, channelId, Date.now()).run()
  return getParty(db, guildId, partyId)
}

// ── Disband ──────────────────────────────────────────────────────────────────

export async function disbandParty(
  db: D1Database, guildId: string, partyId: string, requesterId?: string,
): Promise<DisbandResult> {
  const party = await getParty(db, guildId, partyId)
  if (!party) return { status: 'not_found' }
  if (requesterId !== undefined && party.ownerId !== requesterId) {
    return { status: 'unauthorized', data: party }
  }
  await history.closeSession(db, guildId, partyId, 'disbanded')
  // ON DELETE CASCADE clears members and bans.
  await db.prepare('DELETE FROM parties WHERE guild_id = ?1 AND id = ?2').bind(guildId, partyId).run()
  return { status: 'disbanded', data: party }
}

export async function disbandAllParties(db: D1Database, guildId: string): Promise<PartyData[]> {
  const parties = await listParties(db, guildId)
  if (parties.length > 0) {
    for (const p of parties) await history.closeSession(db, guildId, p.id, 'cleared')
    await db.prepare('DELETE FROM parties WHERE guild_id = ?1').bind(guildId).run()
  }
  return parties
}

// ── Inactivity sweep (cron) ──────────────────────────────────────────────────

function inactivityMs(memberCount: number, queueCount: number, maxSize: number): number {
  if (memberCount >= maxSize || queueCount > 0) return INACTIVITY_FULL_MS
  if (memberCount > 1) return INACTIVITY_PARTIAL_MS
  return INACTIVITY_SOLO_MS
}

/**
 * Disband every party idle past its tier threshold (solo parties go sooner
 * than full/queued ones). Returns the disbanded parties with their idle
 * threshold so the caller can annotate the Discord embeds.
 */
export async function sweepInactiveParties(db: D1Database, now = Date.now()): Promise<Array<{ party: PartyData; thresholdMs: number }>> {
  const { results } = await db.prepare(`
    SELECT p.guild_id, p.id, p.max_size, p.last_activity_at,
      COALESCE(SUM(CASE WHEN m.role = 'member' THEN 1 ELSE 0 END), 0) AS member_count,
      COALESCE(SUM(CASE WHEN m.role = 'queued' THEN 1 ELSE 0 END), 0) AS queue_count
    FROM parties p
    LEFT JOIN party_members m ON m.guild_id = p.guild_id AND m.party_id = p.id
    WHERE p.last_activity_at < ?1
    GROUP BY p.guild_id, p.id
  `).bind(now - INACTIVITY_SOLO_MS).all<{
    guild_id: string; id: string; max_size: number; last_activity_at: number
    member_count: number; queue_count: number
  }>()

  const out: Array<{ party: PartyData; thresholdMs: number }> = []
  for (const row of results) {
    const threshold = inactivityMs(row.member_count, row.queue_count, row.max_size)
    if (now - row.last_activity_at < threshold) continue
    const party = await getParty(db, row.guild_id, row.id)
    if (!party) continue
    await history.closeSession(db, row.guild_id, row.id, `inactive ${Math.round(threshold / HOUR)}h`)
    await db.prepare('DELETE FROM parties WHERE guild_id = ?1 AND id = ?2').bind(row.guild_id, row.id).run()
    out.push({ party, thresholdMs: threshold })
  }
  return out
}
