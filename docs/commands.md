# Commands

Every command lives under `/party`. Replies are private to whoever ran the
command unless the command posts something on purpose.

`/party help` shows a paged version of this list inside Discord.

## Parties

| Command | What it does |
| --- | --- |
| `/party create` | Create a party (opens a modal) |
| `/party create rules:True` | Create a party that requires the [rules check](rules-check.md) to join |
| `/party join <name or ID>` | Join a party, or its queue if it is full or closed |
| `/party leave` | Leave your current party or queue |
| `/party info [party]` | Show a party's embed, yours by default |
| `/party list` | List the active parties in this server |
| `/party ign <game> <name>` | Save your in-game name for a game |

## Owner commands

| Command | What it does |
| --- | --- |
| `/party edit` | Edit the name, description, cap, game and voice channel |
| `/party edit rules:True` | Turn this party's rules check on, or `rules:False` to turn it off |
| `/party banlist` | Assign champion bans to members in order |
| `/party close` | Close the party so new joiners queue |
| `/party open` | Re-open it and auto-promote queued players |
| `/party adduser @user` | Add a user to the party directly |
| `/party approve @user` | Approve a queued player |
| `/party deny @user` | Remove a player from the queue |
| `/party remove @user` | Remove a member |
| `/party promote @user` | Transfer ownership to another member |
| `/party bump` | Repost the embed at the bottom of the channel (owner or a designated bumper) |
| `/party disband` | Disband the party |

## Rules check

Available when the rules check is switched on. See
[the rules check guide](rules-check.md).

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/party rules read` | Everyone | Read the rules, one page at a time |
| `/party rules quiz` | Everyone | Take the rules check on demand |
| `/party rules status` | Everyone | Show your approval status and counters |
| `/party rules post` | Manage Roles | Post the Start button in the rules channel |
| `/party rules approve <member> <reason>` | Manage Roles | Approve a member without the quiz |
| `/party rules history <member>` | Manage Roles | Show a member's counters and recent history |
| `/party rules revoke <member> <reason>` | Manage Roles | Remove approval and count it against them |
| `/party rules reset <member> <reason>` | Manage Roles | Remove approval without counting it |

## Admin and integrations

| Command | What it does |
| --- | --- |
| `/party clear` | Clear every party in this server (server admins) |
| `/party link` | Get a code to link the [desktop client](../client/README.md) |
| `/party admin` | Get a private sign-in link for the [dashboard](admin-ui.md) (allow-listed users) |
