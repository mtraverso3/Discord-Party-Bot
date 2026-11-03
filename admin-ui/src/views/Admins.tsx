import { ShieldCheck, Trash2, UserPlus } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../api'
import { useConfirm } from '../components/Confirm'
import { useToast } from '../components/Toast'
import { Avatar } from '../components/Avatar'
import { UserPicker, type UserPickerHandle } from '../components/UserPicker'
import { EmptyState, ErrorNote, Mono, PageSkeleton } from '../components/common'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip'
import { fmtAbs, relTime } from '../lib/time'
import { useLoad } from '../lib/useLoad'
import type { Admin } from '../types'

export function Admins({ superAdmin }: { superAdmin: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { data: admins, error, setData } = useLoad(() => api<Admin[]>('/admins'))
  const [busy, setBusy] = useState(false)
  const picker = useRef<UserPickerHandle>(null)

  if (error) return <ErrorNote>Error: {error}</ErrorNote>
  if (!admins) return <PageSkeleton rows={3} />

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
    <div className="max-w-4xl space-y-4">
      <Alert variant="info">
        <ShieldCheck />
        <AlertDescription className="text-foreground/80">
          <p>
            These Discord users can run <Mono className="text-foreground">/party admin</Mono> to get a single-use link that signs them in to
            <strong className="text-foreground"> this server only</strong>. Only super admins can add or remove admins.
          </p>
        </AlertDescription>
      </Alert>

      <Card className="gap-0 overflow-hidden pb-0">
        <CardHeader className="pb-5">
          <CardTitle>Discord admin allow-list</CardTitle>
          <CardDescription>{admins.length} {admins.length === 1 ? 'admin' : 'admins'} for this server</CardDescription>
        </CardHeader>
        {superAdmin && (
          <CardContent className="pb-5">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={e => { e.preventDefault(); add(picker.current?.getId() ?? '') }}
            >
              <UserPicker ref={picker} className="flex-1" placeholder="Search a member or paste a Discord user ID" />
              <Button type="submit" busy={busy}>{!busy && <UserPlus />}Add admin</Button>
            </form>
          </CardContent>
        )}
        {admins.length === 0 ? (
          <div className="border-t p-6">
            <EmptyState icon={<ShieldCheck />} title="No Discord admins yet" className="border-0 bg-transparent py-6">
              Add one above, or seed the first admin with <Mono>wrangler d1 execute</Mono> (see docs/admin-ui.md).
            </EmptyState>
          </div>
        ) : (
          <div className="border-t">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>User</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Added by</TableHead>
                  {superAdmin && <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {admins.map(a => (
                  <TableRow key={a.userId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar name={a.displayName || a.userId} />
                        <div className="min-w-0">
                          <div className="font-medium">{a.displayName || '—'}</div>
                          <Mono>{a.userId}</Mono>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground" title={fmtAbs(a.addedAt)}>
                      {relTime(Date.now() - a.addedAt)} ago
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{a.addedBy || '—'}</TableCell>
                    {superAdmin && (
                      <TableCell className="text-right">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon-sm" className="hover:text-destructive" aria-label="Remove admin" onClick={() => remove(a)}>
                              <Trash2 />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Remove admin</TooltipContent>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  )
}
