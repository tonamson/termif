import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../main/channels.js'
import type { HostConfig, StoredSecret, UpdateHostPayload } from '@termif/core'
import type { SerialisedDirEntry } from '../main/sftp.js'

export interface TermifApi {
  app: {
    versions: () => Promise<{ appVersion: string; schemaVersion: number; userVersion: number }>
    log: (level: string, scope: string, message: string) => Promise<void>
    getLogPath: () => Promise<string | null>
    openLog: () => Promise<void>
  }
  log: (level: string, scope: string, message: string) => Promise<void>
  hosts: {
    list: () => Promise<HostConfig[]>
    get: (id: string) => Promise<HostConfig | null>
    save: (host: HostConfig) => Promise<void>
    delete: (id: string) => Promise<void>
    update: (id: string, payload: UpdateHostPayload) => Promise<void>
    ping: (id: string) => Promise<number | null>
  }
  vault: {
    getSecret: (key: string) => Promise<StoredSecret | null>
    setSecret: (key: string, value: string) => Promise<void>
    deleteSecret: (key: string) => Promise<void>
  }
  ssh: {
    connect: (hostId: string) => Promise<{ sessionId: string }>
    disconnect: (sessionId: string) => Promise<void>
    openTab: (sessionId: string) => Promise<{ tabId: string }>
    closeTab: (tabId: string) => Promise<void>
    write: (tabId: string, bytes: Uint8Array) => Promise<void>
    resize: (tabId: string, cols: number, rows: number) => Promise<void>
    onData: (callback: (tabId: string, bytes: Uint8Array) => void) => () => void
    onTabClosed: (callback: (tabId: string) => void) => () => void
    onSessionState: (callback: (sessionId: string, state: string) => void) => () => void
  }
  sftp: {
    connect: (hostId: string) => Promise<{ sessionId: string }>
    list: (sessionId: string, path: string) => Promise<SerialisedDirEntry[]>
    stat: (sessionId: string, path: string) => Promise<SerialisedDirEntry>
    localList: (path: string) => Promise<SerialisedDirEntry[]>
  }
  pickFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>
}

const api: TermifApi = {
  app: {
    versions: () => ipcRenderer.invoke(CHANNELS.appVersions),
    log: (level, scope, message) => ipcRenderer.invoke(CHANNELS.appLog, level, scope, message),
    getLogPath: () => ipcRenderer.invoke(CHANNELS.appGetLogPath),
    openLog: () => ipcRenderer.invoke(CHANNELS.appOpenLog),
  },
  log: (level, scope, message) => ipcRenderer.invoke(CHANNELS.appLog, level, scope, message),
  hosts: {
    list: () => ipcRenderer.invoke(CHANNELS.hostsList),
    get: (id) => ipcRenderer.invoke(CHANNELS.hostsGet, id),
    save: (host) => ipcRenderer.invoke(CHANNELS.hostsSave, host),
    delete: (id) => ipcRenderer.invoke(CHANNELS.hostsDelete, id),
    update: (id, payload) => ipcRenderer.invoke(CHANNELS.hostsUpdate, id, payload),
    ping: (id) => ipcRenderer.invoke(CHANNELS.hostsPing, id),
  },
  vault: {
    getSecret: (key) => ipcRenderer.invoke(CHANNELS.vaultGetSecret, key),
    setSecret: (key, val) => ipcRenderer.invoke(CHANNELS.vaultSetSecret, key, val),
    deleteSecret: (key) => ipcRenderer.invoke(CHANNELS.vaultDeleteSecret, key),
  },
  ssh: {
    connect: (hostId) => ipcRenderer.invoke(CHANNELS.sshConnect, hostId),
    disconnect: (sessionId) => ipcRenderer.invoke(CHANNELS.sshDisconnect, sessionId),
    openTab: (sessionId) => ipcRenderer.invoke(CHANNELS.sshOpenTab, sessionId),
    closeTab: (tabId) => ipcRenderer.invoke(CHANNELS.sshCloseTab, tabId),
    write: (tabId, bytes) => ipcRenderer.invoke(CHANNELS.sshWrite, tabId, bytes),
    resize: (tabId, cols, rows) => ipcRenderer.invoke(CHANNELS.sshResize, tabId, cols, rows),
    onData: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, tabId: string, bytes: Uint8Array) => cb(tabId, bytes)
      ipcRenderer.on(CHANNELS.sshOnData, handler)
      return () => {
        ipcRenderer.removeListener(CHANNELS.sshOnData, handler)
      }
    },
    onTabClosed: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, tabId: string) => cb(tabId)
      ipcRenderer.on(CHANNELS.sshOnTabClosed, handler)
      return () => {
        ipcRenderer.removeListener(CHANNELS.sshOnTabClosed, handler)
      }
    },
    onSessionState: (cb) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, state: string) => cb(sessionId, state)
      ipcRenderer.on(CHANNELS.sshOnSessionState, handler)
      return () => {
        ipcRenderer.removeListener(CHANNELS.sshOnSessionState, handler)
      }
    },
  },
  sftp: {
    connect: (hostId) => ipcRenderer.invoke(CHANNELS.sftpConnect, hostId),
    list: (sessionId, path) => ipcRenderer.invoke(CHANNELS.sftpList, sessionId, path),
    stat: (sessionId, path) => ipcRenderer.invoke(CHANNELS.sftpStat, sessionId, path),
    localList: (path) => ipcRenderer.invoke(CHANNELS.appLocalList, path),
  },
  pickFile: (options) => ipcRenderer.invoke(CHANNELS.pickFile, options),
}

contextBridge.exposeInMainWorld('termif', api)
