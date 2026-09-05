import { LifeBuoy, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from './cn'
import { Card } from './ui'

/* ── Known issues ──
   Every entry is a problem that has actually bitten someone. `applies` decides
   whether it gets pulled to the top and flagged as a likely cause for whatever
   the app is showing right now. Keep this list in sync with the
   "Troubleshooting" section of client/README.md. */

export interface TroubleContext {
  leagueOffline: boolean
  noParty: boolean
}

interface Issue {
  id: string
  title: string
  symptom: string
  applies: (ctx: TroubleContext) => boolean
  fix: ReactNode
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.72rem] text-foreground select-text">{children}</code>
}

function Step({ children }: { children: ReactNode }) {
  return <li className="ml-4 list-disc pl-1 marker:text-muted-foreground/60">{children}</li>
}

const ISSUES: Issue[] = [
  {
    id: 'elevation',
    title: 'League shows as offline (elevation mismatch)',
    symptom: 'The badge says “League offline” while the League client is open and logged in.',
    applies: ctx => ctx.leagueOffline,
    fix: (
      <>
        <p>
          PartyBot finds your client by reading the <Code>LeagueClientUx.exe</Code> command
          line, and Windows hides that from programs running at a lower privilege level. If
          League runs as administrator and PartyBot doesn't, the client is invisible to it.
        </p>
        <ul className="flex flex-col gap-1">
          <Step>
            Run <b>PartyBot Inviter</b> as administrator, <b>or</b> stop running the Riot
            Client and League of Legends as administrator. They only have to match.
          </Step>
          <Step>
            To see what's elevated: open Task Manager, go to the <b>Details</b> tab,
            right-click any column heading, choose <b>Select columns</b>, and tick
            <b> Elevated</b>. Then compare <Code>LeagueClientUx.exe</Code> against PartyBot.
          </Step>
        </ul>
      </>
    ),
  },
  {
    id: 'riot-client-only',
    title: 'League shows as offline (only the Riot Client is open)',
    symptom: 'The badge stays on “League offline” while you sit on the Riot launcher.',
    applies: ctx => ctx.leagueOffline,
    fix: (
      <p>
        <Code>LeagueClientUx.exe</Code> only exists once the League client itself is up, so
        the Riot Client launcher and login screen aren't enough. Log all the way in and the
        badge picks it up within a few seconds.
      </p>
    ),
  },
  {
    id: 'antivirus',
    title: 'League shows as offline (blocked by antivirus)',
    symptom: 'League is open and unelevated, but the badge never turns green.',
    applies: ctx => ctx.leagueOffline,
    fix: (
      <p>
        To find your client, PartyBot starts a short-lived PowerShell process every few
        seconds and then makes HTTPS calls to <Code>127.0.0.1</Code>. Some security software
        blocks one or both, since an unsigned app doing that looks suspicious. Add PartyBot
        to your antivirus exclusions and restart it.
      </p>
    ),
  },
  {
    id: 'wrong-guild',
    title: 'Your party never shows up',
    symptom: '“No active party” here, even though you are in a party in Discord.',
    applies: ctx => ctx.noParty,
    fix: (
      <>
        <p>
          The link you get from <Code>/party link</Code> is tied to the Discord server you
          ran the command in. If you linked from a different server than the one your party
          lives in, PartyBot looks for your party in the wrong place and finds nothing.
        </p>
        <ul className="flex flex-col gap-1">
          <Step>Run <Code>/party link</Code> again, in the same server as the party.</Step>
          <Step>Hit <b>Unlink account</b> at the bottom of the app, then enter the new code.</Step>
        </ul>
      </>
    ),
  },
]

export function hasTrouble(ctx: TroubleContext): boolean {
  return ISSUES.some(i => i.applies(ctx))
}

/* ── The nudge that appears above the main content ── */

export function TroubleshootingButton({ ctx, onOpen }: { ctx: TroubleContext; onOpen: () => void }) {
  const label = ctx.leagueOffline && ctx.noParty ? 'League is offline and no party is showing'
    : ctx.leagueOffline ? "League isn't connecting"
    : "Your party isn't showing up"
  return (
    <button
      onClick={onOpen}
      className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-warning/40 bg-warning-muted/25 px-4 py-2.5 text-left text-[0.78rem] font-medium transition-colors hover:bg-warning-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <LifeBuoy className="size-4 shrink-0 text-warning" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-[0.72rem] font-normal text-muted-foreground">Troubleshoot</span>
    </button>
  )
}

/* ── The page itself ── */

function IssueCard({ issue, likely }: { issue: Issue; likely?: boolean }) {
  return (
    <Card className={cn('p-4', likely && 'border-warning/45 bg-warning-muted/15')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">{issue.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{issue.symptom}</p>
        </div>
        {likely && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-muted px-2 py-0.5 text-[0.68rem] font-medium text-warning">
            <TriangleAlert className="size-3" />
            Likely
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-col gap-2 text-xs leading-relaxed text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground">
        {issue.fix}
      </div>
    </Card>
  )
}

function StillStuck() {
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold tracking-tight">Still stuck?</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        With League open, run this in PowerShell. It tells you which of the “League offline”
        causes above you actually have:
      </p>
      <pre className="mt-2 overflow-x-auto rounded-md border bg-muted/50 p-2.5 font-mono text-[0.7rem] leading-relaxed text-foreground select-text">
{`Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" |
  Select-Object -ExpandProperty CommandLine`}
      </pre>
      <ul className="mt-2.5 flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
        <Step>A long line of <Code>--flag=value</Code> pairs: discovery works, so it's antivirus blocking the local connection.</Step>
        <Step>Blank output while League is open: elevation mismatch.</Step>
        <Step>An error: the Windows WMI service is broken on this machine.</Step>
      </ul>
    </Card>
  )
}

export function TroubleshootingPage({ ctx }: { ctx: TroubleContext }) {
  const likely = ISSUES.filter(i => i.applies(ctx))
  const rest = ISSUES.filter(i => !i.applies(ctx))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {likely.length > 0
          ? 'Problems that have come up before. The flagged ones match what the app is seeing right now.'
          : 'Problems that have come up before. Nothing here matches the current state of the app.'}
      </p>
      {likely.map(i => <IssueCard key={i.id} issue={i} likely />)}
      {likely.length > 0 && rest.length > 0 && (
        <p className="pt-1 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
          Other known issues
        </p>
      )}
      {rest.map(i => <IssueCard key={i.id} issue={i} />)}
      <StillStuck />
    </div>
  )
}
