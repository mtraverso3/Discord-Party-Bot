/**
 * CI guard: fails when a migration added since `base` removes or renames schema
 * the deployed code may still use. Split such a change across two deploys, or
 * label the PR `breaking-migration` to accept a short maintenance window.
 *
 *   npx tsx scripts/check-migrations.ts origin/master
 *   npx tsx scripts/check-migrations.ts --files migrations/0017_x.sql ...
 *
 * The second form checks the given files; Deploy uses it on the migrations
 * production hasn't applied yet, to decide whether to enter maintenance.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { breakingStatements } from './migration-check'

const args = process.argv.slice(2)
const added = args[0] === '--files'
  ? args.slice(1)
  : execFileSync('git', ['diff', '--name-only', '--diff-filter=A', `${args[0] ?? 'origin/master'}...HEAD`, '--', 'migrations/'])
    .toString().split('\n').filter(f => f.endsWith('.sql'))

let failed = false
for (const file of added) {
  const found = breakingStatements(readFileSync(file, 'utf8'))
  if (found.length === 0) continue
  failed = true
  console.log(`::error file=${file}::Removes or renames schema the deployed code may still use`)
  for (const statement of found) console.log(`  ${statement.slice(0, 160)}`)
}

if (failed) {
  console.log(`
These run before the new code is live, so the old code briefly sees the new
schema. Either split the change across two deploys (see docs/deploying.md), or
add the breaking-migration label to deploy it in a maintenance window.`)
  process.exit(1)
}
console.log(`${added.length} new migration(s), none breaking.`)
