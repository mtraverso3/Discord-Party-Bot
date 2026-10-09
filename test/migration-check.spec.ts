import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { breakingStatements } from '../scripts/migration-check'

describe('breakingStatements', () => {
  it('lets additive changes through', () => {
    expect(breakingStatements(`
      CREATE TABLE t (id INTEGER);
      ALTER TABLE parties ADD COLUMN x INTEGER;
      CREATE INDEX i ON t (id);
      UPDATE parties SET x = 1;
    `)).toEqual([])
  })

  it('flags dropped and renamed tables and columns', () => {
    expect(breakingStatements(`
      DROP TABLE parties;
      drop table if exists templates;
      ALTER TABLE guild_settings DROP COLUMN allowed_games;
      ALTER TABLE a RENAME TO b;
      ALTER TABLE a RENAME COLUMN x TO y;
    `)).toHaveLength(5)
  })

  it('allows a scratch table created and dropped in the same migration', () => {
    expect(breakingStatements('CREATE TABLE scratch (id TEXT); DROP TABLE scratch;')).toEqual([])
  })

  it('flags dropping and re-creating an existing table', () => {
    expect(breakingStatements('DROP TABLE admin_users; CREATE TABLE admin_users (id TEXT);')).toEqual(['DROP TABLE admin_users'])
  })

  it('ignores comments', () => {
    expect(breakingStatements('-- DROP TABLE parties\nALTER TABLE a ADD COLUMN b TEXT;')).toEqual([])
  })

  it('catches the migrations that really did break the deployed code', () => {
    const flagged = env.TEST_MIGRATIONS
      .filter(m => breakingStatements(m.queries.join(';\n')).length > 0)
      .map(m => m.name.slice(0, 4))
    expect(flagged).toEqual(['0005', '0008', '0011', '0014'])
  })
})
