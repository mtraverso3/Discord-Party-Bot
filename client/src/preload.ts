import { contextBridge, ipcRenderer } from 'electron'
import type {
  AutoJoinSettings, GameView, InviteResult, LcuStatus, LinkState, LobbyMode, LobbyView, SessionResult, TaggedPlayer,
} from './shared/types'

export interface PartyBotBridge {
  lcuStatus(): Promise<LcuStatus>
  linkState(): Promise<LinkState>
  linkAuth(code: string): Promise<{ ok: boolean; error?: string; displayName?: string }>
  unlink(): Promise<void>
  session(): Promise<SessionResult>
  createLobbyAndInvite(mode: LobbyMode): Promise<InviteResult>
  lobbyStatus(): Promise<LobbyView>
  gameChampions(): Promise<GameView>
  autoJoinGet(): Promise<AutoJoinSettings>
  autoJoinSet(settings: AutoJoinSettings): Promise<void>
  tagsGet(): Promise<TaggedPlayer[]>
  tagsSet(players: TaggedPlayer[]): Promise<void>
  addToParty(userId: string): Promise<{ ok: boolean; error?: string }>
}

const bridge: PartyBotBridge = {
  lcuStatus: () => ipcRenderer.invoke('lcu:status'),
  linkState: () => ipcRenderer.invoke('link:state'),
  linkAuth: (code) => ipcRenderer.invoke('link:auth', code),
  unlink: () => ipcRenderer.invoke('link:logout'),
  session: () => ipcRenderer.invoke('session:get'),
  createLobbyAndInvite: (mode) => ipcRenderer.invoke('lobby:create-invite', mode),
  lobbyStatus: () => ipcRenderer.invoke('lobby:status'),
  gameChampions: () => ipcRenderer.invoke('game:champions'),
  autoJoinGet: () => ipcRenderer.invoke('autojoin:get'),
  autoJoinSet: (settings) => ipcRenderer.invoke('autojoin:set', settings),
  tagsGet: () => ipcRenderer.invoke('tags:get'),
  tagsSet: (players) => ipcRenderer.invoke('tags:set', players),
  addToParty: (userId) => ipcRenderer.invoke('party:add', userId),
}

contextBridge.exposeInMainWorld('pb', bridge)
