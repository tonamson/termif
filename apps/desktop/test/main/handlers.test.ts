import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CHANNELS } from '../../src/shared/ipc.js'
import { handlerNames } from '../../src/main/handlers.js'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
}))

const mockTrust = vi.fn(async () => {})
vi.mock('../../src/main/native.js', () => ({
  initNative: vi.fn(),
  native: vi.fn(() => ({ trustHostKey: mockTrust })),
  serialiseDirEntry: (x: unknown) => x,
  serialiseEvents: (x: unknown) => [],
}))

describe('registerHandlers', () => {
  it('registers a handler for every declared channel', () => {
    // A channel with no handler fails only when a user reaches that feature;
    // this catches it at build time instead.
    const declared = new Set(Object.values(CHANNELS))
    const registered = new Set(handlerNames())

    const missing = [...declared].filter((c) => !registered.has(c))
    expect(missing, `channels with no handler: ${missing.join(', ')}`).toEqual([])
  })

  it('registers no handler for a channel that does not exist', () => {
    const declared = new Set<string>(Object.values(CHANNELS))
    const extra = handlerNames().filter((c) => !declared.has(c))
    expect(extra, `handlers with no channel: ${extra.join(', ')}`).toEqual([])
  })
})

describe('ssh:trustHostKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTrust.mockResolvedValue(undefined)
  })

  it('calls the native side AND inserts the row', async () => {
    const { ipcMain } = await import('electron')
    const { registerHandlers } = await import('../../src/main/handlers.js')

    const exec = vi.fn(async () => {})
    const db = { exec, query: vi.fn(async () => []), transaction: vi.fn(async () => {}), close: vi.fn(), path: ':memory:' } as unknown as import('../../src/main/db.js').DesktopDb

    const handleMock = ipcMain.handle as unknown as ReturnType<typeof vi.fn>
    handleMock.mockClear()

    registerHandlers({ db })

    const call = (handleMock.mock.calls as unknown[][]).find((c) => c[0] === CHANNELS.sshTrustHostKey)
    expect(call, 'handler for ssh:trustHostKey not registered').toBeDefined()
    const handler = call![1] as (event: unknown, host: string, port: number, algo: string, fp: string) => Promise<void>

    await handler({}, 'example.com', 2222, 'ssh-ed25519', 'SHA256:abc')

    expect(mockTrust).toHaveBeenCalledWith('example.com', 2222, 'ssh-ed25519', 'SHA256:abc')
    expect(exec).toHaveBeenCalledTimes(1)
    const firstCall = (exec.mock.calls as unknown[][])[0]!
    const sql = firstCall[0] as string
    const params = firstCall[1] as unknown[]
    expect(sql).toMatch(/INSERT INTO known_hosts/i)
    expect(params).toEqual(['example.com', 2222, 'ssh-ed25519', 'SHA256:abc', expect.any(String)])
  })
})
