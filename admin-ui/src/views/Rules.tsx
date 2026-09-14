import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, RefreshCw, ShieldCheck, Trash2, Users } from 'lucide-react'
import { api } from '../api'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/Confirm'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, ErrorNote, Input, Label, Segmented, Spinner, Table, TBody, THead, Textarea } from '../components/ui'

interface RulesConfig {
  version: string
  pages: { title: string; text: string }[]
  questions: { text: string; answers: string[]; explanation: string }[]
  agreement: string
}
interface Status {
  online: boolean; roleId: string; channelId: string; queueConnected: boolean
  config: RulesConfig; counts: { total: number; approved: number; pending: number }
}
interface RosterMember {
  user_id: string
  state: string
  revocations: number
  completions: number
  version: string | null
}
type RosterSort = 'approval' | 'infractions'

// Approved first, then the two in-flight states, then everyone unverified.
const STATE_RANK: Record<string, number> = { approved: 0, granting: 1, revoking: 2, unapproved: 3 }

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
  const [roster, setRoster] = useState<RosterMember[] | null>(null)
  const [sort, setSort] = useState<RosterSort>('approval')
  const [reason, setReason] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = async () => {
    setError('')
    try { const result = await api<Status>('/rules/status'); setStatus(result); setDraft(structuredClone(result.config)) }
    catch (e) { setError((e as Error).message) }
  }
  useEffect(() => { void refresh() }, [])

  const action = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast((e as Error).message, 'err') }
    finally { setBusy(false) }
  }
  const post = async () => {
    if (!await confirm('Post a new Start rules check message in the configured Discord channel?', 'Post rules check')) return
    await action(async () => { const r = await api<{ message: string }>('/rules/post', { method: 'POST', body: '{}' }); toast(r.message) })
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
  const revoke = async (mode: 'revoke' | 'reset') => {
    if (!member || !reason.trim()) return
    const id = member.member.user_id
    if (picker.current?.getId() !== id) { toast('Load the selected member before taking action.', 'err'); return }
    if (!await confirm(mode === 'revoke' ? `Revoke approval for member ${id}? This counts an active approval revocation and requires a fresh quiz.` : `Require member ${id} to retake the quiz without increasing their disciplinary count?`, mode === 'revoke' ? 'Revoke approval' : 'Require retake')) return
    await action(async () => {
      const result = await api<{ message: string; pending: boolean }>(`/rules/members/${id}/${mode}`, { method: 'POST', body: JSON.stringify({ reason }) })
      setNotice(result.message); toast(result.pending ? 'Role removal is pending — see the notice below.' : result.message, result.pending ? 'err' : undefined)
      setMember(await api<MemberStatus>(`/rules/members/${id}`))
    })
  }

  if (error) return <div className="space-y-3"><ErrorNote>{error}</ErrorNote><Button variant="outline" onClick={() => void refresh()}>Retry connection</Button></div>
  if (!status || !draft) return <Spinner />

  return <div className="space-y-5">
    <Card>
      <CardHeader><CardTitle>Rules verification</CardTitle><CardDescription>Manage the rules bot with your existing admin access.</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.online ? 'success' : 'warning'}>{status.online ? 'Bot online' : 'Bot connecting'}</Badge>
          <Badge variant={status.queueConnected ? 'success' : 'warning'}>{status.queueConnected ? 'Queue requires approval' : 'Queue connection needed'}</Badge>
          <Badge>Rules version {status.config.version}</Badge>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[[status.counts.approved, 'Approved'], [status.counts.total, 'Tracked members'], [status.counts.pending, 'Pending role updates']].map(([value, label]) => <div className="rounded-lg border bg-muted/30 p-3" key={label}><div className="text-xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>)}
        </div>
        <p className="text-xs text-muted-foreground">The rules bot uses approval role {status.roleId} and posts in channel {status.channelId}.</p>
        <div className="flex flex-wrap gap-2">
          {!status.queueConnected && <Button busy={busy} onClick={() => void action(async () => {
            if (!await confirm('Require the rules bot’s approval role for every party in this server?', 'Connect queue')) return
            const result = await api<Status>('/rules/connect', { method: 'POST', body: '{}' }); setStatus(result); toast('Queue connected')
          })}><ShieldCheck />Connect queue to rules bot</Button>}
          <Button variant="outline" busy={busy} onClick={() => void post()}>Post rules check in Discord</Button>
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Sort by</span>
                <Segmented<RosterSort> value={sort} onChange={setSort} options={[['approval', 'Approval'], ['infractions', 'Infractions']]} />
                <span className="text-xs text-muted-foreground">{roster.length} tracked</span>
              </div>
              <Table>
                <THead><tr><th className="text-left">Member</th><th className="text-left">State</th><th className="text-right">Infractions</th><th className="text-right">Completions</th><th className="text-right">Rules version</th></tr></THead>
                <TBody>
                  {[...roster].sort((a, b) => sort === 'infractions'
                    ? b.revocations - a.revocations || b.completions - a.completions
                    : (STATE_RANK[a.state] ?? 9) - (STATE_RANK[b.state] ?? 9) || b.revocations - a.revocations,
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
          <Label>Reason<Input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Explain why a fresh rules check is required" /></Label>
          <div className="flex flex-wrap gap-2"><Button variant="destructive-outline" busy={busy} disabled={!reason.trim()} onClick={() => void revoke('revoke')}>Revoke approval</Button><Button variant="outline" busy={busy} disabled={!reason.trim()} onClick={() => void revoke('reset')}>Require retake without penalty</Button></div>
          <div className="space-y-2">{member.history.length === 0 ? <p className="text-sm text-muted-foreground">No verification history yet.</p> : member.history.map(event => <div className="rounded-lg border p-3 text-sm" key={event.id}><div className="flex flex-wrap justify-between gap-2"><span className="font-medium">{event.kind}</span><time className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</time></div><p className="mt-1 break-words text-muted-foreground">{event.reason}</p></div>)}</div>
        </>}
        {notice && <p role="status" className="rounded-lg border bg-muted p-3 text-sm">{notice}</p>}
      </CardContent>
    </Card>

    <fieldset disabled={busy} className="space-y-5">
      <Card>
        <CardHeader><CardTitle>Rules pages</CardTitle><CardDescription>Members read these pages before starting the quiz, 1–8 of them. Changes stay in this editor until published.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{draft.pages.map((page, i) => <details key={i} className="rounded-lg border p-3" open={i === 0}>
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
        <CardHeader><CardTitle>Quiz · {draft.questions.length} questions</CardTitle><CardDescription>Keep the first six core checks. Members must answer every question correctly; answer positions are shuffled.</CardDescription></CardHeader>
        <CardContent className="space-y-3">{draft.questions.map((question, i) => {
          const update = (patch: Partial<RulesConfig['questions'][number]>) => setDraft({ ...draft, questions: draft.questions.map((q, j) => i === j ? { ...q, ...patch } : q) })
          return <details key={i} className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">{i + 1}. {question.text || 'New question'} {i < 6 && <span className="ml-1 text-xs text-muted-foreground">Core check</span>}</summary>
            <div className="mt-3 space-y-3"><Label>Question<Input maxLength={600} value={question.text} onChange={e => update({ text: e.target.value })} /></Label>
              {question.answers.map((answer, index) => <Label key={index}>{index === 0 ? 'Correct answer' : `Incorrect answer ${index}`}<Input maxLength={400} value={answer} onChange={e => update({ answers: question.answers.map((a, j) => j === index ? e.target.value : a) })} /></Label>)}
              <Label>Explanation after a wrong answer<Textarea maxLength={1000} value={question.explanation} onChange={e => update({ explanation: e.target.value })} /></Label>
              {i >= 6 && draft.questions.length > 10 && <Button variant="destructive-outline" size="sm" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })}>Remove question</Button>}
            </div></details>
        })}
          {draft.questions.length < 15 && <Button variant="outline" onClick={() => setDraft({ ...draft, questions: [...draft.questions, { text: '', answers: ['', '', ''], explanation: '' }] })}>Add question</Button>}
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
