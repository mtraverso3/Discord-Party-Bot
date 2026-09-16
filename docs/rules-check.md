# Rules check

Members prove they have read the rules before they can join a party: rules
pages, a quiz, and an agreement, all taken privately in Discord and configured
from **Rules & verification** in the [dashboard](admin-ui.md).

## Turn it on

1. Open the admin dashboard, pick your server, and go to **Rules & verification**.
2. Press **Switch the rules check on**. That makes it *available*; it does not
   gate anything on its own.
3. Edit the rules pages, quiz and agreement if you want, then press
   **Publish rules & quiz**.
4. Choose a **rules channel** and press **Post Start button**. That posts one
   public message with a button; everything after it is private to the member.

That is the whole setup. No secrets to set, nothing extra to deploy.

## Which parties require it

Parties opt in one at a time, so open pick-up games and verified customs can run
side by side:

- **Templates**: tick *Require the rules check* on a template and every party
  made from it starts gated.
- **Parties tab**: the *New party* form has the same checkbox.
- **`/party create rules:True`**: Discord shows a True/False picker before the
  create form opens.
- **`/party edit rules:True`** on an existing party, or `rules:False` to stop.
  Leave the option off and the party keeps its current setting.

If you want everything gated instead, tick **New parties require the check by
default** under Rules & verification. Individual parties can still be changed
afterwards.

Gated parties show `🔒 Rules check required` in their embed footer, so a refused
Join is not a mystery. Turning the check on for a party that already has
unapproved members does not kick them on the spot. The sweep reconciles the
roster within the minute.

## What members see

One public message with **Start rules check**. Clicking it opens a private
message only they can see, edited in place through the rules pages, the quiz
and the agreement, never a wall of new messages. `/party rules quiz` starts
the same thing on demand, so a member does not have to find the button.

Answers are buttons labelled A onward, reshuffled every time a question is
drawn, so a leaked answer key of letters is worthless. Every answer is
explained, right or wrong.

Each question is asked once, and the run is graded at the end against the
**passing score** set in the Quiz card, a percentage that defaults to 100. Below
it, the member is shown their score and can start again immediately: there is
no attempt limit, nothing is recorded against them, and a failed run does not
touch their revocation count. Set it to 0 to let anyone through who reads the
rules and agrees.

`/party rules status` shows a member their own status at any time.

## What is gated

Joining, both Join buttons, party creation, `/party adduser`, admin and desktop
adds, manual queue approval, auto-promotion from the queue, capacity increases,
ownership transfer, and desktop lobby invites.

Approval is this bot's own record of who passed. Nothing is granted or taken
away in Discord.

Members who lose approval are removed from parties and queues within about a
minute. A party owner who loses it has their party closed rather than disbanded,
so the queue survives for a moderator to sort out.

## Admins are exempt

Anyone on the server's admin list (the **Admins** tab) can join without passing
the check, so the people responsible for the rules cannot be locked out by them.
They are warned every time instead, in the same private reply that confirms the
join, and the periodic sweep leaves them alone.

The exemption follows the person being admitted, not whoever is acting: an admin
adding an unapproved member is still refused, and an admin who adds another
admin is told that person has not passed.

**It covers not having taken the check, not having lost it.** Revoke an admin's
approval and they are refused like anyone else, told that being an admin no
longer gets them in, and removed from parties by the next sweep. They get the
exemption back by passing the check, or a moderator can hand it back with
**Require retake without penalty**, the non-disciplinary undo.

Discord server permissions are not consulted for this, only the bot's own admin
list, because the same rule has to hold in the background sweep and the desktop
client, where there is no interaction to read permissions from.

## Commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/party rules read` | Everyone | Privately shows the rules, one page at a time, with Previous and Next buttons. |
| `/party rules quiz` | Everyone | Starts the check privately, on demand. No posted Start button needed. |
| `/party rules post` | Manage Roles | Posts the Start rules check button in the configured channel. |
| `/party rules status` | Everyone | Privately shows your approval status, checks passed, and revocations. |
| `/party rules approve member reason` | Manage Roles | Approves a member without the quiz. Recorded as the moderator's decision; their checks-passed count is not increased. |
| `/party rules history member` | Manage Roles | Shows a member's counters and their latest 10 history entries. |
| `/party rules revoke member reason` | Manage Roles | Removes approval and requires a fresh quiz. Increases the lifetime revocation count when an active approval is revoked. |
| `/party rules reset member reason` | Manage Roles | Removes approval and requires a fresh quiz without increasing the disciplinary count. |

Discord does not enforce permissions on subcommands, so the Manage Roles
requirement is checked by the bot when the command runs. Administrator counts
as Manage Roles. Every reply is private to whoever ran it.

## Moderation

Approval normally comes from taking the check. **`/party rules approve`**, or
**Approve without the quiz** on the dashboard's member lookup, lets a moderator
vouch for someone directly: useful for people who have clearly read the rules,
or to lift a revocation without making them sit the quiz again. It is recorded
as that moderator's decision and does not increase their count of checks passed,
so the history stays honest about who actually sat it.

**Rules & verification** has a member lookup with lifetime counters and history,
and a sortable list of everyone tracked.

- **Revoke approval** takes away a live approval and counts against the member
  for good. It needs a reason, which is recorded with the admin's identity.
- **Require retake without penalty** asks them to take the check again without
  touching that counter.
- **Require everyone to take the check again** on publish does the same for the
  whole server at once. Lifetime counters are untouched.

Any of these invalidates a quiz already in progress: the member is told to start
a fresh one rather than being graded against rules that have changed.

## Limits

Rules pages 1–8. Any number of quiz questions, including none. With no
questions, members read the rules and go straight to the agreement. Each
question needs 1–4 correct answers and up to 4 incorrect ones; members pick one,
and it counts if it is in the correct set.

A quiz left untouched for 15 minutes is abandoned. Starting again is free.
