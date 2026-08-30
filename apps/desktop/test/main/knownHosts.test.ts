import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase, type DesktopDb } from '../../src/main/db.js'
import {
  formatKnownHostsLine,
  migrateKnownHostsFromFile,
  parseKnownHostsLine,
  prepareKnownHosts,
  renderKnownHostsFile,
  syncKnownHosts,
} from '../../src/main/knownHosts.js'

let dir: string | null = null
let db: DesktopDb | null = null

function open(): DesktopDb {
  dir = mkdtempSync(join(tmpdir(), 'termif-kh-'))
  db = openDatabase(join(dir, 'termif.sqlite'))
  return db
}

function cleanup() {
  db?.close()
  db = null
  if (dir !== null) rmSync(dir, { recursive: true, force: true })
  dir = null
}

describe('renderKnownHostsFile', () => {
  it('empty table produces empty file not throw', async () => {
    const db = open()
    const file = join(dir!, 'known_hosts')
    await expect(renderKnownHostsFile(db, file)).resolves.toBeUndefined()
    expect(readFileSync(file, 'utf8')).toBe('')
    cleanup()
  })

  it('rendering N rows produces N lines of OpenSSH format', async () => {
    const db = open()
    const file = join(dir!, 'known_hosts')
    await db.exec(
      `CREATE TABLE IF NOT EXISTS known_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, algo TEXT NOT NULL, key TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (host, port, algo))`,
    )
    await db.exec(
      `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)`,
      ['a.example.com', 22, 'ssh-ed25519', 'AAAAC3NzaC1lZDI1NTE5AAAAI1', new Date().toISOString()],
    )
    await db.exec(
      `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)`,
      ['b.example.com', 22, 'ssh-rsa', 'AAAAB3NzaC1yc2EAAAADAQABAAABAQ2', new Date().toISOString()],
    )

    await renderKnownHostsFile(db, file)

    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe('a.example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI1')
    expect(lines[1]).toBe('b.example.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ2')
    cleanup()
  })

  it('non-22 port is rendered in bracketed [host]:port form', async () => {
    const db = open()
    const file = join(dir!, 'known_hosts')
    await db.exec(
      `CREATE TABLE IF NOT EXISTS known_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, algo TEXT NOT NULL, key TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (host, port, algo))`,
    )
    await db.exec(
      `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)`,
      ['example.com', 2222, 'ssh-ed25519', 'SHA256:abc123', new Date().toISOString()],
    )

    await renderKnownHostsFile(db, file)

    const content = readFileSync(file, 'utf8').trim()
    expect(content).toBe('[example.com]:2222 ssh-ed25519 SHA256:abc123')
    cleanup()
  })
})

describe('formatKnownHostsLine', () => {
  it('formats default port without brackets', () => {
    expect(formatKnownHostsLine({ host: 'example.com', port: 22, algo: 'ssh-ed25519', key: 'AAA' })).toBe(
      'example.com ssh-ed25519 AAA',
    )
  })
  it('formats non-22 with brackets', () => {
    expect(formatKnownHostsLine({ host: 'example.com', port: 2222, algo: 'ssh-ed25519', key: 'AAA' })).toBe(
      '[example.com]:2222 ssh-ed25519 AAA',
    )
  })
})

describe('parseKnownHostsLine', () => {
  it('parses bracketed port', () => {
    expect(parseKnownHostsLine('[example.com]:2222 ssh-ed25519 SHA256:abc')).toEqual({
      host: 'example.com',
      port: 2222,
      algo: 'ssh-ed25519',
      key: 'SHA256:abc',
    })
  })
  it('ignores comments and blank lines', () => {
    expect(parseKnownHostsLine('# comment')).toBeNull()
    expect(parseKnownHostsLine('')).toBeNull()
    expect(parseKnownHostsLine('   ')).toBeNull()
  })
})

describe('migrateKnownHostsFromFile', () => {
  it('imports lines when table empty', async () => {
    const db = open()
    const file = join(dir!, 'known_hosts')
    writeFileSync(file, 'example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI\n[other.example.com]:2222 ssh-rsa AAAAB3\n')

    await migrateKnownHostsFromFile(db, file)

    const rows = await db.query<{ host: string; port: number; algo: string; key: string }>(
      'SELECT host, port, algo, key FROM known_hosts',
    )
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.host === 'example.com')?.port).toBe(22)
    expect(rows.find((r) => r.host === 'other.example.com')?.port).toBe(2222)
    cleanup()
  })

  it('does not import when table already has rows (leave file alone)', async () => {
    const db = open()
    const file = join(dir!, 'known_hosts')
    await db.exec(
      `CREATE TABLE IF NOT EXISTS known_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, algo TEXT NOT NULL, key TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (host, port, algo))`,
    )
    await db.exec(
      `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)`,
      ['existing.com', 22, 'ssh-ed25519', 'AAAEXISTING', new Date().toISOString()],
    )
    writeFileSync(file, 'new.com ssh-ed25519 AAANEW\n')

    await migrateKnownHostsFromFile(db, file)

    const rows = await db.query<{ host: string }>('SELECT host FROM known_hosts')
    expect(rows.map((r) => r.host)).toEqual(['existing.com'])
    expect(readFileSync(file, 'utf8')).toBe('new.com ssh-ed25519 AAANEW\n')
    cleanup()
  })

  it('ignores comments and blank lines during import', async () => {
    const db = open()
    const file = join(dir!, 'known_hosts')
    writeFileSync(file, '# comment\n\nexample.com ssh-ed25519 AAA\n')

    await migrateKnownHostsFromFile(db, file)

    const rows = await db.query('SELECT host FROM known_hosts')
    expect(rows).toHaveLength(1)
    cleanup()
  })

  it('no file with empty table does not throw', async () => {
    const db = open()
    const file = join(dir!, 'nonexistent_known_hosts')

    await expect(migrateKnownHostsFromFile(db, file)).resolves.toBeUndefined()
    const rows = await db.query('SELECT host FROM known_hosts')
    expect(rows).toHaveLength(0)
    cleanup()
  })
})

describe('syncKnownHosts', () => {
  it('after migration, file is rendered from DB', async () => {
    const db = open()
    const file = join(dir!, 'known_hosts')
    writeFileSync(file, 'example.com ssh-ed25519 AAA\n')

    await syncKnownHosts(db, file)

    const content = readFileSync(file, 'utf8')
    expect(content).toContain('example.com ssh-ed25519 AAA')
    const rows = await db.query('SELECT host FROM known_hosts')
    expect(rows).toHaveLength(1)
    cleanup()
  })
})

describe('boot renders file before initNative', () => {
  it('prepareKnownHosts renders file before calling initNative', async () => {
    const db = open()
    const userData = dir!
    await db.exec(
      `CREATE TABLE IF NOT EXISTS known_hosts (host TEXT NOT NULL, port INTEGER NOT NULL, algo TEXT NOT NULL, key TEXT NOT NULL, added_at TEXT NOT NULL, PRIMARY KEY (host, port, algo))`,
    )
    await db.exec(
      `INSERT INTO known_hosts (host, port, algo, key, added_at) VALUES (?, ?, ?, ?, ?)`,
      ['example.com', 22, 'ssh-ed25519', 'AAA', new Date().toISOString()],
    )

    const fakeInit = vi.fn((path: string) => {
      const content = readFileSync(path, 'utf8')
      expect(content).toContain('example.com ssh-ed25519 AAA')
    })

    await prepareKnownHosts(db, userData, fakeInit)

    expect(fakeInit).toHaveBeenCalledTimes(1)
    const knownHostsPath = join(userData, 'known_hosts')
    expect(readFileSync(knownHostsPath, 'utf8')).toContain('example.com ssh-ed25519 AAA')
    cleanup()
  })
})
