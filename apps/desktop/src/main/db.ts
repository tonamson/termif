import Database from 'better-sqlite3'
import type { SqlValue } from '@termif/core'
import type { DbStatement } from '../shared/ipc.js'

export interface DesktopDb {
  readonly path: string
  exec(sql: string, params?: readonly SqlValue[]): Promise<void>
  query<T = Record<string, SqlValue>>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  transaction(statements: readonly DbStatement[]): Promise<void>
  close(): void
}

/**
 * The local database is the app's read source; the Sheet is only sync
 * (spec §4). WAL keeps a background sync write from blocking the UI's reads.
 */
export function openDatabase(filePath: string): DesktopDb {
  const database = new Database(filePath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  // A brief wait beats an immediate SQLITE_BUSY when sync and UI overlap.
  database.pragma('busy_timeout = 5000')

  return {
    path: filePath,

    async exec(sql, params = []): Promise<void> {
      database.prepare(sql).run(params as SqlValue[])
    },

    async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      return database.prepare(sql).all(params as SqlValue[]) as T[]
    },

    /**
     * Takes the whole batch at once rather than exposing begin/commit over
     * IPC: a transaction that spans IPC round trips could be left open by a
     * renderer crash, holding a write lock indefinitely.
     */
    async transaction(statements): Promise<void> {
      const run = database.transaction((batch: readonly DbStatement[]) => {
        for (const statement of batch) {
          database.prepare(statement.sql).run(statement.params)
        }
      })
      run(statements)
    },

    close(): void {
      database.close()
    },
  }
}
