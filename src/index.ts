import { DiscordHono } from 'discord-hono'
import type { AppEnv } from './types'
import { handleBanlistModal, handleEditModal, handleParty } from './commands/party'
import { handleHelpPage, handleJoinButton, handleLeaveButton, handleQueueButton } from './components/buttons'

export { PartyState } from './durable/PartyState'

const app = new DiscordHono<AppEnv>()
  .command('party', handleParty)
  .component('party_join', handleJoinButton)
  .component('party_queue', handleQueueButton)
  .component('party_leave', handleLeaveButton)
  .component('help_page', handleHelpPage)
  .modal('party_edit', handleEditModal)
  .modal('party_banlist', handleBanlistModal)

export default app
