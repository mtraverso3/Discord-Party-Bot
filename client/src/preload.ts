import { contextBridge, ipcRenderer } from 'electron'
import type {
  InviteResult, LcuStatus, LinkState, LobbyMode, LobbyView, SessionResult,
} from './shared/types'

export interface PartyBotBridge {
  lcuStatus(): Promise<LcuStatus>
  linkState(): Promise<LinkState>
  linkAuth(code: string): Promise<{ ok: boolean; error?: string; displayName?: string }>
  unlink(): Promise<void>
  session(): Promise<SessionResult>
  createLobbyAndInvite(mode: LobbyMode): Promise<InviteResult>
  lobbyStatus(): Promise<LobbyView>
}

const bridge: PartyBotBridge = {
  lcuStatus: () => ipcRenderer.invoke('lcu:status'),
  linkState: () => ipcRenderer.invoke('link:state'),
  linkAuth: (code) => ipcRenderer.invoke('link:auth', code),
  unlink: () => ipcRenderer.invoke('link:logout'),
  session: () => ipcRenderer.invoke('session:get'),
  createLobbyAndInvite: (mode) => ipcRenderer.invoke('lobby:create-invite', mode),
  lobbyStatus: () => ipcRenderer.invoke('lobby:status'),
}

contextBridge.exposeInMainWorld('pb', bridge)
