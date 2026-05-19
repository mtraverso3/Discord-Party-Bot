import { DurableObject } from 'cloudflare:workers'
import type {
  PartyData, PartyMember, QueueEntry,
  JoinResult, LeaveResult, ApproveResult, DenyResult,
  RemoveResult, CloseResult, OpenResult, SetIgnResult, DisbandResult,
  ForceAddResult, PromoteResult, SetBanlistResult, UpdateResult,
} from '../types'

export class PartyState extends DurableObject {
  private cache: PartyData | null = null

  private async load(): Promise<PartyData | null> {
    if (this.cache !== null) return this.cache
    const stored = await this.ctx.storage.get<PartyData>('party')
    if (stored && Array.isArray((stored as any).banlist)) {
      // Legacy shape (string[]) — drop it; owner can re-paste.
      delete (stored as any).banlist
    }
    this.cache = stored ?? null
    return this.cache
  }

  private assignBan(data: PartyData, userId: string): void {
    if (!data.banlist) return
    if (data.banlist.assignments[userId]) return
    const next = data.banlist.pool.shift()
    if (next !== undefined) data.banlist.assignments[userId] = next
  }

  private freeBan(data: PartyData, userId: string): void {
    if (!data.banlist) return
    const ban = data.banlist.assignments[userId]
    if (ban !== undefined) {
      delete data.banlist.assignments[userId]
      data.banlist.pool.push(ban)
    }
  }

  private async save(data: PartyData): Promise<void> {
    this.cache = data
    await this.ctx.storage.put('party', data)
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const action = url.pathname.slice(1)
    const body = request.method === 'POST' ? await request.json<unknown>() : null

    try {
      switch (action) {
        case 'create':     return Response.json(await this.create(body))
        case 'get':        return Response.json(await this.load())
        case 'join':       return Response.json(await this.join(body))
        case 'forceadd':   return Response.json(await this.forceAdd(body))
        case 'leave':      return Response.json(await this.leave(body))
        case 'approve':    return Response.json(await this.approve(body))
        case 'deny':       return Response.json(await this.deny(body))
        case 'remove':     return Response.json(await this.removeFromParty(body))
        case 'promote':    return Response.json(await this.promote(body))
        case 'close':      return Response.json(await this.close(body))
        case 'open':       return Response.json(await this.open(body))
        case 'setign':     return Response.json(await this.setIgn(body))
        case 'setbanlist': return Response.json(await this.setBanlist(body))
        case 'update':     return Response.json(await this.update(body))
        case 'setmessage': return Response.json(await this.setMessage(body))
        case 'disband':    return Response.json(await this.disband(body))
        case 'forcedisband': return Response.json(await this.forceDisband())
        default:           return new Response('Not found', { status: 404 })
      }
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 })
    }
  }

  private async create(body: any): Promise<PartyData> {
    const data: PartyData = {
      id: body.id,
      guildId: body.guildId,
      name: body.name,
      description: body.description ?? '',
      game: body.game ?? 'Other',
      ownerId: body.ownerId,
      ownerName: body.ownerName,
      maxSize: body.maxSize,
      voiceChannelId: body.voiceChannelId,
      isClosed: false,
      createdAt: Date.now(),
      members: [{
        userId: body.ownerId,
        username: body.ownerUsername,
        displayName: body.ownerName,
        ign: body.ownerIgn,
        joinedAt: Date.now(),
      }],
      queue: [],
    }
    await this.save(data)
    return data
  }

  private async join(body: any): Promise<JoinResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.members.some(m => m.userId === body.userId))
      return { status: 'already_member', data }
    if (data.queue.some(q => q.userId === body.userId))
      return { status: 'already_queued', data }

    const entry: PartyMember | QueueEntry = {
      userId: body.userId,
      username: body.username,
      displayName: body.displayName,
      ign: body.ign,
      joinedAt: Date.now(),
    }

    if (!data.isClosed && data.members.length < data.maxSize) {
      data.members.push(entry as PartyMember)
      this.assignBan(data, body.userId)
      await this.save(data)
      return { status: 'joined', data }
    }

    const qEntry: QueueEntry = { ...entry, queuedAt: Date.now() }
    data.queue.push(qEntry)
    await this.save(data)
    return { status: 'queued', data }
  }

  private async forceAdd(body: any): Promise<ForceAddResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }
    if (data.members.some(m => m.userId === body.userId)) return { status: 'already_member', data }
    if (data.members.length >= data.maxSize) return { status: 'full', data }

    // If the user was waiting in the queue, lift them out first
    const queueIdx = data.queue.findIndex(q => q.userId === body.userId)
    if (queueIdx !== -1) data.queue.splice(queueIdx, 1)

    data.members.push({
      userId: body.userId,
      username: body.username,
      displayName: body.displayName,
      ign: body.ign,
      joinedAt: Date.now(),
    })
    this.assignBan(data, body.userId)
    await this.save(data)
    return { status: 'added', data }
  }

  private async leave(body: any): Promise<LeaveResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (body.userId === data.ownerId)
      return { status: 'is_owner', data }

    const memberIdx = data.members.findIndex(m => m.userId === body.userId)
    if (memberIdx !== -1) {
      data.members.splice(memberIdx, 1)
      this.freeBan(data, body.userId)

      let promoted: string | undefined
      if (!data.isClosed && data.queue.length > 0 && data.members.length < data.maxSize) {
        const next = data.queue.shift()!
        data.members.push({ ...next, joinedAt: Date.now() })
        this.assignBan(data, next.userId)
        promoted = next.userId
      }

      await this.save(data)
      return { status: 'left', data, promoted }
    }

    const queueIdx = data.queue.findIndex(q => q.userId === body.userId)
    if (queueIdx !== -1) {
      data.queue.splice(queueIdx, 1)
      await this.save(data)
      return { status: 'dequeued', data }
    }

    return { status: 'not_in', data }
  }

  private async approve(body: any): Promise<ApproveResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }
    if (data.members.length >= data.maxSize) return { status: 'full', data }

    const idx = data.queue.findIndex(q => q.userId === body.userId)
    if (idx === -1) return { status: 'not_queued', data }

    const [entry] = data.queue.splice(idx, 1)
    data.members.push({ ...entry!, joinedAt: Date.now() })
    this.assignBan(data, entry!.userId)
    await this.save(data)
    return { status: 'approved', data }
  }

  private async deny(body: any): Promise<DenyResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }

    const idx = data.queue.findIndex(q => q.userId === body.userId)
    if (idx === -1) return { status: 'not_queued', data }

    data.queue.splice(idx, 1)
    await this.save(data)
    return { status: 'denied', data }
  }

  private async removeFromParty(body: any): Promise<RemoveResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }
    if (body.userId === data.ownerId) return { status: 'is_owner', data }

    const idx = data.members.findIndex(m => m.userId === body.userId)
    if (idx === -1) return { status: 'not_in', data }

    data.members.splice(idx, 1)
    this.freeBan(data, body.userId)

    let promoted: string | undefined
    if (!data.isClosed && data.queue.length > 0 && data.members.length < data.maxSize) {
      const next = data.queue.shift()!
      data.members.push({ ...next, joinedAt: Date.now() })
      this.assignBan(data, next.userId)
      promoted = next.userId
    }

    await this.save(data)
    return { status: 'removed', data, promoted }
  }

  private async promote(body: any): Promise<PromoteResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }
    if (body.userId === data.ownerId) return { status: 'already_owner', data }

    const newOwner = data.members.find(m => m.userId === body.userId)
    if (!newOwner) return { status: 'not_in', data }

    data.ownerId = newOwner.userId
    data.ownerName = newOwner.displayName
    await this.save(data)
    return { status: 'promoted', data }
  }

  private async close(body: any): Promise<CloseResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }
    if (data.isClosed) return { status: 'already_closed', data }

    data.isClosed = true
    await this.save(data)
    return { status: 'closed', data }
  }

  private async open(body: any): Promise<OpenResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data, promoted: [] }
    if (!data.isClosed) return { status: 'already_open', data, promoted: [] }

    data.isClosed = false

    const promoted: string[] = []
    while (data.queue.length > 0 && data.members.length < data.maxSize) {
      const next = data.queue.shift()!
      data.members.push({ ...next, joinedAt: Date.now() })
      this.assignBan(data, next.userId)
      promoted.push(next.userId)
    }

    await this.save(data)
    return { status: 'opened', data, promoted }
  }

  private async setIgn(body: any): Promise<SetIgnResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    const member = data.members.find(m => m.userId === body.userId)
    if (member) {
      member.ign = body.ign
      await this.save(data)
      return { status: 'updated', data }
    }

    const queued = data.queue.find(q => q.userId === body.userId)
    if (queued) {
      queued.ign = body.ign
      await this.save(data)
      return { status: 'updated', data }
    }

    return { status: 'not_in', data }
  }

  private async setBanlist(body: any): Promise<SetBanlistResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }

    const raw = (body.banlist ?? '').toString()
    const source = raw
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .slice(0, 50)

    if (source.length === 0) {
      delete data.banlist
    } else {
      data.banlist = { source, pool: [...source], assignments: {} }
      for (const m of data.members) this.assignBan(data, m.userId)
    }

    await this.save(data)
    return { status: 'updated', data }
  }

  private async update(body: any): Promise<UpdateResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    const fail = (message: string, status: 'invalid' | 'unauthorized' = 'invalid'): UpdateResult => ({
      status, data, promoted: [], nameChanged: false, gameChanged: false, message,
    })

    if (data.ownerId !== body.requesterId) return fail('', 'unauthorized')

    let name = data.name
    if (body.name != null) {
      const trimmed = body.name.toString().trim().slice(0, 100)
      if (trimmed.length === 0) return fail('Name cannot be empty.')
      name = trimmed
    }

    let maxSize = data.maxSize
    if (body.maxSize != null) {
      const n = Number(body.maxSize)
      if (!Number.isInteger(n) || n < 2 || n > 50) {
        return fail('Player cap must be a whole number between 2 and 50.')
      }
      if (n < data.members.length) {
        return fail(`Player cap cannot be below the current member count (${data.members.length}).`)
      }
      maxSize = n
    }

    const nameChanged = data.name !== name
    const gameChanged = body.game != null && data.game !== body.game

    data.name = name
    data.maxSize = maxSize
    if (body.description != null) data.description = body.description.toString().slice(0, 1000)
    if (body.voiceChannelId != null) data.voiceChannelId = body.voiceChannelId

    if (gameChanged) {
      data.game = body.game
      const ignMap: Record<string, string> = body.ignMap ?? {}
      for (const m of data.members) m.ign = ignMap[m.userId]
      for (const q of data.queue) q.ign = ignMap[q.userId]
    }

    // Growing the cap on an open party opens spots — pull from the queue.
    const promoted: string[] = []
    if (!data.isClosed) {
      while (data.queue.length > 0 && data.members.length < data.maxSize) {
        const next = data.queue.shift()!
        data.members.push({ ...next, joinedAt: Date.now() })
        this.assignBan(data, next.userId)
        promoted.push(next.userId)
      }
    }

    await this.save(data)
    return { status: 'updated', data, promoted, nameChanged, gameChanged }
  }

  private async setMessage(body: any): Promise<PartyData> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')
    data.embedMessageId = body.messageId
    data.embedChannelId = body.channelId
    await this.save(data)
    return data
  }

  private async disband(body: any): Promise<DisbandResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }

    const finalData = { ...data }
    await this.ctx.storage.deleteAll()
    this.cache = null
    return { status: 'disbanded', data: finalData }
  }

  private async forceDisband(): Promise<DisbandResult | { status: 'gone' }> {
    const data = await this.load()
    if (!data) return { status: 'gone' }
    const finalData = { ...data }
    await this.ctx.storage.deleteAll()
    this.cache = null
    return { status: 'disbanded', data: finalData }
  }
}
