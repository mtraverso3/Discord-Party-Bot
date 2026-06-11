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

## Using it

1. Download `PartyBot-<version>-win.zip` from the repo's releases, unzip it
   anywhere, and run `PartyBot.exe` — no install, no admin rights, no
   certificates.
2. Run `/party link` in Discord and enter the 8-character code in the app.
   This is one-time: the link persists across restarts and parties (90 days of
   inactivity before it expires).
3. Join or create a party in Discord. With the League client running, pick a
   lobby type and hit **Create lobby & invite all**.

Invites can be sent by the party owner, or by members a server admin has
added to the **Desktop client inviters** list in the bot's admin UI.

> Windows SmartScreen may warn on first run because the executable is not
> code-signed. Choose "More info → Run anyway". (The app deliberately ships
> as a zip rather than a self-extracting exe — unsigned NSIS self-extractors
> are routinely false-flagged as trojans by Windows Defender.)

## Development

```sh
npm install
npm start          # build + launch with Electron
npm test           # unit tests for the matching logic
npm run typecheck
npm run dist       # Windows zip in release/
```

Point the app at a different Worker with the `PARTYBOT_URL` environment
variable.

Architecture: the Electron main process owns all I/O — LCU discovery (process
command line → port + auth token), LCU HTTPS calls, and the PartyBot Worker
API (`/client/auth`, `/client/session`) — and the sandboxed renderer only
renders state it receives over the context bridge. Party/lobby matching logic
lives in `src/shared/match.ts` and is dependency-free and unit-tested.
