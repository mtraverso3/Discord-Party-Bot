/**
 * Statements in a migration that the currently deployed code may not survive.
 * Migrations run before the new Worker is live, so for a moment the old code
 * reads the new schema: adding things is safe, removing or renaming is not.
 * A table both created and dropped in the same migration (scratch space) is fine.
 */
export function breakingStatements(sql: string): string[] {
  const statements = sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  // Only a table created earlier in this migration is scratch space; dropping
  // and re-creating an existing one is a rebuild.
  const created = new Set<string>()
  return statements.filter(s => {
    const made = /^create table (?:if not exists )?["`]?(\w+)/i.exec(s)?.[1]
    if (made) created.add(made.toLowerCase())
    const dropped = /^drop table (?:if exists )?["`]?(\w+)/i.exec(s)?.[1]?.toLowerCase()
    if (dropped) return !created.has(dropped)
    return /^alter table \S+ (drop|rename)\b/i.test(s)
  })
}
