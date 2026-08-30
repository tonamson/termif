import { dialog, ipcMain, shell } from 'electron'
import type { SqlValue } from '@termif/core'
import { CHANNELS, type DbStatement, type SerialisedDirEntry } from '../shared/ipc.js'
import type { DesktopDb } from './db.js'
import { initNative, native, serialiseDirEntry, serialiseEvents } from './native.js'

export interface HandlerDeps {
  db: DesktopDb
}

/**
 * The list of channels this module handles, in the same order it registers
 * them. Exported so a test can assert it matches `CHANNELS` exactly — a
 * missing handler would otherwise surface only when a user hits that feature.
 */
export function handlerNames(): string[] {
  return [
    CHANNELS.sshInit,
    CHANNELS.sshConnect,
    CHANNELS.sshDisconnect,
    CHANNELS.sshTrustHostKey,
    CHANNELS.sshOpenShell,
    CHANNELS.sshWrite,
    CHANNELS.sshResize,
    CHANNELS.sshCloseChannel,
    CHANNELS.sshSftpList,
    CHANNELS.sshSftpStat,
    CHANNELS.sshSftpMkdir,
    CHANNELS.sshSftpRename,
    CHANNELS.sshSftpRemove,
    CHANNELS.sshSftpReadRange,
    CHANNELS.sshSftpUpload,
    CHANNELS.sshSftpDownload,
    CHANNELS.sshCancelTransfer,
    CHANNELS.sshForwardLocal,
    CHANNELS.sshForwardRemote,
    CHANNELS.sshForwardSocks,
    CHANNELS.sshForwardBoundPort,
    CHANNELS.sshCloseForward,
    CHANNELS.sshNextEvents,
    CHANNELS.dbExec,
    CHANNELS.dbQuery,
    CHANNELS.dbTransaction,
    CHANNELS.appPickFile,
    CHANNELS.appPickSaveLocation,
    CHANNELS.appOpenExternal,
    CHANNELS.appPlatformKind,
  ]
}

/** Handles arrive from the renderer as decimal strings. */
const id = (value: string): bigint => BigInt(value)

export function registerHandlers(deps: HandlerDeps): void {
  // ---- ssh ----
  ipcMain.handle(CHANNELS.sshInit, (_e, path: string) => {
    initNative(path)
  })
  ipcMain.handle(CHANNELS.sshConnect, async (_e, cfg: unknown) =>
    (await native().connect(cfg)).toString(),
  )
  ipcMain.handle(CHANNELS.sshDisconnect, async (_e, sessionId: string) => {
    await native().disconnect(id(sessionId))
  })
  ipcMain.handle(
    CHANNELS.sshTrustHostKey,
    async (_e, host: string, port: number, algo: string, fingerprint: string) => {
      await native().trustHostKey(host, port, algo, fingerprint)
      await deps.db.exec(
        `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(host, port, algo) DO UPDATE SET key = excluded.key, added_at = excluded.added_at`,
        [host, port, algo, fingerprint, new Date().toISOString()],
      )
    },
  )
  ipcMain.handle(CHANNELS.sshOpenShell, async (_e, sessionId: string, cols: number, rows: number) =>
    (await native().openShell(id(sessionId), cols, rows)).toString(),
  )
  ipcMain.handle(CHANNELS.sshWrite, async (_e, channelId: string, data: Uint8Array) => {
    await native().write(id(channelId), data)
  })
  ipcMain.handle(CHANNELS.sshResize, async (_e, channelId: string, cols: number, rows: number) => {
    await native().resize(id(channelId), cols, rows)
  })
  ipcMain.handle(CHANNELS.sshCloseChannel, async (_e, channelId: string) => {
    await native().closeChannel(id(channelId))
  })

  ipcMain.handle(
    CHANNELS.sshSftpList,
    async (_e, sessionId: string, path: string): Promise<SerialisedDirEntry[]> =>
      (await native().sftpList(id(sessionId), path)).map(serialiseDirEntry),
  )
  ipcMain.handle(
    CHANNELS.sshSftpStat,
    async (_e, sessionId: string, path: string): Promise<SerialisedDirEntry> =>
      serialiseDirEntry(await native().sftpStat(id(sessionId), path)),
  )
  ipcMain.handle(CHANNELS.sshSftpMkdir, async (_e, sessionId: string, path: string) => {
    await native().sftpMkdir(id(sessionId), path)
  })
  ipcMain.handle(
    CHANNELS.sshSftpRename,
    async (_e, sessionId: string, from: string, to: string) => {
      await native().sftpRename(id(sessionId), from, to)
    },
  )
  ipcMain.handle(
    CHANNELS.sshSftpRemove,
    async (_e, sessionId: string, path: string, recursive: boolean) => {
      await native().sftpRemove(id(sessionId), path, recursive)
    },
  )
  ipcMain.handle(
    CHANNELS.sshSftpReadRange,
    async (_e, sessionId: string, path: string, offset: string, len: number) =>
      new Uint8Array(await native().sftpReadRange(id(sessionId), path, BigInt(offset), len)),
  )
  ipcMain.handle(
    CHANNELS.sshSftpUpload,
    async (_e, sessionId: string, local: string, remote: string) =>
      (await native().sftpUpload(id(sessionId), local, remote)).toString(),
  )
  ipcMain.handle(
    CHANNELS.sshSftpDownload,
    async (_e, sessionId: string, remote: string, local: string) =>
      (await native().sftpDownload(id(sessionId), remote, local)).toString(),
  )
  ipcMain.handle(CHANNELS.sshCancelTransfer, async (_e, transferId: string) => {
    await native().cancelTransfer(id(transferId))
  })

  ipcMain.handle(
    CHANNELS.sshForwardLocal,
    async (_e, sessionId: string, bind: string, host: string, port: number) =>
      (await native().forwardLocal(id(sessionId), bind, host, port)).toString(),
  )
  ipcMain.handle(
    CHANNELS.sshForwardRemote,
    async (
      _e,
      sessionId: string,
      bindHost: string,
      bindPort: number,
      localHost: string,
      localPort: number,
    ) =>
      (
        await native().forwardRemote(id(sessionId), bindHost, bindPort, localHost, localPort)
      ).toString(),
  )
  ipcMain.handle(CHANNELS.sshForwardSocks, async (_e, sessionId: string, bind: string) =>
    (await native().forwardSocks(id(sessionId), bind)).toString(),
  )
  ipcMain.handle(CHANNELS.sshForwardBoundPort, async (_e, forwardId: string) =>
    native().forwardBoundPort(id(forwardId)),
  )
  ipcMain.handle(CHANNELS.sshCloseForward, async (_e, forwardId: string) => {
    await native().closeForward(id(forwardId))
  })
  ipcMain.handle(CHANNELS.sshNextEvents, async (_e, timeoutMs: number) =>
    serialiseEvents(await native().nextEvents(timeoutMs)),
  )

  // ---- db ----
  ipcMain.handle(CHANNELS.dbExec, async (_e, sql: string, params: SqlValue[]) => {
    await deps.db.exec(sql, params)
  })
  ipcMain.handle(CHANNELS.dbQuery, async (_e, sql: string, params: SqlValue[]) =>
    deps.db.query(sql, params),
  )
  ipcMain.handle(CHANNELS.dbTransaction, async (_e, statements: DbStatement[]) => {
    await deps.db.transaction(statements)
  })

  // ---- app ----
  ipcMain.handle(CHANNELS.appPickFile, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(CHANNELS.appPickSaveLocation, async (_e, suggestedName: string) => {
    const result = await dialog.showSaveDialog({ defaultPath: suggestedName })
    return result.canceled ? null : (result.filePath ?? null)
  })
  ipcMain.handle(CHANNELS.appOpenExternal, async (_e, url: string) => {
    // Only http(s): opening an arbitrary scheme from the renderer would be a
    // handoff to whatever the OS has registered for it.
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`refusing to open a ${parsed.protocol} URL`)
    }
    await shell.openExternal(url)
  })
  ipcMain.handle(CHANNELS.appPlatformKind, () => 'desktop' as const)
}
