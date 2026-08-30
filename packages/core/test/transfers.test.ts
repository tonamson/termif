import { describe, expect, it } from 'vitest'
import { TransferManager } from '../src/transfers.js'
import { FakeSsh } from './fakes/ssh.js'

async function eventually(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('condition did not become true in time')
}

describe('TransferManager', () => {
  it('starts an upload and reports it as running', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })

    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')

    expect(ssh.uploads).toEqual([{ local: '/local/a.bin', remote: 'remote/a.bin' }])
    const view = manager.list().find((t) => t.id === id)
    expect(view?.state).toBe('running')
    expect(view?.kind).toBe('upload')
  })

  it('starts a download with the arguments in the right order', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })

    await manager.enqueueDownload(1n, 'remote/b.bin', '/local/b.bin')

    expect(ssh.downloads).toEqual([{ remote: 'remote/b.bin', local: '/local/b.bin' }])
  })

  it('updates progress from transferProgress events', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'transferProgress', transferId: bridgeId, done: 512n, total: 2048n })

    const view = manager.list().find((t) => t.id === id)
    expect(view?.done).toBe(512n)
    expect(view?.total).toBe(2048n)
  })

  it('marks a transfer done on success', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'transferDone', transferId: bridgeId, error: null })

    expect(manager.list().find((t) => t.id === id)?.state).toBe('done')
  })

  it('marks a transfer failed and keeps the reason', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/local/a.bin', 'remote/a.bin')
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'transferDone', transferId: bridgeId, error: 'sftp: permission denied' })

    const view = manager.list().find((t) => t.id === id)
    expect(view?.state).toBe('failed')
    expect(view?.error).toBe('sftp: permission denied')
  })

  it('ignores an event for a transfer it does not know', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    expect(() =>
      manager.handleEvent({ kind: 'transferDone', transferId: 999n, error: null }),
    ).not.toThrow()
  })

  it('queues beyond maxConcurrent and starts the next when one finishes', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh, maxConcurrent: 1 })

    const first = await manager.enqueueUpload(1n, '/a', 'a')
    const second = await manager.enqueueUpload(1n, '/b', 'b')

    // Only the first reached the bridge.
    expect(ssh.uploads).toHaveLength(1)
    expect(manager.list().find((t) => t.id === second)?.state).toBe('queued')

    manager.handleEvent({ kind: 'transferDone', transferId: manager.bridgeIdFor(first)!, error: null })

    await eventually(() => ssh.uploads.length === 2)
    expect(manager.list().find((t) => t.id === second)?.state).toBe('running')
  })

  it('cancels a running transfer through the bridge', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    const id = await manager.enqueueUpload(1n, '/a', 'a')
    const bridgeId = manager.bridgeIdFor(id)!

    await manager.cancel(id)

    expect(ssh.cancelledTransfers).toEqual([bridgeId])
  })

  it('cancels a queued transfer without touching the bridge', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh, maxConcurrent: 1 })
    await manager.enqueueUpload(1n, '/a', 'a')
    const queued = await manager.enqueueUpload(1n, '/b', 'b')

    await manager.cancel(queued)

    expect(ssh.cancelledTransfers).toEqual([])
    expect(manager.list().find((t) => t.id === queued)?.state).toBe('cancelled')
  })

  it('rejects cancelling an unknown transfer', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    await expect(manager.cancel('nope')).rejects.toMatchObject({ code: 'no_such_transfer' })
  })

  it('notifies listeners on state changes', async () => {
    const ssh = new FakeSsh()
    const manager = new TransferManager({ ssh })
    let notifications = 0
    manager.onChange(() => notifications += 1)

    const id = await manager.enqueueUpload(1n, '/a', 'a')
    manager.handleEvent({ kind: 'transferProgress', transferId: manager.bridgeIdFor(id)!, done: 1n, total: 2n })
    manager.handleEvent({ kind: 'transferDone', transferId: manager.bridgeIdFor(id)!, error: null })

    expect(notifications).toBeGreaterThanOrEqual(3)
  })
})
