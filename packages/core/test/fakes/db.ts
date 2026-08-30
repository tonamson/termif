import initSqlJs from 'sql.js'
import type { LocalDb, SqlValue } from '../../src/platform.js'

/**
 * A real SQL engine rather than a hand-rolled map: the store's queries are
 * part of what is under test, and a fake that cannot parse SQL would not
 * exercise them.
 */
export async function createFakeDb(): Promise<LocalDb> {
  const SQL = await initSqlJs()
  const db = new SQL.Database()

  return {
    async exec(sql: string, params: readonly SqlValue[] = []): Promise<void> {
      const stmt = db.prepare(sql)
      stmt.run(params as SqlValue[])
      stmt.free()
    },

    async query<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
      const stmt = db.prepare(sql)
      stmt.bind(params as SqlValue[])
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      stmt.free()
      return rows
    },

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
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
  }
}
