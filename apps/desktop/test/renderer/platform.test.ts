import { describe, expect, it, vi } from 'vitest'
import { createPlatform, deserialiseEvent } from '../../src/renderer/platform.js'
import type { TermifApi } from '../../src/shared/ipc.js'

/** A recording stub with just enough of the API for each assertion. */
function stubApi(overrides: Partial<{ [K in keyof TermifApi]: Partial<TermifApi[K]> }> = {}) {
  const calls: { name: string; args: unknown[] }[] = []
  const record =
    (name: string, result: unknown = undefined) =>
    async (...args: unknown[]) => {
      calls.push({ name, args })
      return result
    }

  const api = {
    ssh: {
      init: record('init'),
      connect: record('connect', '42'),
      disconnect: record('disconnect'),
      trustHostKey: record('trustHostKey'),
      openShell: record('openShell', '7'),
      write: record('write'),
      resize: record('resize'),
      closeChannel: record('closeChannel'),
      sftpList: record('sftpList', []),
      sftpStat: record('sftpStat', {
        name: 'f',
        size: '1024',
        isDir: false,
        isSymlink: false,
        mode: 0o644,
        modifiedUnix: 1,
      }),
      sftpMkdir: record('sftpMkdir'),
      sftpRename: record('sftpRename'),
      sftpRemove: record('sftpRemove'),
      sftpReadRange: record('sftpReadRange', new Uint8Array([1, 2])),
      sftpUpload: record('sftpUpload', '9'),
      sftpDownload: record('sftpDownload', '10'),
      cancelTransfer: record('cancelTransfer'),
      forwardLocal: record('forwardLocal', '11'),
      forwardRemote: record('forwardRemote', '12'),
      forwardSocks: record('forwardSocks', '13'),
      forwardBoundPort: record('forwardBoundPort', 51000),
      closeForward: record('closeForward'),
      nextEvents: record('nextEvents', []),
      ...overrides.ssh,
    },
    db: {
      exec: record('exec'),
      query: record('query', []),
      transaction: record('transaction'),
      ...overrides.db,
    },
    secure: {
      get: record('get', null),
      set: record('set'),
      delete: record('delete'),
      ...overrides.secure,
    },
    net: { request: record('request', { status: 200, body: '{}' }), ...overrides.net },
    auth: {
      startDeviceFlow: record('startDeviceFlow'),
      pollDeviceFlow: record('pollDeviceFlow'),
      accessToken: record('accessToken', 'token'),
      hasSession: record('hasSession', false),
      signOut: record('signOut'),
      ...overrides.auth,
    },
    app: {
      pickFile: record('pickFile', null),
      pickSaveLocation: record('pickSaveLocation', null),
      openExternal: record('openExternal'),
      platformKind: record('platformKind', 'desktop'),
      ...overrides.app,
    },
  } as unknown as TermifApi

  return { api, calls }
}

describe('createPlatform', () => {
  it('converts a returned handle string into a bigint', async () => {
    const { api } = stubApi()
    const platform = createPlatform(api)

    const sessionId = await platform.ssh.connect({
      host: 'h',
      port: 22,
      username: 'u',
      password: 'p',
      connectTimeoutMs: 1000,
      keepaliveSecs: 30,
    })

    expect(sessionId).toBe(42n)
    expect(typeof sessionId).toBe('bigint')
  })

  it('sends a bigint handle as a decimal string', async () => {
    const { api, calls } = stubApi()
    const platform = createPlatform(api)

    await platform.ssh.disconnect(18446744073709551615n)

    expect(calls.find((c) => c.name === 'disconnect')?.args).toEqual(['18446744073709551615'])
  })

  it('converts an SFTP entry size into a bigint', async () => {
    const { api } = stubApi()
    const platform = createPlatform(api)

    const entry = await platform.ssh.sftpStat(1n, '/f')

    expect(entry.size).toBe(1024n)
  })

  it('sends an SFTP read offset as a string', async () => {
    const { api, calls } = stubApi()
    const platform = createPlatform(api)

    await platform.ssh.sftpReadRange(1n, '/f', 4096n, 100)

    expect(calls.find((c) => c.name === 'sftpReadRange')?.args).toEqual(['1', '/f', '4096', 100])
  })

  it('returns an ISO timestamp from now()', () => {
    const { api } = stubApi()
    const platform = createPlatform(api)
    expect(platform.now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })

  it('produces random bytes of the requested length', () => {
    const { api } = stubApi()
    const platform = createPlatform(api)
    const bytes = platform.randomBytes(24)
    expect(bytes).toHaveLength(24)
    // Not all zeros, which would mean the CSPRNG was not called.
    expect(bytes.some((b) => b !== 0)).toBe(true)
  })

  it('passes db params through unchanged', async () => {
    const { api, calls } = stubApi()
    const platform = createPlatform(api)
    await platform.db.exec('INSERT INTO t VALUES (?)', ['a'])
    expect(calls.find((c) => c.name === 'exec')?.args).toEqual(['INSERT INTO t VALUES (?)', ['a']])
  })

  it('batches a core transaction into one IPC call', async () => {
    // Core's `transaction(fn)` runs statements through the same db handle; the
    // adapter collects them and sends one batch, because a transaction that
    // spans IPC round trips could be left open by a renderer crash.
    const { api, calls } = stubApi()
    const platform = createPlatform(api)

    await platform.db.transaction(async () => {
      await platform.db.exec('INSERT INTO t VALUES (?)', ['a'])
      await platform.db.exec('INSERT INTO t VALUES (?)', ['b'])
    })

    const transactions = calls.filter((c) => c.name === 'transaction')
    expect(transactions).toHaveLength(1)
    expect(transactions[0]?.args[0]).toEqual([
      { sql: 'INSERT INTO t VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO t VALUES (?)', params: ['b'] },
    ])
    // The individual execs must not also fire on their own.
    expect(calls.filter((c) => c.name === 'exec')).toHaveLength(0)
  })
})

describe('deserialiseEvent', () => {
  it('rebuilds channelData with a bigint handle', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(deserialiseEvent({ kind: 'channelData', channelId: '7', bytes })).toEqual({
      kind: 'channelData',
      channelId: 7n,
      bytes,
    })
  })

  it('rebuilds transferProgress counters as bigints', () => {
    expect(
      deserialiseEvent({
        kind: 'transferProgress',
        transferId: '2',
        done: '9007199254740993',
        total: '9007199254740994',
      }),
    ).toEqual({
      kind: 'transferProgress',
      transferId: 2n,
      done: 9007199254740993n,
      total: 9007199254740994n,
    })
  })

  it('passes a log event through unchanged', () => {
    expect(deserialiseEvent({ kind: 'log', level: 'warn', msg: 'x' })).toEqual({
      kind: 'log',
      level: 'warn',
      msg: 'x',
    })
  })
})
