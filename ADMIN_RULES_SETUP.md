# Rules management in the existing admin panel

This is the updated setup guide for the admin-panel edition. It supersedes the original manual role-secret setup. The separate rules bot still owns quiz completion, approval records, revocation counts, and Discord role changes. PartyBot Admin now provides the controls to manage it.

## What Nidhogg, Mario, and Brian use

After a maintainer completes the connection below, they sign in through their **existing PartyBot Admin login**, select their server, and open **Rules & verification** in the sidebar. No bot secrets, source edits, or terminal commands are needed for normal management.

They can:

- Connect the queue to the rules bot's approval role with one button.
- View connection status, approval totals, and pending role updates.
- Post the Start rules check message into the configured Discord channel.
- Edit rules pages, 10–15 quiz questions, explanations, and the final agreement using normal form fields.
- Publish changes, optionally requiring everyone to verify again without increasing disciplinary counts.
- Search for members, inspect lifetime counters/history, revoke approval with a reason, or require a non-disciplinary retake.

The first six quiz questions are marked as core checks. Correct answers are explicitly labelled in the editor; Discord members see shuffled choices. Published changes survive bot restarts. Concurrent admin edits cannot overwrite a newer publication silently: the stale editor must reload first.

Existing guild-scoped admins can use all these controls for their server. Other servers remain inaccessible to them. There are no new hard-coded names or permissions to assign if these people already have access. The existing super-admin-only controls for adding admins remain unchanged. A maintainer must verify their existing accounts actually have access; this source update does not change any live accounts.

## One-time maintainer setup

1. Back up the existing databases. Deploy the updated Python bot using its existing `.env` values, approval role, and rules channel.
2. Generate a NEW random secret of at least 32 characters (for example, `python -c "import secrets; print(secrets.token_urlsafe(48))"`). This is a private service credential, **not either Discord bot token**.
3. Add it to the Python bot's private `.env` as `RULES_ADMIN_TOKEN`. The management service listens on `127.0.0.1:8081` by default. `RULES_ADMIN_HOST` and `RULES_ADMIN_PORT` can override this when your hosting requires it.
4. Make this service reachable by the Cloudflare Worker through an HTTPS reverse proxy or tunnel. Point that HTTPS address to the Python service. Keep the token check intact; do not expose it through an unauthenticated browser proxy. A host bound to localhost requires a reverse proxy/tunnel on that machine; a separate container needs an appropriate private-network binding. Public HTTPS terminates at the proxy, not at Python's plain HTTP listener.
5. In the PartyBot Worker, set these **server-only** secrets once:

   ```sh
   npx wrangler secret put RULES_BOT_API_URL
   # Enter the HTTPS base URL of the management service, e.g. https://rules.example.com
   npx wrangler secret put RULES_BOT_API_TOKEN
   # Enter the same random value used for RULES_ADMIN_TOKEN.
   ```

6. Apply the new D1 migration before deploying this version:

   ```sh
   npx wrangler d1 migrations apply partybot --remote
   ```

   Migration `0007_rules_panel.sql` stores the approval-role connection in the existing database. It does not delete party data or move verification history.

7. Build the admin UI and deploy the Worker through your existing process. Keep the existing Access authentication and the every-minute cleanup trigger. Restart the Python bot with its new `.env` setting.
8. Open **Rules & verification** in the panel. Confirm the service is online and click **Connect queue to rules bot**. The Worker reads the role from the authenticated rules service and stores it; admins do not need to edit `RULES_APPROVAL_ROLES` or enter role IDs themselves. Existing legacy mappings continue working until a panel connection takes precedence.
9. Rebuild the desktop client if the earlier invitation-check update has not already been distributed. Its source is included as before.

Both service secrets stay server-side. The browser calls the existing `/admin/api/rules/*` routes behind the existing Cloudflare Access checks. The Worker supplies the authenticated admin identity and server scope to Python. It does not accept a user-supplied upstream URL or service credential. Python requires the shared credential and its exact configured server ID on every request. A single Python instance serves its existing one server; this release does not add multi-server Python hosting.

## Everyday operation

**Revoke approval** increases the lifetime revocation counter only when revoking an active approval. The reason records which admin acted. **Require retake without penalty** removes access without increasing that counter. Failed Discord removals show as pending and are retried; until Discord removes the role, the queue may still recognize it.

**Publish rules & quiz** saves a new version and invalidates unfinished quizzes. Existing completed approvals stay valid unless the admin selects **Require everyone to verify again**. That option marks role removals for the bot's retry worker, normally within a minute. For a rules rollout that must block every old approval immediately, pause admissions while pending removals finish. Lifetime counters are retained.

Once rules have first been published from the panel, the database copy is authoritative. Editing `content.py` no longer changes published rules. Use the panel to make further changes; the offline version migration script refuses to overwrite panel-managed rules.

The role ID and rules-channel ID remain deployment settings to avoid accidentally switching away from existing approvals. Everyday editors do not need to change them or know any secrets. A maintainer should handle deliberate role/channel migrations.

## Verification before live use

- Sign in using a guild-scoped admin account and open the new page. Confirm another server is denied.
- Edit a rule, publish, restart Python, and confirm the new text is still present.
- Complete a quiz, inspect the member in the panel, revoke, and pass again. Counts should be one revocation and two completions.
- Require a retake without penalty and confirm the disciplinary count is unchanged.
- Publish from two open editor tabs; the older version must report a conflict instead of overwriting changes.
- Check the queue role requirement, original champion-ban assignments, and the desktop pre-invite check.
- Stop the Python service and confirm the panel reports a connection issue without exposing secrets.

No live configuration or account changes have been performed by this source update.

Validation: 169 queue/admin tests and 30 Python rules-bot tests passed. Both the Worker and admin UI passed TypeScript checks; the admin UI production build passed (using Vite's native config loader in this environment). A local browser preview verified layout, member lookup, revocation confirmation/status, and publishing/version updates with synthetic data. A live Discord deployment test is still required. The earlier desktop changes also passed their 28 tests; Windows executable packaging remains a maintainer task.
