// ponytail: minimal better-sqlite3 stub for unit tests — only the SQL surface
// db.test.ts actually exercises (CREATE/INSERT/SELECT/PRAGMA/transaction).
// Full fidelity comes from e2e + Plan 7 live layers on Electron's Node.

type Row = Record<string, unknown>

interface Table {
  columns: string[]
  primaryKey?: string
  rows: Row[]
}

// Persisted per file path so "persists across a reopen" passes.
const persisted = new Map<string, Map<string, Table>>()

function cloneTables(src: Map<string, Table>): Map<string, Table> {
  const out = new Map<string, Table>()
  for (const [k, v] of src) {
    const cloned: Table & Record<string, unknown> = {
      columns: [...v.columns],
      ...(v.primaryKey !== undefined ? { primaryKey: v.primaryKey } : {}),
      rows: v.rows.map((r) => ({ ...r })),
    } as unknown as Table & Record<string, unknown>
    const ck = (v as unknown as Record<string, unknown>).compositeKeys
    if (ck) cloned.compositeKeys = [...(ck as string[])]
    out.set(k, cloned as Table)
  }
  return out
}

function normalizeParams(args: unknown[]): unknown[] {
  if (args.length === 1 && Array.isArray(args[0])) return args[0] as unknown[]
  return args
}

class MockStatement {
  constructor(
    private sql: string,
    private db: MockDatabase,
  ) {}

  run(...args: unknown[]): unknown {
    const params = normalizeParams(args)
    return this.db.runSql(this.sql, params)
  }

  all(...args: unknown[]): Row[] {
    const params = normalizeParams(args)
    return this.db.allSql(this.sql, params)
  }

  get(...args: unknown[]): Row | undefined {
    return this.all(...args)[0]
  }
}

class MockDatabase {
  private tables: Map<string, Table>

  constructor(public readonly name: string) {
    const saved = persisted.get(name)
    this.tables = saved ? cloneTables(saved) : new Map()
    // Save empty immediately so later opens see it even before close
    if (!saved) persisted.set(name, cloneTables(this.tables))
  }

  pragma(_sql: string): unknown {
    // openDatabase does pragma('journal_mode = WAL') — no-op, return wal for convenience
    return 'wal'
  }

  prepare(sql: string): MockStatement {
    return new MockStatement(sql, this)
  }

  transaction<T extends (batch: unknown) => unknown>(fn: T): T {
    const self = this
    const wrapped = ((batch: unknown) => {
      const snap = cloneTables(self.tables)
      try {
        const res = (fn as unknown as (b: unknown) => unknown)(batch)
        // Persist on success
        persisted.set(self.name, cloneTables(self.tables))
        return res
      } catch (e) {
        self.tables = snap
        throw e
      }
    }) as unknown as T
    return wrapped
  }

  close(): void {
    persisted.set(this.name, cloneTables(this.tables))
  }

  // --- internal SQL handling ---

  runSql(sql: string, params: unknown[]): unknown {
    const s = sql.trim()
    // CREATE TABLE (handles IF NOT EXISTS and composite PRIMARY KEY)
    const create = s.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\((.+)\)/is)
    if (create) {
      const table = create[1]!
      let colsRaw = create[2]!
      // Avoid recreating existing table for IF NOT EXISTS
      if (/IF\s+NOT\s+EXISTS/i.test(s) && this.tables.has(table)) return undefined
      let compositeKeys: string[] | undefined
      const pkMatch = colsRaw.match(/,\s*PRIMARY\s+KEY\s*\(([^)]+)\)/i)
      if (pkMatch) {
        compositeKeys = pkMatch[1]!.split(',').map((c) => c.trim())
        colsRaw = colsRaw.replace(pkMatch[0], '')
      } else {
        const inlinePk = colsRaw.match(/PRIMARY\s+KEY\s*\(([^)]+)\)/i)
        if (inlinePk) {
          compositeKeys = inlinePk[1]!.split(',').map((c) => c.trim())
          colsRaw = colsRaw.replace(inlinePk[0], '')
        }
      }
      const colDefs = colsRaw.split(',').map((c) => c.trim()).filter(Boolean)
      const columns: string[] = []
      let primaryKey: string | undefined
      for (const def of colDefs) {
        const m = def.match(/^(\w+)/)
        if (m) {
          columns.push(m[1]!)
          if (/PRIMARY\s+KEY/i.test(def)) primaryKey = m[1]!
        }
      }
      if (compositeKeys) {
        this.tables.set(table, {
          columns,
          primaryKey: compositeKeys.join(','),
          rows: [],
        } as unknown as Table)
        ;(this.tables.get(table) as unknown as Record<string, unknown>).compositeKeys = compositeKeys
      } else {
        this.tables.set(
          table,
          primaryKey !== undefined ? { columns, primaryKey, rows: [] } : { columns, rows: [] },
        )
      }
      persisted.set(this.name, cloneTables(this.tables))
      return undefined
    }

    // DELETE FROM (needed for cleanup in tests)
    const del = s.match(/^DELETE\s+FROM\s+(\w+)/i)
    if (del) {
      const table = del[1]!
      const t = this.tables.get(table)
      if (!t) throw new Error(`no such table: ${table}`)
      const where = s.match(/WHERE\s+(\w+)\s*=\s*\?/i)
      if (where) {
        const col = where[1]!
        const val = params[0]
        t.rows = t.rows.filter((r) => r[col] !== val)
      } else {
        t.rows = []
      }
      persisted.set(this.name, cloneTables(this.tables))
      return undefined
    }

    // UPDATE (minimal: SET col = ? WHERE col = ?)
    if (/^UPDATE\s+/i.test(s)) {
      const tableMatch = s.match(/^UPDATE\s+(\w+)/i)
      const table = tableMatch?.[1]
      if (!table) throw new Error(`unsupported UPDATE: ${sql}`)
      const t = this.tables.get(table)
      if (!t) throw new Error(`no such table: ${table}`)
      // Very narrow: only used for known_hosts upsert fallback, not needed
      persisted.set(this.name, cloneTables(this.tables))
      return undefined
    }

    // INSERT INTO (handles ON CONFLICT)
    const insert = s.match(/^INSERT\s+INTO\s+(\w+)(?:\s*\(([^)]+)\))?\s+VALUES\s*\(/i)
    if (insert) {
      const table = insert[1]!
      const colsPart = insert[2]
      const t = this.tables.get(table)
      if (!t) throw new Error(`no such table: ${table}`)
      const cols = colsPart ? colsPart.split(',').map((c) => c.trim()) : [...t.columns]
      const row: Row = {}
      cols.forEach((col, i) => {
        row[col] = params[i]
      })
      for (const c of t.columns) if (!(c in row)) row[c] = null
      const hasConflictClause = /ON\s+CONFLICT/i.test(s)
      const compositeKeys = (t as unknown as Record<string, unknown>).compositeKeys as
        | string[]
        | undefined
      if (compositeKeys) {
        const idx = t.rows.findIndex((r) => compositeKeys.every((k) => r[k] === row[k]))
        if (idx !== -1) {
          if (hasConflictClause) {
            // upsert: merge
            t.rows[idx] = { ...t.rows[idx], ...row }
            persisted.set(this.name, cloneTables(this.tables))
            return undefined
          }
          throw new Error(`UNIQUE constraint failed: ${table}.${compositeKeys.join(',')}`)
        }
      } else if (t.primaryKey) {
        const pk = t.primaryKey
        // primaryKey may be composite string like "host,port,algo" — already handled above
        if (t.rows.some((r) => r[pk] === row[pk])) {
          if (hasConflictClause) {
            const idx = t.rows.findIndex((r) => r[pk] === row[pk])
            t.rows[idx] = { ...t.rows[idx], ...row }
            persisted.set(this.name, cloneTables(this.tables))
            return undefined
          }
          throw new Error(`UNIQUE constraint failed: ${table}.${pk}`)
        }
      }
      t.rows.push(row)
      persisted.set(this.name, cloneTables(this.tables))
      return undefined
    }

    // PRAGMA via run (not used) — no-op
    if (/^PRAGMA/i.test(s)) return undefined

    throw new Error(`unsupported SQL in mock run: ${sql}`)
  }

  allSql(sql: string, params: unknown[]): Row[] {
    const s = sql.trim()
    if (/^PRAGMA\s+(\w+)/i.test(s)) {
      const m = s.match(/^PRAGMA\s+(\w+)/i)!
      const key = m[1]!.toLowerCase()
      if (key === 'journal_mode') return [{ journal_mode: 'wal' }]
      return []
    }

    const sel = s.match(/^SELECT\s+.+?\s+FROM\s+(\w+)(?:\s+ORDER\s+BY\s+(\w+))?/i)
    if (sel) {
      const table = sel[1]!
      const orderBy = sel[2]
      const t = this.tables.get(table)
      if (!t) throw new Error(`no such table: ${table}`)
      // Handle WHERE id = ? for simple cases (not needed in current tests but cheap)
      // For now, if params supplied with SELECT without WHERE, ignore — return all
      // If tests ever add WHERE, extend here.
      let rows = t.rows.map((r) => ({ ...r }))
      // Very small WHERE support: SELECT ... WHERE col = ?
      const where = s.match(/WHERE\s+(\w+)\s*=\s*\?/i)
      if (where && params.length) {
        const col = where[1]!
        rows = rows.filter((r) => r[col] === params[0])
      }
      if (orderBy) {
        rows.sort((a, b) => {
          const av = a[orderBy]
          const bv = b[orderBy]
          if (av === bv) return 0
          return av! < bv! ? -1 : 1
        })
      }
      return rows
    }

    throw new Error(`unsupported SQL in mock all: ${sql}`)
  }
}

// better-sqlite3 is a CommonJS module exporting the Database class as default
// and as module.exports. Provide both forms.
export default MockDatabase
// For CJS interop: vitest may import via `import Database from 'better-sqlite3'`
// which resolves to default. Also expose as named for safety.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(MockDatabase as unknown as Record<string, unknown>).default = MockDatabase
