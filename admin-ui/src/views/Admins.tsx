import { ShieldCheck, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../api'
import { useConfirm } from '../components/Confirm'
import { useToast } from '../components/Toast'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorNote, Mono, Spinner, Table, TBody, THead } from '../components/ui'
import { fmtAbs, relTime } from '../lib/time'
import { useLoad } from '../lib/useLoad'
import type { Admin } from '../types'

export function Admins() {
  const toast = useToast()
  const confirm = useConfirm()
  const { data: admins, error, setData } = useLoad(() => api<Admin[]>('/admins'))
  const [busy, setBusy] = useState(false)
  const picker = useRef<UserPickerHandle>(null)

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!admins) return <Spinner />

  const add = async (userId: string, displayName?: string) => {
    if (!/^\d{15,21}$/.test(userId)) { toast('Enter a valid Discord user ID', 'err'); return }
    setBusy(true)
    try {
      setData(await api<Admin[]>('/admins', { method: 'POST', body: JSON.stringify({ userId, displayName }) }))
      picker.current?.clear()
      toast('Admin added')
    } catch (e) {
      toast((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: Admin) => {
    if (!(await confirm(`Remove ${a.displayName || a.userId} from the admin allow-list? They will lose access at their next sign-in.`, 'Remove'))) return
    try {
      await api(`/admins/${a.userId}`, { method: 'DELETE' })
      setData(admins.filter(x => x.userId !== a.userId))
      toast('Admin removed')
    } catch (e) {
      toast((e as Error).message, 'err')
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Discord admin allow-list</CardTitle>
          <CardDescription>
            These Discord users can run <Mono>/party admin</Mono> to get a single-use link that signs them in to this
            panel — no email required. Login still goes through Cloudflare Access; removing someone here cuts off access
            at their next sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex-1">
              <UserPicker
                ref={picker}
                placeholder="Search a member or paste a Discord user ID"
              />
            </div>
            <Button busy={busy} onClick={() => add(picker.current?.getId() ?? '')}>Add admin</Button>
          </div>
        </CardContent>
      </Card>

      {admins.length === 0 ? (
        <EmptyState icon={<ShieldCheck />} title="No Discord admins yet">
          Add one above, or seed the first admin with <Mono>wrangler d1 execute</Mono> (see the README).
        </EmptyState>
      ) : (
        <Card>
          <Table>
            <THead><tr><th>User</th><th>Added</th><th>Added by</th><th></th></tr></THead>
            <TBody>
              {admins.map(a => (
                <tr key={a.userId}>
                  <td>
                    <div className="font-medium">{a.displayName || '—'}</div>
                    <Mono className="text-xs text-muted-foreground">{a.userId}</Mono>
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground" title={fmtAbs(a.addedAt)}>
                    {relTime(Date.now() - a.addedAt)} ago
                  </td>
                  <td className="whitespace-nowrap text-muted-foreground">{a.addedBy || '—'}</td>
                  <td className="text-right">
                    <Button variant="ghost" size="icon" title="Remove admin" onClick={() => remove(a)}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
