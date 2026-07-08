import { DiscordHono } from 'discord-hono'
import type { AppBindings, AppEnv } from './types'
import {
  handleBanlistModal, handleCreateModalRaw, handleEditModalRaw, handleParty,
} from './commands/party'
import { handleAwayButton, handleHelpPage, handleJoinButton, handleLeaveButton, handleQueueButton } from './components/buttons'
import { CREATE_MODAL_PREFIX, EDIT_MODAL_PREFIX } from './lib/modal'
import { handleAdmin } from './admin'
import { handleClientApi } from './client-api'
import { tryMarkDisbanded } from './lib/party'
import { sweepInactiveParties } from './store/parties'
import { sweepExpiredAuth } from './store/clientAuth'
import { resolvePendingGames } from './store/games'

const inner = new DiscordHono<AppEnv>()
  .command('party', handleParty)
  .component('party_join', handleJoinButton)
  .component('party_queue', handleQueueButton)
  .component('party_leave', handleLeaveButton)
  .component('party_away', handleAwayButton)
  .component('help_page', handleHelpPage)
  .modal('party_banlist', handleBanlistModal)
  // party_create and party_edit are intentionally NOT registered here —
  // discord-hono's ModalContext crashes on Components V2 Label components,
  // so we intercept and dispatch the submits ourselves below.

const HOUR = 60 * 60 * 1000

export default {
  async fetch(req: Request, env: AppBindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      return handleAdmin(req, env)
    }
    if (url.pathname.startsWith('/client/')) {
      return handleClientApi(req, env, url)
    }

    if (req.method !== 'POST') return inner.fetch(req, env as any, ctx)

    const body = await req.text()
    const sig = req.headers.get('x-signature-ed25519')
    const ts = req.headers.get('x-signature-timestamp')

    if (!sig || !ts) return new Response('Missing signature', { status: 401 })
    if (!(await verifyDiscordSignature(env.DISCORD_PUBLIC_KEY, sig, ts, body))) {
      // Helps diagnose a misconfigured DISCORD_PUBLIC_KEY vs. random scanner traffic.
      console.warn('Rejected interaction with invalid signature')
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

  // Replaces the old Durable Object inactivity alarm: parties idle past their
  // tier's threshold are disbanded and their embeds greyed out; expired link
  // codes and client tokens are purged alongside.
  async scheduled(_event: ScheduledController, env: AppBindings, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const disbanded = await sweepInactiveParties(env.DB)
      for (const { party, thresholdMs } of disbanded) {
        const reason = `inactive for ${Math.round(thresholdMs / HOUR)}h`
        console.log(`Auto-disbanding party ${party.id} in guild ${party.guildId} — ${reason}`)
        await tryMarkDisbanded(env.DISCORD_BOT_TOKEN, party, reason)
      }
      await sweepExpiredAuth(env.DB)
      // Fill in participants for League games the desktop client reported once
      // the matches have finished and Match-v5 can return them.
      const resolved = await resolvePendingGames(env.DB, env.RIOT_API_KEY)
      if (resolved > 0) console.log(`Resolved ${resolved} pending League game(s)`)
    })().catch(e => console.error('scheduled sweep failed:', e)))
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
