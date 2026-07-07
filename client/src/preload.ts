import { contextBridge, ipcRenderer } from 'electron'
import type {
  AutoJoinSettings, InviteResult, LcuStatus, LinkState, LobbyMode, LobbyView, SessionResult,
} from './shared/types'

export interface PartyBotBridge {
  lcuStatus(): Promise<LcuStatus>
  linkState(): Promise<LinkState>
  linkAuth(code: string): Promise<{ ok: boolean; error?: string; displayName?: string }>
  unlink(): Promise<void>
  session(): Promise<SessionResult>
  createLobbyAndInvite(mode: LobbyMode): Promise<InviteResult>
  lobbyStatus(): Promise<LobbyView>
  autoJoinGet(): Promise<AutoJoinSettings>
  autoJoinSet(settings: AutoJoinSettings): Promise<void>
}

const bridge: PartyBotBridge = {
  lcuStatus: () => ipcRenderer.invoke('lcu:status'),
  linkState: () => ipcRenderer.invoke('link:state'),
  linkAuth: (code) => ipcRenderer.invoke('link:auth', code),
  unlink: () => ipcRenderer.invoke('link:logout'),
  session: () => ipcRenderer.invoke('session:get'),
  createLobbyAndInvite: (mode) => ipcRenderer.invoke('lobby:create-invite', mode),
  lobbyStatus: () => ipcRenderer.invoke('lobby:status'),
  autoJoinGet: () => ipcRenderer.invoke('autojoin:get'),
  autoJoinSet: (settings) => ipcRenderer.invoke('autojoin:set', settings),
}

contextBridge.exposeInMainWorld('pb', bridge)
