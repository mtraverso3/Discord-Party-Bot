# Deploying

Parties live in D1, not in the Worker, so a deploy doesn't lose them: Cloudflare
switches to the new version without downtime and requests already running
finish on the old one. What a deploy can break is compatibility between the
code and the data.

## The moment that matters

The Deploy workflow applies migrations first, then deploys the new Worker. In
between, for a few seconds (or until someone fixes a failed deploy), the code
already running reads the **new** schema.

- **Adding** a table, column or index is safe: the old code never asks for it.
- **Removing or renaming** one is not: the old code still queries it and fails.

The [Migrations check](../.github/workflows/migrations.yml) fails a PR whose new
migrations drop or rename a table or column, so this can't slip through.

## Removing something: split it across two deploys

1. **First PR.** Add whatever replaces it, and copy the data over in the same
   migration. Change the code to use only the new thing. Leave the old column
   or table in place.
2. **A later PR**, once the first is deployed: drop the old column or table.
   Nothing running uses it any more, so the drop is safe.

At every point, whichever code is running finds what it needs, and a failed
deploy leaves the bot working.

A table rebuild (create a new table, copy, drop the old one, rename) counts as a
removal. A scratch table created and dropped within one migration is fine.

## When splitting isn't worth it

Add the `breaking-migration` label to the PR so the check passes. The deploy
then runs in **maintenance mode**:

1. Before migrating, Deploy checks which migrations production hasn't applied
   yet. If any of them removes or renames something, it switches maintenance on.
   You can also force it with the **maintenance** checkbox when running Deploy
   by hand.
2. While it's on, which is usually under a minute:
   - Discord commands and buttons get a private "PartyBot is updating" reply.
   - The desktop client and dashboard get a 503 that says when to retry; the
     client waits and retries on its own.
   - The cron sweeps skip a run.
   - Parties aren't touched, just paused.
3. After a successful deploy it switches off. If the deploy fails it expires on
   its own after 10 minutes, so PartyBot is never left paused.

## Other things old copies keep using

- **Desktop clients** update on their own schedule: add fields to the client
  API, never remove or rename one they read.
- **Party messages** keep their buttons forever: keep understanding old
  `custom_id` formats.
- **Slash commands** re-register after the deploy (`re-register-on-merge`), so
  the Worker must handle a command option before it is registered.
