# Connect the Arena Rules verification bot

**Admin-panel edition:** Use [ADMIN_RULES_SETUP.md](ADMIN_RULES_SETUP.md) for the current setup. It adds normal admin-panel controls and a one-time private service connection. The older manual instructions below describe the original role-only integration; the new `0007_rules_panel.sql` migration is required for this updated version.

This update is based on `mtraverso3/Discord-Party-Bot` master at commit `8f2eff6`. It connects the separate Python rules bot through one Discord role. Champion bans, queue ordering, party capacity, and verification lifetime counters retain their existing responsibilities.

## Enable it

1. Set up the Python verification bot using its README. Create **Arena Rules Approved** and enter that role ID as its `APPROVAL_ROLE_ID`.
2. In this queue bot's Cloudflare Worker configuration, add `RULES_APPROVAL_ROLES` as a JSON string mapping the server ID to the same role ID:

   ```json
   {"123456789012345678":"234567890123456789"}
   ```

   Replace BOTH example IDs. Use the Cloudflare dashboard's Worker variables/secrets or, from this project, run:

   ```sh
   npx wrangler secret put RULES_APPROVAL_ROLES
   ```

   Paste the JSON when prompted. This is a queue-bot setting, not the verification bot's token. The queue bot continues using its own `DISCORD_BOT_TOKEN` to read member roles.

3. Deploy this updated Worker using your existing deployment process. No D1 schema migration or new slash command registration is required for this integration. Preserve the existing D1 database, secrets, and domain settings.
4. Enable the additional every-minute scheduled trigger included in `wrangler.toml`. Keep the existing 15-minute maintenance trigger too.
5. Rebuild and distribute the updated desktop client to everyone who uses lobby invitations. Old desktop binaries do not perform the new immediate pre-invite check. The normal client build instructions are in `client/README.md`.
6. Test in a test server before enabling your live queue.

The setting is opt-in per server. **Until `RULES_APPROVAL_ROLES` is set correctly, that server keeps its previous behavior.** Every party/game in a listed server requires approval, including party creators, owners being added as players, admin adds, and desktop adds. There is no staff bypass. Unlisted servers keep their existing behavior. Invalid JSON or invalid IDs stop approval operations instead of disabling the gate silently.

## What is enforced

| Route | Check |
| --- | --- |
| `/party join`, Join, Join Queue | Fresh member role check before insertion |
| Party creation, including templates/admin creation | Owner must have approval |
| `/party adduser`, admin adds, desktop adds | Target member must have approval |
| Manual approval from Discord/admin/desktop | Target queued member must still have approval |
| Auto-promotion after leave/remove, reopen, or capacity increase | Only freshly approved queue IDs can be promoted; FIFO among eligible players |
| Ownership transfer | New owner must have approval |
| Desktop lobby invitations | Fresh server-filtered roster immediately before invitation; revoked caller cannot invite |
| Scheduled cleanup | Remove confirmed-unapproved queue entries and non-owner members, return assigned bans, and update embeds |

Cleanup normally runs about once per minute after Discord successfully removes the approval role; scheduling and API outages can delay it. Entry/promotion/invite checks do not wait for cleanup. An already-issued game invitation or a player already in a game cannot be undone by this bot.

If the owner loses approval, cleanup closes the party and preserves other players rather than disbanding everyone's queue. The owner is excluded from the checked invitation roster and cannot invite. A moderator can arrange re-verification or transfer ownership to an approved member, then reopen the party. The owner's stored membership remains for this repair process.

Discord and the party database are separate systems: checks cannot be one atomic transaction with a Discord role change. A role removed immediately after a successful lookup can briefly overlap an insertion/invite; subsequent checks and cleanup reconcile it. If the verification bot reports a failed role removal, fix that first—the role is the integration's source of truth.

## Error and retry behavior

- Missing role: explain that the member must complete `#arena-rules`.
- Discord unavailable, rate-limited, or missing permissions: deny new admissions/manual approvals/invites and allow retry.
- A member can still leave during an outage. Auto-promotion selects nobody if approval cannot be verified.
- Cleanup does not remove anyone when the roster check fails. It retries on the next tick.
- After an outage prevents auto-promotion, an owner can manually approve eligible players or close/reopen to fill the available slots.
- Ordinary desktop UI polling uses the stored roster; it does not poll Discord for every member every few seconds. The immediate invite check uses `GET /client/session?verifyRules=1`.

## Live acceptance check

1. Before verification, try both Discord join buttons and `/party join`; all should refuse.
2. Try adding an unapproved member from owner commands, the admin dashboard, and the desktop client; all should refuse.
3. Pass the verification bot's quiz and agreement. Join and confirm the original champion-ban assignment still works.
4. Revoke a queued member. Open a spot and confirm that member is skipped; cleanup should remove their entry.
5. Revoke an active non-owner member. Confirm cleanup removes them and their ban returns to the pool.
6. Revoke a member just before desktop invitations. Confirm the refreshed roster excludes them.
7. Revoke a party owner. Confirm the party closes without deleting the other players and their client cannot invite.
8. Have the member pass again. Confirm the verification bot retains their lifetime revocation count and queue access returns.

## Review and local testing

Run `npm ci`, `npm test`, and `npx tsc --noEmit` at the repository root. In `client/`, run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`.

The new regression suite is `test/rules-approval.spec.ts`. It tests denial/approval, changing roles, Discord failures, every promotion trigger, ban allocation, cleanup, buttons, admin adds, desktop adds, and the invitation roster. No live credentials are included. The code has not been pushed to GitHub or deployed to Cloudflare.

Validation on this copy: **161 server tests and 28 desktop tests passed**, and server/desktop TypeScript checks passed. Desktop tests used the same test configuration supplied programmatically because the local sandbox blocked the bundler's parent-directory scan. The standard desktop bundle/package build was blocked by that filesystem restriction; rebuild and test the executable in your normal development environment. No live Discord/League session was available for end-to-end testing.
