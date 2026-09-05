# PartyBot desktop client

Companion app for the PartyBot Discord bot. The party leader runs it next to
the League of Legends client to:

- **Create a League lobby and invite the whole party in one click.** Members
  don't need to install anything — they just need their IGN set in Discord
  (`/party ign`); the client resolves each Riot ID locally and sends the
  invites from the leader's League client.
- **Verify the lobby.** The live League lobby is cross-referenced against the
  Discord party roster, so anyone who slipped into the lobby without a party
  spot is flagged immediately, and you can see who hasn't joined yet.
- **See everyone's champion.** During champ select and once the game is in
  progress, each member's picked champion shows next to their name. Picks come
  from the local champ-select session — which covers custom games too — and,
  for matchmade games in progress, from the bot's Riot Spectator lookup (needs
  `RIOT_API_KEY` set on the Worker; without it the champ-select read still
  works). Champion names/icons come from Data Dragon via the Worker.

## Using it

1. Download `PartyBot-<version>.exe` from the repo's releases and double-click
   it — no install, no admin rights, no certificates.
2. Run `/party link` in Discord and enter the 8-character code in the app.
   This is one-time: the link persists across restarts and parties (90 days of
   inactivity before it expires).
3. Join or create a party in Discord. With the League client running, pick a
   lobby type and hit **Create lobby & invite all**.

Invites can be sent by the party owner, or by members a server admin has
added to the **Desktop client inviters** list in the bot's admin UI.

> Windows SmartScreen may warn on first run because the executable is not
> code-signed. Choose "More info → Run anyway".

## Troubleshooting

The app has a built-in version of this page: when League isn't connected or no
party is showing, a **Troubleshoot** button appears under the header, and the
causes that match what the app is currently seeing are flagged at the top.

**The badge says "League offline" while League is open.**

The app finds your client by reading the `LeagueClientUx.exe` command line —
that's where League publishes the port and auth token for its local API. A few
things stop that from working:

- **Elevation mismatch — the usual cause.** If League or the Riot Client runs
  as administrator and PartyBot doesn't, Windows hands back the process with a
  blank command line, so the app can't see the client at all. Either run
  PartyBot as administrator too, or stop running Riot Client and League as
  administrator — they only have to match. To see what's elevated, open Task
  Manager → **Details**, right-click any column heading → **Select columns**,
  and tick **Elevated**.
- **Only the Riot Client is open.** The League client proper has to be up; the
  launcher/login screen alone isn't enough.
- **Antivirus.** PartyBot shells out to PowerShell every few seconds and then
  makes HTTPS calls to `127.0.0.1`, which some security software blocks.

To tell which one it is, open PowerShell with League running:

```powershell
Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" |
  Select-Object -ExpandProperty CommandLine
```

A long line of `--flag=value` pairs means discovery works and the problem is on
the HTTPS side — allow-list the exe in your antivirus. Blank output while
League is open is the elevation case; retry in an administrator PowerShell to
confirm. An error means WMI itself is broken on that machine.

**Your party never shows up.**

The link created by `/party link` is tied to the Discord server you ran the
command in, and the bot only looks for your party inside that server. Link from
one server while your party lives in another and the app sits on "No active
party" forever. Fix it by hitting **Unlink account** at the bottom of the app
and running `/party link` again in the same server as the party.

## Development

```sh
npm install
npm start          # build + launch with Electron
npm test           # unit tests for the matching logic
npm run typecheck
npm run dist       # portable Windows exe in release/
```

Point the app at a different Worker with the `PARTYBOT_URL` environment
variable.

Architecture: the Electron main process owns all I/O — LCU discovery (process
command line → port + auth token), LCU HTTPS calls, and the PartyBot Worker
API (`/client/auth`, `/client/session`) — and the sandboxed renderer only
renders state it receives over the context bridge. Party/lobby matching logic
lives in `src/shared/match.ts` and is dependency-free and unit-tested.
