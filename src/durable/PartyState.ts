import { DurableObject } from 'cloudflare:workers'
import type {
  PartyData, PartyMember, QueueEntry,
  JoinResult, LeaveResult, ApproveResult, DenyResult,
  RemoveResult, CloseResult, OpenResult, SetIgnResult, DisbandResult,
  SetGameResult, ForceAddResult, PromoteResult, SetSizeResult, SetDescriptionResult, SetBanlistResult,
} from '../types'

export class PartyState extends DurableObject {
  private cache: PartyData | null = null

  private async load(): Promise<PartyData | null> {
    if (this.cache !== null) return this.cache
    const stored = await this.ctx.storage.get<PartyData>('party')
    this.cache = stored ?? null
    return this.cache
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
        case 'setsize':    return Response.json(await this.setSize(body))
        case 'close':      return Response.json(await this.close(body))
        case 'open':       return Response.json(await this.open(body))
        case 'setign':     return Response.json(await this.setIgn(body))
        case 'setgame':    return Response.json(await this.setGame(body))
        case 'setdescription': return Response.json(await this.setDescription(body))
        case 'setbanlist': return Response.json(await this.setBanlist(body))
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

      let promoted: string | undefined
      if (!data.isClosed && data.queue.length > 0 && data.members.length < data.maxSize) {
        const next = data.queue.shift()!
        data.members.push({ ...next, joinedAt: Date.now() })
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

    let promoted: string | undefined
    if (!data.isClosed && data.queue.length > 0 && data.members.length < data.maxSize) {
      const next = data.queue.shift()!
      data.members.push({ ...next, joinedAt: Date.now() })
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

  private async setSize(body: any): Promise<SetSizeResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data, promoted: [] }

    const newSize = Number(body.maxSize)
    if (!Number.isInteger(newSize) || newSize < 2 || newSize > 50) return { status: 'invalid', data, promoted: [] }
    if (newSize === data.maxSize) return { status: 'unchanged', data, promoted: [] }
    if (newSize < data.members.length) return { status: 'too_small', data, promoted: [] }

    data.maxSize = newSize

    // Growing the cap while open opens spots — pull from the queue
    const promoted: string[] = []
    if (!data.isClosed) {
      while (data.queue.length > 0 && data.members.length < data.maxSize) {
        const next = data.queue.shift()!
        data.members.push({ ...next, joinedAt: Date.now() })
        promoted.push(next.userId)
      }
    }

    await this.save(data)
    return { status: 'updated', data, promoted }
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

  private async setGame(body: any): Promise<SetGameResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }
    if (data.game === body.game) return { status: 'same_game', data }

    data.game = body.game
    const ignMap: Record<string, string> = body.ignMap ?? {}
    for (const m of data.members) {
      m.ign = ignMap[m.userId]
    }
    for (const q of data.queue) {
      q.ign = ignMap[q.userId]
    }
    await this.save(data)
    return { status: 'updated', data }
  }

  private async setDescription(body: any): Promise<SetDescriptionResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }

    data.description = (body.description ?? '').toString().slice(0, 1000)
    await this.save(data)
    return { status: 'updated', data }
  }

  private async setBanlist(body: any): Promise<SetBanlistResult> {
    const data = await this.load()
    if (!data) throw new Error('Party not found')

    if (data.ownerId !== body.requesterId) return { status: 'unauthorized', data }

    const raw = (body.banlist ?? '').toString()
    const entries = raw
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .slice(0, 50)

    data.banlist = entries
    await this.save(data)
    return { status: 'updated', data }
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
