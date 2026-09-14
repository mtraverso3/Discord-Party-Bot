import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorNote, Input, Label, Spinner, Table, TBody, THead, Textarea } from '../components/ui'
import { ChannelSelect } from '../components/ChannelSelect'
import type { ChannelInfo } from '../types'
import { cn } from '../lib/cn'

interface RulesConfig {
  version: string
  pages: { title: string; text: string }[]
  questions: { text: string; correct: string[]; incorrect: string[]; explanation: string }[]
  agreement: string
}
interface Status {
  online: boolean; channelId: string; queueConnected: boolean; defaultRequired: boolean
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

// The rules bot refuses a question outside these, so the editor enforces them.
// Wrong answers are optional: a question may offer only correct choices.
const ANSWER_MIN = { correct: 1, incorrect: 0 }
const ANSWER_MAX = 4

// Ascending runs best-to-worst: approved, the two in-flight states, unverified.
const STATE_RANK: Record<string, number> = { approved: 0, granting: 1, revoking: 2, unapproved: 3 }

const ROSTER_COLUMNS: { key: RosterKey; label: string; align: string }[] = [
  { key: 'user_id', label: 'Member', align: 'text-left' },
  { key: 'state', label: 'State', align: 'text-left' },
  { key: 'revocations', label: 'Infractions', align: 'text-right' },
  { key: 'completions', label: 'Completions', align: 'text-right' },
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
      ? 'Publish these rules and require EVERY tracked member to take the quiz again? Approval roles will be removed; lifetime revocation counts stay unchanged.'
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
    approve: ['Approve this member without the quiz? It is recorded as your decision, and does not count as a check they have taken.', 'Approve'],
    revoke: ['Revoke approval for this member? This counts an active approval revocation and requires a fresh quiz.', 'Revoke approval'],
    reset: ['Require this member to retake the quiz without increasing their disciplinary count?', 'Require retake'],
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

  if (error) return <div className="space-y-3"><ErrorNote>{error}</ErrorNote><Button variant="outline" onClick={() => void refresh()}>Retry connection</Button></div>
  if (!status || !draft) return <Spinner />

  return <div className="space-y-5">
    <Card>
      <CardHeader><CardTitle>Rules verification</CardTitle><CardDescription>Members prove they have read the rules before they can join a party. The check runs in this bot.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.queueConnected ? 'success' : 'warning'}>{status.queueConnected ? 'Required to join' : 'Not required yet'}</Badge>
          <Badge>Rules version {status.config.version}</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[[status.counts.approved, 'Approved'], [status.counts.total, 'Tracked members']].map(([value, label]) => <div className="rounded-lg border bg-muted/30 p-3" key={label}><div className="text-xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}
        </div>
        {status.queueConnected && (
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent">
            <Checkbox
              className="mt-0.5"
              checked={status.defaultRequired}
              disabled={busy}
              onChange={e => void action(async () => {
                const result = await api<Status>('/rules/connect', {
                  method: 'POST', body: JSON.stringify({ defaultRequired: e.target.checked }),
                })
                setStatus(result)
                toast(result.defaultRequired ? 'New parties will require it' : 'New parties will not require it')
              })}
            />
            <span>
              New parties require the check by default
              <span className="block text-xs text-muted-foreground">
                Off means each party opts in — from a template, with <code>/party create rules:True</code>, or in the
                Parties tab. Either way a party can be changed later with <code>/party edit rules:True</code>.
              </span>
            </span>
          </label>
        )}
        <p className="text-xs text-muted-foreground">
          Approval is this bot's own record of who passed. No Discord role is involved, so it cannot fall out of step
          with one.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Button busy={busy} onClick={() => void action(async () => {
            const turningOff = status.queueConnected
            if (turningOff && !await confirm('Switch the rules check off for this server? Parties that ask for it stop being gated, and their settings are kept.', 'Switch off')) return
            const result = await api<Status>('/rules/connect', { method: 'POST', body: JSON.stringify({ enabled: !turningOff }) })
            setStatus(result); toast(turningOff ? 'Rules check switched off' : 'Rules check available')
          })}><ShieldCheck />{status.queueConnected ? 'Switch the rules check off' : 'Switch the rules check on'}</Button>
          <Label className="min-w-56 flex-1">Rules channel
            <ChannelSelect channels={channels} value={channel} onChange={setChannel} placeholder="Pick the channel to post in" />
          </Label>
          <Button variant="outline" busy={busy} disabled={!channel} onClick={() => void post()}>Post Start button</Button>
          <Button variant="ghost" busy={busy} onClick={() => void action(async () => {
            const result = await api<Status>('/rules/status'); setStatus(s => s ? { ...s, online: result.online, counts: result.counts, queueConnected: result.queueConnected } : result)
          })}><RefreshCw />Refresh status</Button>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Member approval & history</CardTitle><CardDescription>Look up lifetime counts, revoke approval, or require a non-disciplinary retake.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-start gap-2"><div className="min-w-60 flex-1"><UserPicker ref={picker} placeholder="Find a member or paste their Discord ID" onPick={() => setMember(null)} /></div><Button variant="outline" busy={busy} onClick={() => void lookup()}>Load member</Button><Button variant="outline" busy={busy} onClick={() => void (roster ? setRoster(null) : loadRoster())}><Users />{roster ? 'Hide tracked members' : 'Show tracked members'}</Button></div>
        {roster && (roster.length === 0
          ? <p className="text-sm text-muted-foreground">No members are tracked yet.</p>
          : <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{roster.length} tracked — click a column to sort, again to reverse.</p>
              <Table>
                <THead><tr>{ROSTER_COLUMNS.map(col => {
                  const active = sortKey === col.key
                  return (
                    <th key={col.key} className={col.align} aria-sort={active ? (sortDesc ? 'descending' : 'ascending') : 'none'}>
                      <button
                        type="button"
                        className={cn('inline-flex cursor-pointer items-center gap-1 rounded transition-colors hover:text-foreground', !active && 'text-muted-foreground')}
                        onClick={() => { active ? setSortDesc(d => !d) : (setSortKey(col.key), setSortDesc(false)) }}
                      >
                        {col.label}
                        {active && (sortDesc ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />)}
                      </button>
                    </th>
                  )
                })}</tr></THead>
                <TBody>
                  {[...roster].sort((a, b) =>
                    (sortDesc ? -1 : 1) * compareRoster(a, b, sortKey)
                    // Stable order for equal values, so rows don't shuffle.
                    || a.user_id.localeCompare(b.user_id, undefined, { numeric: true }),
                  ).map(m => (
                    <tr key={m.user_id} className="cursor-pointer hover:bg-accent" onClick={() => void openFromRoster(m.user_id)} title="Load this member">
                      <td className="font-mono text-xs">{m.user_id}</td>
                      <td><Badge variant={m.state === 'approved' ? 'success' : m.state === 'unapproved' ? 'secondary' : 'warning'}>{m.state}</Badge></td>
                      <td className="text-right">{m.revocations > 0 ? <span className="text-destructive">{m.revocations}</span> : '0'}</td>
                      <td className="text-right">{m.completions}</td>
                      <td className="text-right text-muted-foreground">{m.version ?? '—'}</td>
                    </tr>
                  ))}
                </TBody>
              </Table>
            </div>)}
        {member && <>
          <div className="flex flex-wrap gap-2"><Badge>Member {member.member.user_id}</Badge><Badge>{member.member.state}</Badge><Badge>Revocations: {member.member.revocations}</Badge><Badge>Completed quizzes: {member.member.completions}</Badge></div>
          <Label>Reason<Input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Recorded against them, and shown in their history" /></Label>
          <div className="flex flex-wrap gap-2">
            <Button busy={busy} disabled={!reason.trim() || member.member.state === 'approved'} onClick={() => void decide('approve')}>Approve without the quiz</Button>
            <Button variant="destructive-outline" busy={busy} disabled={!reason.trim()} onClick={() => void decide('revoke')}>Revoke approval</Button>
            <Button variant="outline" busy={busy} disabled={!reason.trim()} onClick={() => void decide('reset')}>Require retake without penalty</Button>
          </div>
          <div className="space-y-2">{member.history.length === 0 ? <p className="text-sm text-muted-foreground">No verification history yet.</p> : member.history.map(event => <div className="rounded-lg border p-3 text-sm" key={event.id}><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{event.kind}</span><time className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</time></div><p className="mt-1 break-words text-muted-foreground">{event.reason}</p></div>)}</div>
        </>}
        {notice && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{notice}</p>}
      </CardContent>
    </Card>

    <fieldset disabled={busy} className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Rules pages</CardTitle><CardDescription>Members read these pages before starting the quiz, 1–8 of them. Changes stay in this editor until published.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{draft.pages.map((page, i) => <details key={i} className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Page {i + 1}: {page.title}</summary>
          <div className="mt-3 space-y-3"><Label>Title<Input maxLength={200} value={page.title} onChange={e => setDraft({ ...draft, pages: draft.pages.map((p, j) => j === i ? { ...p, title: e.target.value } : p) })} /></Label><Label>Rules<Textarea rows={12} maxLength={3800} value={page.text} onChange={e => setDraft({ ...draft, pages: draft.pages.map((p, j) => j === i ? { ...p, text: e.target.value } : p) })} /></Label>
            {draft.pages.length > 1 && <Button variant="destructive-outline" size="sm" onClick={() => setDraft({ ...draft, pages: draft.pages.filter((_, j) => j !== i) })}><Trash2 />Remove page</Button>}
          </div>
        </details>)}
          {draft.pages.length < 8
            ? <Button variant="outline" onClick={() => setDraft({ ...draft, pages: [...draft.pages, { title: '', text: '' }] })}>Add page</Button>
            : <p className="text-xs text-muted-foreground">Eight pages is the maximum the rules bot accepts.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Quiz · {draft.questions.length === 0 ? 'no questions' : `${draft.questions.length} question${draft.questions.length === 1 ? '' : 's'}`}</CardTitle><CardDescription>As many as you like, and none is allowed — members then read the rules and go straight to the agreement. The six marked as core checks are the original set, kept as a hint rather than a rule. Each question needs 1–4 correct answers and up to 4 incorrect ones; members pick one, positions are shuffled, and the explanation is shown either way.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{draft.questions.map((question, i) => {
          const update = (patch: Partial<RulesConfig['questions'][number]>) => setDraft({ ...draft, questions: draft.questions.map((q, j) => i === j ? { ...q, ...patch } : q) })
          return <details key={i} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{i + 1}. {question.text || 'New question'} {i < 6 && <span className="ml-1 text-xs text-muted-foreground">Core check</span>}</summary>
            <div className="mt-3 space-y-3"><Label>Question<Input maxLength={600} value={question.text} onChange={e => update({ text: e.target.value })} /></Label>
              {(['correct', 'incorrect'] as const).map(group => (
                <div key={group} className="space-y-2">
                  {question[group].map((answer, index) => (
                    <Label key={index}>
                      {group === 'correct' ? 'Correct answer' : 'Incorrect answer'} {question[group].length > 1 ? index + 1 : ''}
                      <div className="flex gap-2">
                        <Input maxLength={400} value={answer} onChange={e => update({ [group]: question[group].map((a, j) => j === index ? e.target.value : a) })} />
                        {question[group].length > ANSWER_MIN[group] && (
                          <Button variant="destructive-outline" size="icon" title={`Remove this ${group} answer`} onClick={() => update({ [group]: question[group].filter((_, j) => j !== index) })}><Trash2 /></Button>
                        )}
                      </div>
                    </Label>
                  ))}
                  {question[group].length < ANSWER_MAX
                    ? <Button variant="outline" size="sm" onClick={() => update({ [group]: [...question[group], ''] })}>Add {group} answer</Button>
                    : <p className="text-xs text-muted-foreground">{ANSWER_MAX} is the maximum the rules bot accepts.</p>}
                </div>
              ))}
              <Label>Explanation, shown after any answer<Textarea maxLength={1000} value={question.explanation} onChange={e => update({ explanation: e.target.value })} /></Label>
              <Button variant="destructive-outline" size="sm" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })}><Trash2 />Remove question</Button>
            </div></details>
        })}
          {draft.questions.length === 0 && <p className="text-sm text-muted-foreground">No quiz — members read the rules pages, then agree.</p>}
          <Button variant="outline" onClick={() => setDraft({ ...draft, questions: [...draft.questions, { text: '', correct: [''], incorrect: [] as string[], explanation: '' }] })}>Add question</Button>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Final agreement</CardTitle><CardDescription>Shown after the member passes every question.</CardDescription></CardHeader><CardContent><Textarea aria-label="Final agreement" rows={7} maxLength={3000} value={draft.agreement} onChange={e => setDraft({ ...draft, agreement: e.target.value })} /></CardContent></Card>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <label className="flex items-start gap-2 text-sm"><Checkbox checked={reapprove} onChange={e => setReapprove(e.target.checked)} />Require everyone to verify again after publishing. This does not increase disciplinary revocation counts.</label>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void action(async () => { if (await confirm('Discard your unsaved edits and load the latest published rules?', 'Reload saved rules')) await refresh() })}>Reload saved rules</Button><Button busy={busy} onClick={() => void publish()}><CheckCircle2 />Publish rules & quiz</Button></div>
      </div>
    </fieldset>
  </div>
}
