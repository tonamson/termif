import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type DesktopDb } from '../../src/main/db.js'

let dir: string | null = null
let db: DesktopDb | null = null

function open(): DesktopDb {
  dir = mkdtempSync(join(tmpdir(), 'termif-db-'))
  db = openDatabase(join(dir, 'termif.sqlite'))
  return db
}

afterEach(() => {
  db?.close()
  db = null
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe('openDatabase', () => {
  it('creates the file and runs statements', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)')
    await db.exec('INSERT INTO t (id, n) VALUES (?, ?)', ['a', 1])

    const rows = await db.query<{ id: string; n: number }>('SELECT * FROM t')
    expect(rows).toEqual([{ id: 'a', n: 1 }])
  })

  it('enables WAL, so a reader is not blocked by a writer', async () => {
    const db = open()
    const rows = await db.query<{ journal_mode: string }>('PRAGMA journal_mode')
    expect(rows[0]?.journal_mode.toLowerCase()).toBe('wal')
  })

  it('returns an empty array rather than null for a query with no rows', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT)')
    expect(await db.query('SELECT * FROM t')).toEqual([])
  })

  it('commits a transaction batch atomically', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')

    await db.transaction([
      { sql: 'INSERT INTO t (id) VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO t (id) VALUES (?)', params: ['b'] },
    ])

    expect(await db.query('SELECT * FROM t')).toHaveLength(2)
  })

  it('rolls the whole batch back when one statement fails', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT PRIMARY KEY)')
    await db.exec('INSERT INTO t (id) VALUES (?)', ['a'])

    await expect(
      db.transaction([
        { sql: 'INSERT INTO t (id) VALUES (?)', params: ['b'] },
        // Duplicate primary key: must undo the row before it too.
        { sql: 'INSERT INTO t (id) VALUES (?)', params: ['a'] },
      ]),
    ).rejects.toThrow()

    const rows = await db.query<{ id: string }>('SELECT id FROM t ORDER BY id')
    expect(rows.map((r) => r.id)).toEqual(['a'])
  })

  it('persists across a reopen', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id TEXT)')
    await db.exec('INSERT INTO t (id) VALUES (?)', ['keep'])
    const path = db.path
    db.close()

    const reopened = openDatabase(path)
    try {
      expect(await reopened.query('SELECT * FROM t')).toHaveLength(1)
    } finally {
      reopened.close()
    }
  })
})
