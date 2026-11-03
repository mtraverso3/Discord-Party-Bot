import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2, ChevronDown, ChevronUp, CircleCheck, FileText, ListChecks, Plus, Power, RefreshCw, Send, ShieldCheck,
  Trash2, Users,
} from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { ChannelSelect } from '../components/ChannelSelect'
import { CheckboxCard, ErrorNote, Field, MiniStat, Mono, PageSkeleton } from '../components/common'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../components/ui/accordion'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Checkbox } from '../components/ui/checkbox'
import { Input } from '../components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Textarea } from '../components/ui/textarea'
import type { ChannelInfo } from '../types'
import { cn } from '@/lib/utils'

interface RulesConfig {
  version: string
  pages: { title: string; text: string }[]
  questions: { text: string; correct: string[]; incorrect: string[]; explanation: string }[]
  agreement: string
  passingScore: number
}
interface Status {
  channelId: string; enabled: boolean; defaultRequired: boolean
  config: RulesConfig; counts: { total: number; approved: number }
}
interface RosterMember {
  user_id: string
  state: string
  revocations: number
  completions: number
  version: string | null
}
type RosterKey = keyof Pick<RosterMember, 'user_id' | 'state' | 'revocations' | 'completions' | 'version'>

// The Worker validates these again before storing. Wrong answers are optional:
// a question may offer only correct choices.
const ANSWER_MIN = { correct: 1, incorrect: 0 }
const ANSWER_MAX = 4

// Ascending runs best-to-worst: approved, the two in-flight states, unverified.
const STATE_RANK: Record<string, number> = { approved: 0, granting: 1, revoking: 2, unapproved: 3 }

const ROSTER_COLUMNS: { key: RosterKey; label: string; align: string }[] = [
  { key: 'user_id', label: 'Member', align: 'text-left' },
  { key: 'state', label: 'State', align: 'text-left' },
  { key: 'revocations', label: 'Revocations', align: 'text-right' },
  { key: 'completions', label: 'Checks passed', align: 'text-right' },
  { key: 'version', label: 'Rules version', align: 'text-right' },
]

/** Ascending comparison for one column; the caller flips it for descending. */
function compareRoster(a: RosterMember, b: RosterMember, key: RosterKey): number {
  if (key === 'state') return (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9)
  if (key === 'revocations' || key === 'completions') return a[key] - b[key]
  // IDs and versions are digit strings, so compare them as numbers, not text.
  return (a[key] ?? '').localeCompare(b[key] ?? '', undefined, { numeric: true })
}

interface MemberStatus {
  member: { user_id: string; state: string; revocations: number; completions: number; version: string | null }
  history: { id: number; created_at: string; kind: string; reason: string }[]
}

export function Rules() {
  const toast = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<Status | null>(null)
  const [draft, setDraft] = useState<RulesConfig | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reapprove, setReapprove] = useState(false)
  const picker = useRef<UserPickerHandle>(null)
  const [member, setMember] = useState<MemberStatus | null>(null)
  const [channels, setChannels] = useState<ChannelInfo[]>([])
  const [channel, setChannel] = useState('')
  const [roster, setRoster] = useState<RosterMember[] | null>(null)
  const [sortKey, setSortKey] = useState<RosterKey>('state')
  const [sortDesc, setSortDesc] = useState(false)
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    setError('')
    try {
      const result = await api<Status>('/rules/status')
      setStatus(result); setDraft(structuredClone(result.config))
      if (result.channelId) setChannel(c => c || result.channelId)
    }
    catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    api<ChannelInfo[]>('/channels?kind=text').then(setChannels).catch(() => setChannels([]))
  }, [])

  const action = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast((e as Error).message, 'err') }
    finally { setBusy(false) }
  }
  const post = async () => {
    if (!await confirm('Post a new Start rules check message in that channel? Any earlier one keeps working.', 'Post Start button')) return
    await action(async () => {
      const r = await api<{ message: string }>('/rules/post', { method: 'POST', body: JSON.stringify({ channelId: channel }) })
      toast(r.message)
      setStatus(await api<Status>('/rules/status'))
    })
  }
  const publish = async () => {
    if (!draft || !status) return
    const message = reapprove
      ? 'Publish these rules and require EVERY tracked member to take the check again? Every current approval is cleared; revocation counts stay unchanged.'
      : 'Publish these rules and quiz? Existing approvals remain valid. Unfinished quizzes will restart.'
    if (!await confirm(message, 'Publish changes')) return
    await action(async () => {
      const result = await api<{ message: string }>('/rules/publish', { method: 'POST', body: JSON.stringify({ config: draft, expectedVersion: status.config.version, requireReapproval: reapprove }) })
      setNotice(result.message); toast('Rules published'); setReapprove(false); await refresh()
    })
  }
  const loadRoster = async () => {
    await action(async () => setRoster((await api<{ members: RosterMember[] }>('/rules/members')).members))
  }
  /** Load a member straight from the roster, keeping the picker in step so the
   *  revoke/retake guard still matches what is on screen. */
  const openFromRoster = async (id: string) => {
    picker.current?.setValue(id)
    await action(async () => { setMember(await api<MemberStatus>(`/rules/members/${id}`)); setReason(''); setNotice('') })
  }
  const lookup = async () => {
    const id = picker.current?.getId()
    if (!id) { toast('Choose a member or paste their Discord user ID.', 'err'); return }
    setMember(null)
    await action(async () => { setMember(await api<MemberStatus>(`/rules/members/${id}`)); setReason(''); setNotice('') })
  }
  const PROMPTS: Record<'approve' | 'revoke' | 'reset', [string, string]> = {
    approve: ['Approve this member without the quiz? Recorded as your decision; it does not count as a check they have taken.', 'Approve'],
    revoke: ['Revoke approval for this member? It counts against them, and they must pass the check again.', 'Revoke approval'],
    reset: ['Require this member to take the check again, without counting it against them?', 'Require retake'],
  }

  const decide = async (mode: 'approve' | 'revoke' | 'reset') => {
    if (!member || !reason.trim()) return
    const id = member.member.user_id
    if (picker.current?.getId() !== id) { toast('Load the selected member before taking action.', 'err'); return }
    const [question, title] = PROMPTS[mode]
    if (!await confirm(question, title)) return
    await action(async () => {
      const result = await api<{ message: string }>(`/rules/members/${id}/${mode}`, { method: 'POST', body: JSON.stringify({ reason }) })
      setNotice(result.message); toast(result.message)
      setMember(await api<MemberStatus>(`/rules/members/${id}`))
    })
  }

  if (error) return <div className="space-y-3"><ErrorNote>{error}</ErrorNote><Button variant="outline" onClick={() => void refresh()}>Try again</Button></div>
  if (!status || !draft) return <PageSkeleton rows={4} />

  // What the percentage works out to, so the bar is stated in questions.
  const passMark = Math.ceil((draft.passingScore / 100) * draft.questions.length)
  const stateVariant = (s: string) => s === 'approved' ? 'success' : s === 'unapproved' ? 'secondary' : 'warning'

  return <div className="space-y-5">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Rules verification
          <Badge variant={status.enabled ? 'success' : 'secondary'}>{status.enabled ? 'On' : 'Off'}</Badge>
        </CardTitle>
        <CardDescription>Members prove they have read the rules before they can join a party.</CardDescription>
        <CardAction>
          <Button
            variant={status.enabled ? 'outline' : 'default'}
            busy={busy}
            onClick={() => void action(async () => {
              const turningOff = status.enabled
              if (turningOff && !await confirm('Switch the rules check off for this server? Parties that ask for it stop being gated, and their settings are kept.', 'Switch off')) return
              const result = await api<Status>('/rules/connect', { method: 'POST', body: JSON.stringify({ enabled: !turningOff }) })
              setStatus(result); toast(turningOff ? 'Rules check switched off' : 'Rules check switched on')
            })}
          >
            {!busy && <Power />}{status.enabled ? 'Switch off' : 'Switch on'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="Approved" value={status.counts.approved} />
          <MiniStat label="Tracked members" value={status.counts.total} />
          <MiniStat label="Rules version" value={status.config.version} />
        </div>
        {status.enabled && (
          <CheckboxCard
            checked={status.defaultRequired}
            disabled={busy}
            onCheckedChange={checked => void action(async () => {
              const result = await api<Status>('/rules/connect', {
                method: 'POST', body: JSON.stringify({ defaultRequired: checked }),
              })
              setStatus(result)
              toast(result.defaultRequired ? 'New parties will require it' : 'New parties will not require it')
            })}
            title="New parties require the check by default"
            description={<>
              Off means each party opts in — from a template, with <code className="rounded bg-muted px-1 py-0.5 text-xs">/party create rules:True</code>, or in the
              Parties tab. Either way a party can be changed later with <code className="rounded bg-muted px-1 py-0.5 text-xs">/party edit rules:True</code>.
            </>}
          />
        )}
        <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label="Rules channel" hint="Where the Start rules check button is posted.">
            <ChannelSelect channels={channels} value={channel} onChange={setChannel} placeholder="Pick the channel to post in" />
          </Field>
          <div className="flex gap-2 sm:mb-6">
            <Button variant="outline" busy={busy} disabled={!channel} onClick={() => void post()}>{!busy && <Send />}Post Start button</Button>
            <Button variant="ghost" size="icon" aria-label="Refresh status" disabled={busy} onClick={() => void action(async () => {
              const result = await api<Status>('/rules/status'); setStatus(s => s ? { ...s, counts: result.counts, enabled: result.enabled } : result)
            })}><RefreshCw /></Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Approval is this bot's own record of who passed. Nothing is granted or taken away in Discord.
        </p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader>
        <CardTitle>Member approval & history</CardTitle>
        <CardDescription>Look up lifetime counts, revoke approval, or require a non-disciplinary retake.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" busy={busy} onClick={() => void (roster ? setRoster(null) : loadRoster())}>
            {!busy && <Users />}{roster ? 'Hide tracked members' : 'Show tracked members'}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-wrap items-start gap-2" onSubmit={e => { e.preventDefault(); void lookup() }}>
          <UserPicker ref={picker} className="min-w-60 flex-1" placeholder="Find a member or paste their Discord ID" onPick={() => setMember(null)} />
          <Button type="submit" variant="secondary" busy={busy}>Load member</Button>
        </form>
        {roster && (roster.length === 0
          ? <p className="text-sm text-muted-foreground">No members are tracked yet.</p>
          : <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{roster.length} tracked — click a column to sort, again to reverse. Click a row to load that member.</p>
              <div className="overflow-hidden rounded-lg border">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow className="hover:bg-transparent">{ROSTER_COLUMNS.map(col => {
                      const active = sortKey === col.key
                      return (
                        <TableHead key={col.key} className={col.align} aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
                          <button
                            type="button"
                            className={cn('inline-flex items-center gap-1 rounded transition-colors hover:text-foreground', active && 'text-foreground')}
                            onClick={() => {
                              if (active) return setSortDesc(d => !d)
                              setSortKey(col.key)
                              setSortDesc(false)
                            }}
                          >
                            {col.label}
                            {active && (sortDesc ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />)}
                          </button>
                        </TableHead>
                      )
                    })}</TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...roster].sort((a, b) =>
                      (sortDesc ? -1 : 1) * compareRoster(a, b, sortKey)
                      // Stable order for equal values, so rows don't shuffle.
                      || a.user_id.localeCompare(b.user_id, undefined, { numeric: true }),
                    ).map(m => (
                      <TableRow key={m.user_id} className="cursor-pointer" onClick={() => void openFromRoster(m.user_id)} title="Load this member">
                        <TableCell className="font-mono text-xs">{m.user_id}</TableCell>
                        <TableCell><Badge variant={stateVariant(m.state)}>{m.state}</Badge></TableCell>
                        <TableCell className="text-right tabular-nums">{m.revocations > 0 ? <span className="text-destructive">{m.revocations}</span> : '0'}</TableCell>
                        <TableCell className="text-right tabular-nums">{m.completions}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{m.version ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>)}
        {member && <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-foreground">{member.member.user_id}</Mono>
            <Badge variant={stateVariant(member.member.state)}>{member.member.state}</Badge>
            <Badge variant="outline">Revocations: {member.member.revocations}</Badge>
            <Badge variant="outline">Checks passed: {member.member.completions}</Badge>
          </div>
          <Field label="Reason" hint="Recorded against them, and shown in their history.">
            <Input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why are you taking this action?" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button busy={busy} disabled={!reason.trim() || member.member.state === 'approved'} onClick={() => void decide('approve')}><CircleCheck />Approve without the quiz</Button>
            <Button variant="outline" busy={busy} disabled={!reason.trim()} onClick={() => void decide('reset')}>Require retake without penalty</Button>
            <Button variant="destructive-outline" busy={busy} disabled={!reason.trim()} onClick={() => void decide('revoke')}>Revoke approval</Button>
          </div>
          <div className="space-y-2">
            {member.history.length === 0
              ? <p className="text-sm text-muted-foreground">No verification history yet.</p>
              : member.history.map(event => (
                <div className="rounded-lg border bg-card p-3 text-sm" key={event.id}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <Badge variant="outline">{event.kind}</Badge>
                    <time className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</time>
                  </div>
                  <p className="mt-1.5 break-words text-muted-foreground">{event.reason}</p>
                </div>
              ))}
          </div>
        </div>}
        {notice && <p role="status" className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">{notice}</p>}
      </CardContent>
    </Card>

    <fieldset disabled={busy} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" />Rules pages</CardTitle>
          <CardDescription>Members read these pages before starting the quiz, 1–8 of them. Changes stay in this editor until published.</CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="rounded-lg border px-4">
            {draft.pages.map((page, i) => (
              <AccordionItem key={i} value={'p' + i}>
                <AccordionTrigger className="hover:no-underline">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">{i + 1}</span>
                    <span className="truncate">{page.title || 'Untitled page'}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-3 px-0.5">
                  <Field label="Title"><Input maxLength={200} value={page.title} onChange={e => setDraft({ ...draft, pages: draft.pages.map((p, j) => j === i ? { ...p, title: e.target.value } : p) })} /></Field>
                  <Field label="Rules" hint={`${page.text.length} / 3800 characters`}><Textarea rows={12} maxLength={3800} value={page.text} onChange={e => setDraft({ ...draft, pages: draft.pages.map((p, j) => j === i ? { ...p, text: e.target.value } : p) })} /></Field>
                  {draft.pages.length > 1 && <Button variant="destructive-outline" size="sm" onClick={() => setDraft({ ...draft, pages: draft.pages.filter((_, j) => j !== i) })}><Trash2 />Remove page</Button>}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </CardContent>
        <CardFooter>
          {draft.pages.length < 8
            ? <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, pages: [...draft.pages, { title: '', text: '' }] })}><Plus />Add page</Button>
            : <p className="text-xs text-muted-foreground">Eight pages is the maximum.</p>}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-4 text-muted-foreground" />Quiz
            <Badge variant="secondary">{draft.questions.length === 0 ? 'No questions' : `${draft.questions.length} question${draft.questions.length === 1 ? '' : 's'}`}</Badge>
          </CardTitle>
          <CardDescription>Add as many as you like, or none at all. With no questions, members read the rules and go straight to the agreement. Each question needs 1–4 correct answers and up to 4 incorrect ones. Members pick one, the order is shuffled every time, and the explanation is shown either way.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Passing score"
            className="max-w-sm"
            hint={draft.questions.length === 0
              ? 'No questions, so everyone who reads the rules and agrees passes.'
              : `Members need ${passMark} of ${draft.questions.length} right. Below that they are shown their score and can start again; there is no attempt limit.`}
          >
            <div className="relative">
              <Input
                type="number" min={0} max={100} value={draft.passingScore} className="pr-8"
                onChange={e => setDraft({ ...draft, passingScore: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground">%</span>
            </div>
          </Field>
          {draft.questions.length === 0
            ? <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No quiz — members read the rules pages, then agree.</p>
            : (
              <Accordion type="multiple" className="rounded-lg border px-4">
                {draft.questions.map((question, i) => {
                  const update = (patch: Partial<RulesConfig['questions'][number]>) => setDraft({ ...draft, questions: draft.questions.map((q, j) => i === j ? { ...q, ...patch } : q) })
                  return (
                    <AccordionItem key={i} value={'q' + i}>
                      <AccordionTrigger className="hover:no-underline">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs tabular-nums">{i + 1}</span>
                          <span className="truncate">{question.text || 'New question'}</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 px-0.5">
                        <Field label="Question"><Input maxLength={600} value={question.text} onChange={e => update({ text: e.target.value })} /></Field>
                        <div className="grid gap-4 md:grid-cols-2">
                          {(['correct', 'incorrect'] as const).map(group => (
                            <div key={group} className={cn('space-y-2 rounded-lg border p-3', group === 'correct' ? 'border-success/30 bg-success-muted/30' : 'bg-muted/20')}>
                              <div className="text-sm font-medium">{group === 'correct' ? 'Correct answers' : 'Incorrect answers'}</div>
                              {question[group].map((answer, index) => (
                                <div key={index} className="flex gap-2">
                                  <Input aria-label={`${group} answer ${index + 1}`} maxLength={400} value={answer} onChange={e => update({ [group]: question[group].map((a, j) => j === index ? e.target.value : a) })} />
                                  {question[group].length > ANSWER_MIN[group] && (
                                    <Button variant="ghost" size="icon" className="hover:text-destructive" aria-label={`Remove this ${group} answer`} onClick={() => update({ [group]: question[group].filter((_, j) => j !== index) })}><Trash2 /></Button>
                                  )}
                                </div>
                              ))}
                              {question[group].length === 0 && <p className="text-xs text-muted-foreground">None — optional.</p>}
                              {question[group].length < ANSWER_MAX
                                ? <Button variant="ghost" size="sm" className="-ml-2" onClick={() => update({ [group]: [...question[group], ''] })}><Plus />Add {group} answer</Button>
                                : <p className="text-xs text-muted-foreground">{ANSWER_MAX} is the maximum.</p>}
                            </div>
                          ))}
                        </div>
                        <Field label="Explanation" hint="Shown after any answer."><Textarea maxLength={1000} value={question.explanation} onChange={e => update({ explanation: e.target.value })} /></Field>
                        <Button variant="destructive-outline" size="sm" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })}><Trash2 />Remove question</Button>
                      </AccordionContent>
                    </AccordionItem>
                  )
                })}
              </Accordion>
            )}
        </CardContent>
        <CardFooter>
          <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, questions: [...draft.questions, { text: '', correct: [''], incorrect: [] as string[], explanation: '' }] })}><Plus />Add question</Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" />Final agreement</CardTitle>
          <CardDescription>Shown at the end of the quiz. Agreeing completes the check.</CardDescription>
        </CardHeader>
        <CardContent><Textarea aria-label="Final agreement" rows={7} maxLength={3000} value={draft.agreement} onChange={e => setDraft({ ...draft, agreement: e.target.value })} /></CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 space-y-3 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
        <label className="flex cursor-pointer items-start gap-2.5 text-sm">
          <Checkbox className="mt-0.5" checked={reapprove} onCheckedChange={v => setReapprove(v === true)} />
          Require everyone to take the check again after publishing. This does not count against anyone.
        </label>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => void action(async () => { if (await confirm('Discard your unsaved edits and load the latest published rules?', 'Reload saved rules')) await refresh() })}>Reload saved rules</Button>
          <Button busy={busy} onClick={() => void publish()}>{!busy && <CheckCircle2 />}Publish rules & quiz</Button>
        </div>
      </div>
    </fieldset>
  </div>
}
