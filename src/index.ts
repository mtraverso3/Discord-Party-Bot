import { DiscordHono } from 'discord-hono'
import type { AppBindings, AppEnv } from './types'
import {
  handleBanlistModal, handleCreateModalRaw, handleEditModalRaw, handleParty,
} from './commands/party'
import { handleHelpPage, handleJoinButton, handleLeaveButton, handleQueueButton } from './components/buttons'
import { CREATE_MODAL_PREFIX, EDIT_MODAL_PREFIX } from './lib/modal'
import { handleAdmin } from './admin'
import { handleLcu } from './lcu'

export { PartyState } from './durable/PartyState'

const inner = new DiscordHono<AppEnv>()
  .command('party', handleParty)
  .component('party_join', handleJoinButton)
  .component('party_queue', handleQueueButton)
  .component('party_leave', handleLeaveButton)
  .component('help_page', handleHelpPage)
  .modal('party_banlist', handleBanlistModal)
  // party_create and party_edit are intentionally NOT registered here —
  // discord-hono's ModalContext crashes on Components V2 Label components,
  // so we intercept and dispatch the submits ourselves below.

export default {
  async fetch(req: Request, env: AppBindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return handleAdmin(req, env)
    }
    if (url.pathname.startsWith('/lcu/')) {
      return handleLcu(req, env, url)
    }

    if (req.method !== 'POST') return inner.fetch(req, env as any, ctx)

    const body = await req.text()
    const sig = req.headers.get('x-signature-ed25519')
    const ts = req.headers.get('x-signature-timestamp')

    if (!sig || !ts) return new Response('Missing signature', { status: 401 })
    if (!(await verifyDiscordSignature(env.DISCORD_PUBLIC_KEY, sig, ts, body))) {
      return new Response('Invalid signature', { status: 401 })
    }

    let interaction: any
    try { interaction = JSON.parse(body) } catch { return new Response('Bad JSON', { status: 400 }) }

    // Intercept /party create and /party edit modal submits — bypass
    // discord-hono entirely. Ack with a deferred ephemeral now; the real work
    // runs in waitUntil and edits the @original message via the webhook.
    const modalId = interaction.type === 5 ? interaction.data?.custom_id : null
    if (typeof modalId === 'string') {
      if (modalId === CREATE_MODAL_PREFIX) {
        ctx.waitUntil(handleCreateModalRaw(interaction, env))
        return Response.json({ type: 5, data: { flags: 64 } })
      }
      if (modalId.startsWith(`${EDIT_MODAL_PREFIX};`)) {
        ctx.waitUntil(handleEditModalRaw(interaction, env))
        return Response.json({ type: 5, data: { flags: 64 } })
      }
    }

    // Everything else goes through discord-hono. The body has already been
    // consumed, so re-attach it on a fresh Request; signature stays valid
    // because we pass the same bytes and headers.
    return inner.fetch(
      new Request(req.url, { method: 'POST', headers: req.headers, body }),
      env as any,
      ctx,
    )
  },
}

async function verifyDiscordSignature(
  publicKeyHex: string, signatureHex: string, timestamp: string, body: string,
): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'raw', hexToBytes(publicKeyHex), { name: 'Ed25519' } as any, false, ['verify'],
    )
    return await crypto.subtle.verify(
      { name: 'Ed25519' } as any,
      key,
      hexToBytes(signatureHex),
      new TextEncoder().encode(timestamp + body),
    )
  } catch {
    return false
  }
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}
