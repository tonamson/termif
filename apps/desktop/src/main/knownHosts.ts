import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { DesktopDb } from './db.js'

export interface KnownHostRow {
  host: string
  port: number
  algo: string
  key: string
}

export function formatKnownHostsLine(row: KnownHostRow): string {
  const pattern = row.port === 22 ? row.host : `[${row.host}]:${row.port}`
  return `${pattern} ${row.algo} ${row.key}`
}

export function parseKnownHostsLine(line: string): KnownHostRow | null {
  const trimmed = line.trim()
  if (trimmed === '' || trimmed.startsWith('#')) return null
  const parts = trimmed.split(/\s+/)
  if (parts.length < 3) return null
  const [pattern, algo, key] = parts as [string, string, string]
  let host: string
  let port: number
  if (pattern.startsWith('[')) {
    const m = pattern.match(/^\[(.+)\]:(\d+)$/)
    if (!m) return null
    host = m[1]!
    port = Number(m[2]!)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  } else {
    host = pattern
    port = 22
  }
  if (!host || !algo || !key) return null
  return { host, port, algo, key }
}

async function ensureTable(db: DesktopDb): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS known_hosts (
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      algo TEXT NOT NULL,
      key TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (host, port, algo)
    )`,
  )
}

/**
 * DB is source of truth; file is derived cache.
 * Empty table produces empty file, not a throw.
 */
export async function renderKnownHostsFile(db: DesktopDb, filePath: string): Promise<void> {
  await ensureTable(db)
  const rows = await db.query<KnownHostRow & { key: string }>(
    'SELECT host, port, algo, key FROM known_hosts',
  )
  // Sort for deterministic output (host, port, algo)
  rows.sort((a, b) => {
    if (a.host !== b.host) return a.host < b.host ? -1 : 1
    if (a.port !== b.port) return a.port - b.port
    return a.algo < b.algo ? -1 : a.algo > b.algo ? 1 : 0
  })
  const lines = rows.map((r) => formatKnownHostsLine(r))
  const content = lines.length === 0 ? '' : lines.join('\n') + '\n'
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
}

/**
 * Migration: if table empty but file exists with lines, import once.
 * Leaves file alone when table already has rows.
 */
export async function migrateKnownHostsFromFile(db: DesktopDb, filePath: string): Promise<void> {
  await ensureTable(db)
  const existing = await db.query<{ host: string }>('SELECT host FROM known_hosts')
  if (existing.length > 0) return
  let text: string
  try {
    text = await readFile(filePath, 'utf8')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return
    throw e
  }
  const lines = text.split('\n')
  const now = new Date().toISOString()
  for (const raw of lines) {
    const parsed = parseKnownHostsLine(raw)
    if (!parsed) continue
    await db.exec(
      `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(host, port, algo) DO UPDATE SET key = excluded.key, added_at = excluded.added_at`,
      [parsed.host, parsed.port, parsed.algo, parsed.key, now],
    )
  }
}

/**
 * At boot: migrate once, then render. Order is load-bearing: call initNative after.
 */
export async function syncKnownHosts(db: DesktopDb, filePath: string): Promise<void> {
  await migrateKnownHostsFromFile(db, filePath)
  await renderKnownHostsFile(db, filePath)
}

export async function prepareKnownHosts(
  db: DesktopDb,
  userData: string,
  initFn: (path: string) => void,
): Promise<string> {
  const { join } = await import('node:path')
  const knownHostsPath = join(userData, 'known_hosts')
  const legacyPath = join(userData, 'termif_known_hosts')
  await syncKnownHosts(db, knownHostsPath)
  const rows = await db.query<{ host: string }>('SELECT host FROM known_hosts')
  if (rows.length === 0) {
    await migrateKnownHostsFromFile(db, legacyPath)
    const after = await db.query<{ host: string }>('SELECT host FROM known_hosts')
    if (after.length > 0) {
      await renderKnownHostsFile(db, knownHostsPath)
    }
  }
  initFn(knownHostsPath)
  return knownHostsPath
}
