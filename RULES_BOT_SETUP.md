# Rules check

Members prove they have read the rules before they can join a party. It runs in
this Worker — the same bot, the same deploy, the same database as the queue.
There is no second bot and nothing else to host.

## Turn it on

1. Open the admin dashboard, pick your server, and go to **Rules & verification**.
2. Press **Switch the rules check on**. That makes it *available*; it does not
   gate anything on its own.
3. Edit the rules pages, quiz and agreement if you want — the defaults are the
   text the old Python bot shipped with. Press **Publish rules & quiz**.
4. Choose a **rules channel** and press **Post Start button**. That posts one
   public message with a button; everything after it is private to the member.

That is the whole setup. No secrets, no tunnel, no `wrangler secret put`.

## Which parties require it

Parties opt in one at a time, so open pick-up games and verified customs can run
side by side:

- **Templates** — tick *Require the rules check* on a template and every party
  made from it starts gated.
- **Parties tab** — the *New party* form has the same checkbox.
- **`/party create rules:True`** — Discord shows a True/False picker before the
  create form opens.
- **`/party edit rules:True`** on an existing party, or `rules:False` to stop.
  Leave the option off and the party keeps its current setting.

If you want everything gated instead, tick **New parties require the check by
default** under Rules & verification. Individual parties can still be changed
afterwards.

Gated parties show `🔒 Rules check required` in their embed footer, so a refused
Join is not a mystery. Turning the check on for a party that already has
unapproved members does not kick them on the spot — the sweep reconciles the
roster within the minute.

## What members see

One public message with **Start rules check**. Clicking it opens a private
message only they can see, which is then edited in place through the rules
pages, the quiz, and the agreement — never a wall of new messages.

Answers are buttons labelled A onward. Positions are reshuffled every time a
question is drawn, so a leaked answer key of letters is worthless. A wrong
answer is explained and can be retried, with no penalty and no attempt limit —
the quiz is a teaching gate, not an exam. A correct answer is explained too,
heading whatever comes next.

`/party rules` shows a member their own status at any time.

## What is gated

Joining, both Join buttons, party creation, `/party adduser`, admin and desktop
adds, manual queue approval, auto-promotion from the queue, capacity increases,
ownership transfer, and desktop lobby invites.

Approval is this bot's own record of who passed — there is no Discord role
involved, so nothing can fall out of step with it and nothing has to be granted
or taken away in Discord.

Members who lose approval are removed from parties and queues within about a
minute. A party owner who loses it has their party closed rather than disbanded,
so the queue survives for a moderator to sort out.

## Admins are exempt

Anyone on the server's admin list (the **Admins** tab) can join without passing
the check, so the people responsible for the rules cannot be locked out of their
own queue by them. They are warned every time instead, in the same private reply
that confirms the join, and the periodic sweep leaves them alone.

The exemption follows the person being admitted, not whoever is acting: an admin
adding an unapproved member is still refused, and an admin who adds another
admin is told that person has not passed. Otherwise "admins are exempt" would
quietly become "admins can admit anyone".

**It covers not having taken the check, not having lost it.** Revoke an admin's
approval and they are refused like anyone else, told that being an admin no
longer gets them in, and removed from parties by the next sweep — otherwise a
revocation would mean nothing for the people most able to ignore it. They get
the exemption back by passing the check, or a moderator can hand it back with
**Require retake without penalty**, which is the non-disciplinary undo.

Discord server permissions are not consulted for this — only the bot's own admin
list — because the same rule has to hold in the background sweep and the desktop
client, where there is no interaction to read permissions from.

## Commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/party rules` | Everyone | Privately shows the rules, one page at a time, with Previous and Next buttons. |
| `/party rules-post` | Manage Roles | Posts the Start rules check button in the configured channel. |
| `/party rules-status` | Everyone | Privately shows your approval status, lifetime revocations, and completed verifications. |
| `/party rules-approve member reason` | Manage Roles | Approves a member without the quiz. Recorded as the moderator's decision; their completed-check count is not increased. |
| `/party rules-history member` | Manage Roles | Shows a member's counters and their latest 10 history entries. |
| `/party rules-revoke member reason` | Manage Roles | Removes approval and requires a fresh quiz. Increases the lifetime revocation count when an active approval is revoked. |
| `/party rules-reset member reason` | Manage Roles | Removes approval and requires a fresh quiz without increasing the disciplinary count. |

Discord does not enforce permissions on subcommands, so the Manage Roles
requirement is checked by the bot when the command runs. Administrator counts
as Manage Roles. Every reply is private to whoever ran it.

## Moderation

Approval normally comes from taking the check, but **`/party rules-approve`**
lets a moderator vouch for someone directly — useful for people who have clearly
read the rules, or to lift a revocation without making them sit the quiz again.
It is recorded as that moderator's decision and does not increase the member's
count of checks taken, so the history stays honest about who actually sat it.


**Rules & verification** has a member lookup with lifetime counters and history,
and a sortable list of everyone tracked.

- **Revoke approval** takes away a live approval and counts against the member
  for good. It needs a reason, which is recorded with the admin's identity.
- **Require retake without penalty** asks them to take the check again without
  touching that counter.
- **Require everyone to verify again** on publish does the same for the whole
  server at once. Lifetime counters are untouched.

Any of these invalidates a quiz already in progress: the member is told to start
a fresh one rather than being graded against rules that have changed.

## Limits

Rules pages 1–8. Quiz questions 0–15 — none is allowed, in which case members
read the rules and go straight to the agreement. Each question needs 1–4 correct
answers and up to 4 incorrect ones; members pick one and it counts if it is in
the correct set.

A quiz left untouched for 15 minutes is abandoned; starting again is free.

## Migrating from the two-bot setup

The old Python bot's approvals are not read by this. Either have members take
the check again, or add them from the dashboard before switching it on. The
`RULES_BOT_API_URL`, `RULES_BOT_API_TOKEN` and `RULES_APPROVAL_ROLES` secrets
are no longer read and can be deleted with `wrangler secret delete`.
