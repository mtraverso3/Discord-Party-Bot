// Admin notes about a user, scoped to a guild. Backs the Notes card on the
// admin Users page. Plain CRUD — the routing layer attributes each write to the
// acting admin's Access email.

export interface UserNote {
  id: number
  body: string
  authorEmail: string | null
  createdAt: number
  updatedAt: number
}

interface NoteRow {
  id: number
  body: string
  author_email: string | null
  created_at: number
  updated_at: number
}

function toNote(r: NoteRow): UserNote {
  return {
    id: r.id,
    body: r.body,
    authorEmail: r.author_email,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

/** All notes on a user in a guild, newest first. */
export async function listNotes(db: D1Database, guildId: string, userId: string): Promise<UserNote[]> {
  const { results } = await db.prepare(`
    SELECT id, body, author_email, created_at, updated_at
    FROM user_notes WHERE guild_id = ?1 AND user_id = ?2 ORDER BY id DESC
  `).bind(guildId, userId).all<NoteRow>()
  return results.map(toNote)
}

export async function addNote(
  db: D1Database, guildId: string, userId: string, body: string, authorEmail?: string,
): Promise<UserNote | null> {
  const now = Date.now()
  const row = await db.prepare(`
    INSERT INTO user_notes (guild_id, user_id, body, author_email, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    RETURNING id, body, author_email, created_at, updated_at
  `).bind(guildId, userId, body, authorEmail ?? null, now).first<NoteRow>()
  return row ? toNote(row) : null
}

export async function updateNote(
  db: D1Database, guildId: string, noteId: number, body: string,
): Promise<UserNote | null> {
  const row = await db.prepare(`
    UPDATE user_notes SET body = ?3, updated_at = ?4
    WHERE guild_id = ?1 AND id = ?2
    RETURNING id, body, author_email, created_at, updated_at
  `).bind(guildId, noteId, body, Date.now()).first<NoteRow>()
  return row ? toNote(row) : null
}

export async function deleteNote(db: D1Database, guildId: string, noteId: number): Promise<boolean> {
  const res = await db.prepare('DELETE FROM user_notes WHERE guild_id = ?1 AND id = ?2')
    .bind(guildId, noteId).run()
  return (res.meta.changes ?? 0) > 0
}
