import { describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import initSqlJs from 'sql.js'
import { bootApp } from '../../src/renderer/state/boot.js'
import type { Platform, SqlValue } from '@termif/core'

function stubSsh(): Platform['ssh'] {
  return {
    init: async () => {},
    connect: async () => 1n,
    disconnect: async () => {},
    trustHostKey: async () => {},
    openShell: async () => 2n,
    write: async () => {},
    resize: async () => {},
    closeChannel: async () => {},
    sftpList: async () => [],
    sftpStat: async () => ({ name: 'f', size: 0n, isDir: false, isSymlink: false, mode: 0o644, modifiedUnix: 0 }),
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
  }
}

async function makeFilePlatform(dir: string) {
  const SQL = await initSqlJs()
  const path = join(dir, 'termif.sqlite')
  const raw = existsSync(path) ? new SQL.Database(readFileSync(path)) : new SQL.Database()
  const flush = () => {
    const data = raw.export()
    writeFileSync(path, Buffer.from(data))
  }
  const db: Platform['db'] = {
    exec: async (sql: string, params: readonly SqlValue[] = []) => {
      const stmt = raw.prepare(sql)
      try {
        stmt.run(params as SqlValue[])
      } finally {
        stmt.free()
      }
      // keep file in sync for copy simulation — cheap for tests
      if (/^\s*(CREATE|INSERT|UPDATE|DELETE|DROP)/i.test(sql)) flush()
    },
    query: async <T,>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> => {
      const stmt = raw.prepare(sql)
      stmt.bind(params as SqlValue[])
      const rows: T[] = []
      while (stmt.step()) rows.push(stmt.getAsObject() as T)
      stmt.free()
      return rows
    },
    transaction: async <T,>(fn: () => Promise<T>): Promise<T> => {
      raw.run('BEGIN')
      try {
        const result = await fn()
        raw.run('COMMIT')
        flush()
        return result
      } catch (e) {
        raw.run('ROLLBACK')
        throw e
      }
    },
  }
  const platform: Platform = {
    ssh: stubSsh(),
    db,
    now: () => new Date().toISOString(),
    randomBytes: (n) => {
      const bytes = new Uint8Array(n)
      crypto.getRandomValues(bytes)
      return bytes
    },
  }
  return {
    platform,
    flush,
    close: () => {
      flush()
      raw.close()
    },
    path,
  }
}

describe('portability — the database is the whole configuration', () => {
  it('given termif.sqlite copied and nothing else, bootApp lists hosts, returns secrets, and known_hosts are present', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'termif-port-A-'))
    const dirB = mkdtempSync(join(tmpdir(), 'termif-port-B-'))
    try {
      // ---- dir A: create and populate ----
      const a = await makeFilePlatform(dirA)
      const appA = await bootApp(a.platform)

      const credential = await appA.store.upsertCredential({
        label: 'prod password',
        kind: 'password',
        secret: 'hunter2',
      })
      await appA.store.upsertHost({
        label: 'web-1',
        hostname: 'web1.example.com',
        port: 2222,
        username: 'deploy',
        authRef: credential.id,
        tags: ['prod'],
        groupId: null,
      })
      await appA.store.saveKnownHost({
        host: 'web1.example.com',
        port: 2222,
        algo: 'ssh-ed25519',
        key: 'AAAAC3NzaC1lZDI1NTE5AAAAI1',
      })
      // simulate a second known host on default port
      await appA.store.saveKnownHost({
        host: 'db.example.com',
        port: 22,
        algo: 'ssh-rsa',
        key: 'AAAAB3NzaC1yc2EAAAADAQAB',
      })
      a.flush()
      a.close()

      // dirA has only the sqlite file — no secure.json, no known_hosts file
      expect(existsSync(join(dirA, 'termif.sqlite'))).toBe(true)
      expect(existsSync(join(dirA, 'secure.json'))).toBe(false)
      expect(existsSync(join(dirA, 'known_hosts'))).toBe(false)

      // ---- copy only the sqlite file ----
      const src = join(dirA, 'termif.sqlite')
      const dest = join(dirB, 'termif.sqlite')
      copyFileSync(src, dest)
      // copy any WAL/SHM if present (better-sqlite3 may create them; sql.js does not, but be safe)
      for (const suffix of ['-wal', '-shm']) {
        const s = src + suffix
        if (existsSync(s)) copyFileSync(s, dest + suffix)
      }

      // dirB has nothing else
      expect(existsSync(dest)).toBe(true)
      expect(existsSync(join(dirB, 'secure.json'))).toBe(false)
      expect(existsSync(join(dirB, 'known_hosts'))).toBe(false)

      // ---- dir B: boot from copied file ----
      const b = await makeFilePlatform(dirB)
      const appB = await bootApp(b.platform)

      const hosts = await appB.store.listHosts()
      expect(hosts).toHaveLength(1)
      expect(hosts[0]!.label).toBe('web-1')
      expect(hosts[0]!.hostname).toBe('web1.example.com')
      expect(hosts[0]!.port).toBe(2222)

      // secret survived the copy
      const credId = hosts[0]!.authRef!
      const fetched = await appB.store.getCredential(credId)
      expect(fetched).not.toBeNull()
      expect(fetched!.secret).toBe('hunter2')
      expect(fetched!.kind).toBe('password')

      // trusted host keys travelled with the database
      const known = await appB.store.listKnownHosts()
      expect(known).toHaveLength(2)
      expect(known.find((k) => k.host === 'web1.example.com' && k.port === 2222)?.key).toBe(
        'AAAAC3NzaC1lZDI1NTE5AAAAI1',
      )
      expect(known.find((k) => k.host === 'db.example.com' && k.port === 22)?.algo).toBe('ssh-rsa')

      b.close()
    } finally {
      rmSync(dirA, { recursive: true, force: true })
      rmSync(dirB, { recursive: true, force: true })
    }
  })
})
