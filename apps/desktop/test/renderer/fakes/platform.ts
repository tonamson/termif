import initSqlJs from 'sql.js'
import type { Platform, SqlValue } from '@termif/core'

/**
 * An in-process `Platform` for renderer tests: real SQL, a memory keychain, and
 * an SSH bridge that does nothing. Component tests should exercise the same
 * core code paths the app does, not a mock of them.
 */
export async function fakePlatform(): Promise<Platform> {
  const items = new Map<string, Uint8Array>()

  const SQL = await initSqlJs()
  const db = new SQL.Database()

  return {
    ssh: {
      init: async () => {},
      connect: async () => 1n,
      disconnect: async () => {},
      trustHostKey: async () => {},
      openShell: async () => 2n,
      write: async () => {},
      resize: async () => {},
      closeChannel: async () => {},
      sftpList: async () => [],
      sftpStat: async () => ({
        name: 'f',
        size: 0n,
        isDir: false,
        isSymlink: false,
        mode: 0o644,
        modifiedUnix: 0,
      }),
      sftpMkdir: async () => {},
      sftpRename: async () => {},
      sftpRemove: async () => {},
      sftpReadRange: async () => new Uint8Array(),
      sftpUpload: async () => 3n,
      sftpDownload: async () => 4n,
      cancelTransfer: async () => {},
      forwardLocal: async () => 5n,
      forwardRemote: async () => 6n,
      forwardSocks: async () => 7n,
      forwardBoundPort: async () => 51000,
      closeForward: async () => {},
      nextEvents: async (timeoutMs) => {
        await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 10)))
        return []
      },
    },
    secureStore: {
      get: async (key) => items.get(key) ?? null,
      set: async (key, value) => void items.set(key, new Uint8Array(value)),
      delete: async (key) => void items.delete(key),
    },
    db: {
      exec: async (sql: string, params: readonly SqlValue[] = []) => {
        const stmt = db.prepare(sql)
        stmt.run(params as SqlValue[])
        stmt.free()
      },
      query: async <T,>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> => {
        const stmt = db.prepare(sql)
        stmt.bind(params as SqlValue[])
        const rows: T[] = []
        while (stmt.step()) rows.push(stmt.getAsObject() as T)
        stmt.free()
        return rows
      },
      transaction: async <T,>(fn: () => Promise<T>): Promise<T> => {
        db.run('BEGIN')
        try {
          const result = await fn()
          db.run('COMMIT')
          return result
        } catch (e) {
          db.run('ROLLBACK')
          throw e
        }
      },
    },
    net: {
      request: async () => ({ status: 200, body: '{}' }),
    },
    now: () => new Date().toISOString(),
    randomBytes: (n) => {
      const bytes = new Uint8Array(n)
      crypto.getRandomValues(bytes)
      return bytes
    },
  }
}
