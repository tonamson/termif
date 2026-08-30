import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CHANNELS, type TermifApi } from '../shared/ipc.js'

/**
 * Wraps each channel in a plain function. No `ipcRenderer` object reaches the
 * renderer, so a compromised page cannot invoke channels we did not list.
 */
const api: TermifApi = {
  ssh: {
    init: (path) => ipcRenderer.invoke(CHANNELS.sshInit, path),
    connect: (cfg) => ipcRenderer.invoke(CHANNELS.sshConnect, cfg),
    disconnect: (id) => ipcRenderer.invoke(CHANNELS.sshDisconnect, id),
    trustHostKey: (host, port, algo, fingerprint) =>
      ipcRenderer.invoke(CHANNELS.sshTrustHostKey, host, port, algo, fingerprint),
    openShell: (id, cols, rows) => ipcRenderer.invoke(CHANNELS.sshOpenShell, id, cols, rows),
    write: (id, data) => ipcRenderer.invoke(CHANNELS.sshWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke(CHANNELS.sshResize, id, cols, rows),
    closeChannel: (id) => ipcRenderer.invoke(CHANNELS.sshCloseChannel, id),
    sftpList: (id, path) => ipcRenderer.invoke(CHANNELS.sshSftpList, id, path),
    sftpStat: (id, path) => ipcRenderer.invoke(CHANNELS.sshSftpStat, id, path),
    sftpMkdir: (id, path) => ipcRenderer.invoke(CHANNELS.sshSftpMkdir, id, path),
    sftpRename: (id, from, to) => ipcRenderer.invoke(CHANNELS.sshSftpRename, id, from, to),
    sftpRemove: (id, path, recursive) =>
      ipcRenderer.invoke(CHANNELS.sshSftpRemove, id, path, recursive),
    sftpReadRange: (id, path, offset, len) =>
      ipcRenderer.invoke(CHANNELS.sshSftpReadRange, id, path, offset, len),
    sftpUpload: (id, local, remote) => ipcRenderer.invoke(CHANNELS.sshSftpUpload, id, local, remote),
    sftpDownload: (id, remote, local) =>
      ipcRenderer.invoke(CHANNELS.sshSftpDownload, id, remote, local),
    cancelTransfer: (id) => ipcRenderer.invoke(CHANNELS.sshCancelTransfer, id),
    forwardLocal: (id, bind, host, port) =>
      ipcRenderer.invoke(CHANNELS.sshForwardLocal, id, bind, host, port),
    forwardRemote: (id, bindHost, bindPort, localHost, localPort) =>
      ipcRenderer.invoke(CHANNELS.sshForwardRemote, id, bindHost, bindPort, localHost, localPort),
    forwardSocks: (id, bind) => ipcRenderer.invoke(CHANNELS.sshForwardSocks, id, bind),
    forwardBoundPort: (id) => ipcRenderer.invoke(CHANNELS.sshForwardBoundPort, id),
    closeForward: (id) => ipcRenderer.invoke(CHANNELS.sshCloseForward, id),
    nextEvents: (timeoutMs) => ipcRenderer.invoke(CHANNELS.sshNextEvents, timeoutMs),
  },
  db: {
    exec: (sql, params) => ipcRenderer.invoke(CHANNELS.dbExec, sql, params),
    query: (sql, params) => ipcRenderer.invoke(CHANNELS.dbQuery, sql, params),
    transaction: (statements) => ipcRenderer.invoke(CHANNELS.dbTransaction, statements),
  },
  app: {
    pickFile: () => ipcRenderer.invoke(CHANNELS.appPickFile),
    pickSaveLocation: (name) => ipcRenderer.invoke(CHANNELS.appPickSaveLocation, name),
    openExternal: (url) => ipcRenderer.invoke(CHANNELS.appOpenExternal, url),
    platformKind: () => ipcRenderer.invoke(CHANNELS.appPlatformKind),
    pathForDroppedFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    },
  },
}

contextBridge.exposeInMainWorld('termif', api)
