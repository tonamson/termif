import type { Platform, SqlValue, SshDirEntry, SshEvent } from '@termif/core'
import type { DbStatement, SerialisedDirEntry, SerialisedSshEvent, TermifApi } from '../shared/ipc.js'

export function deserialiseDirEntry(entry: SerialisedDirEntry): SshDirEntry {
  return { ...entry, size: BigInt(entry.size) }
}

export function deserialiseEvent(event: SerialisedSshEvent): SshEvent {
  switch (event.kind) {
    case 'channelData':
      return { kind: 'channelData', channelId: BigInt(event.channelId), bytes: event.bytes }
    case 'channelClosed':
      return {
        kind: 'channelClosed',
        channelId: BigInt(event.channelId),
        exitStatus: event.exitStatus,
      }
    case 'sessionClosed':
      return { kind: 'sessionClosed', sessionId: BigInt(event.sessionId), reason: event.reason }
    case 'transferProgress':
      return {
        kind: 'transferProgress',
        transferId: BigInt(event.transferId),
        done: BigInt(event.done),
        total: BigInt(event.total),
      }
    case 'transferDone':
      return { kind: 'transferDone', transferId: BigInt(event.transferId), error: event.error }
    case 'forwardAccepted':
      return { kind: 'forwardAccepted', forwardId: BigInt(event.forwardId), peer: event.peer }
    case 'log':
      return { kind: 'log', level: event.level, msg: event.msg }
  }
}

/**
 * Builds the `Platform` that `@termif/core` consumes. Everything the shell
 * knows about Electron stops here: core sees only this interface (spec §6).
 */
export function createPlatform(api: TermifApi): Platform {
  /**
   * While non-null, `exec` calls accumulate here instead of firing. Core's
   * `transaction(fn)` awaits `fn`, so the batch is complete by the time the
   * wrapper resolves.
   */
  let batch: DbStatement[] | null = null

  return {
    ssh: {
      init: (knownHostsPath) => api.ssh.init(knownHostsPath),

      connect: async (cfg) => BigInt(await api.ssh.connect(cfg)),

      disconnect: (sessionId) => api.ssh.disconnect(sessionId.toString()),

      trustHostKey: (host, port, algo, fingerprint) =>
        api.ssh.trustHostKey(host, port, algo, fingerprint),

      openShell: async (sessionId, cols, rows) =>
        BigInt(await api.ssh.openShell(sessionId.toString(), cols, rows)),

      write: (channelId, data) => api.ssh.write(channelId.toString(), data),

      resize: (channelId, cols, rows) => api.ssh.resize(channelId.toString(), cols, rows),

      closeChannel: (channelId) => api.ssh.closeChannel(channelId.toString()),

      sftpList: async (sessionId, path) =>
        (await api.ssh.sftpList(sessionId.toString(), path)).map(deserialiseDirEntry),

      sftpStat: async (sessionId, path) =>
        deserialiseDirEntry(await api.ssh.sftpStat(sessionId.toString(), path)),

      sftpMkdir: (sessionId, path) => api.ssh.sftpMkdir(sessionId.toString(), path),

      sftpRename: (sessionId, from, to) => api.ssh.sftpRename(sessionId.toString(), from, to),

      sftpRemove: (sessionId, path, recursive) =>
        api.ssh.sftpRemove(sessionId.toString(), path, recursive),

      sftpReadRange: (sessionId, path, offset, len) =>
        api.ssh.sftpReadRange(sessionId.toString(), path, offset.toString(), len),

      sftpUpload: async (sessionId, local, remote) =>
        BigInt(await api.ssh.sftpUpload(sessionId.toString(), local, remote)),

      sftpDownload: async (sessionId, remote, local) =>
        BigInt(await api.ssh.sftpDownload(sessionId.toString(), remote, local)),

      cancelTransfer: (transferId) => api.ssh.cancelTransfer(transferId.toString()),

      forwardLocal: async (sessionId, localBind, remoteHost, remotePort) =>
        BigInt(
          await api.ssh.forwardLocal(sessionId.toString(), localBind, remoteHost, remotePort),
        ),

      forwardRemote: async (sessionId, bindHost, bindPort, localHost, localPort) =>
        BigInt(
          await api.ssh.forwardRemote(
            sessionId.toString(),
            bindHost,
            bindPort,
            localHost,
            localPort,
          ),
        ),

      forwardSocks: async (sessionId, localBind) =>
        BigInt(await api.ssh.forwardSocks(sessionId.toString(), localBind)),

      forwardBoundPort: (forwardId) => api.ssh.forwardBoundPort(forwardId.toString()),

      closeForward: (forwardId) => api.ssh.closeForward(forwardId.toString()),

      nextEvents: async (timeoutMs) =>
        (await api.ssh.nextEvents(timeoutMs)).map(deserialiseEvent),
    },

    db: {
      async exec(sql: string, params: readonly SqlValue[] = []): Promise<void> {
        if (batch !== null) {
          batch.push({ sql, params: [...params] })
          return
        }
        await api.db.exec(sql, [...params])
      },

      async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
        // Reads inside a transaction would not see the batch's uncommitted
        // writes, so core never queries mid-transaction; if that changes, the
        // batching strategy needs revisiting.
        return (await api.db.query(sql, [...params])) as T[]
      },

      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        if (batch !== null) {
          // Already batching: a nested transaction joins the outer one.
          return fn()
        }
        batch = []
        try {
          const result = await fn()
          const statements = batch
          batch = null
          await api.db.transaction(statements)
          return result
        } catch (e) {
          batch = null
          throw e
        }
      },
    },

    now: () => new Date().toISOString(),

    randomBytes: (length) => {
      const bytes = new Uint8Array(length)
      crypto.getRandomValues(bytes)
      return bytes
    },
  }
}
