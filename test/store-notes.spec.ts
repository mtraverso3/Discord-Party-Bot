import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import * as notes from '../src/store/notes'

let seq = 0
const guild = () => `ng-${Date.now()}-${seq++}`

describe('user notes', () => {
  it('adds, lists newest-first, and attributes the author', async () => {
    const g = guild()
    const first = await notes.addNote(env.DB, g, 'u1', 'first note', 'admin@example.com')
    const second = await notes.addNote(env.DB, g, 'u1', 'second note', 'admin@example.com')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()

    const list = await notes.listNotes(env.DB, g, 'u1')
    expect(list.map(n => n.body)).toEqual(['second note', 'first note'])
    expect(list[0]!.authorEmail).toBe('admin@example.com')
    expect(list[0]!.createdAt).toBe(list[0]!.updatedAt)
  })

  it('scopes notes per guild and per user', async () => {
    const g1 = guild(), g2 = guild()
    await notes.addNote(env.DB, g1, 'u1', 'in g1')
    await notes.addNote(env.DB, g2, 'u1', 'in g2')
    await notes.addNote(env.DB, g1, 'u2', 'other user')

    expect((await notes.listNotes(env.DB, g1, 'u1')).map(n => n.body)).toEqual(['in g1'])
    expect((await notes.listNotes(env.DB, g2, 'u1')).map(n => n.body)).toEqual(['in g2'])
    expect((await notes.listNotes(env.DB, g1, 'u2')).map(n => n.body)).toEqual(['other user'])
  })

  it('updates a note body and bumps updated_at', async () => {
    const g = guild()
    const created = await notes.addNote(env.DB, g, 'u1', 'before')
    const updated = await notes.updateNote(env.DB, g, created!.id, 'after')
    expect(updated!.body).toBe('after')
    expect(updated!.updatedAt).toBeGreaterThanOrEqual(created!.createdAt)

    // Wrong guild can't touch it.
    expect(await notes.updateNote(env.DB, guild(), created!.id, 'nope')).toBeNull()
  })

  it('deletes a note, and only within its guild', async () => {
    const g = guild()
    const created = await notes.addNote(env.DB, g, 'u1', 'doomed')
    expect(await notes.deleteNote(env.DB, guild(), created!.id)).toBe(false)
    expect(await notes.deleteNote(env.DB, g, created!.id)).toBe(true)
    expect(await notes.listNotes(env.DB, g, 'u1')).toHaveLength(0)
  })
})
