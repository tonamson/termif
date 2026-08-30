import { describe, expect, it } from 'vitest'
import { ForwardManager } from '../src/forwards.js'
import { FakeSsh } from './fakes/ssh.js'
import { t } from '../src/i18n/index.js'

describe('ForwardManager', () => {
  it('opens a local forward and reports its bound port', async () => {
    const ssh = new FakeSsh()
    ssh.boundPort = 51000
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })

    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    expect(ssh.localForwards).toEqual([
      { localBind: '127.0.0.1:0', remoteHost: 'db.internal', remotePort: 5432 },
    ])
    const view = manager.list().find((f) => f.id === id)
    expect(view?.boundPort).toBe(51000)
    expect(view?.kind).toBe('local')
    expect(view?.description).toContain('5432')
  })

  it('opens a SOCKS forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openSocks(1n, '127.0.0.1:0')

    expect(ssh.socksForwards).toEqual(['127.0.0.1:0'])
    expect(manager.list().find((f) => f.id === id)?.kind).toBe('socks')
  })

  it('opens a remote forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openRemote(1n, '0.0.0.0', 8080, '127.0.0.1', 3000)

    expect(ssh.remoteForwards).toHaveLength(1)
    expect(manager.list().find((f) => f.id === id)?.kind).toBe('remote')
  })

  it('adds the iOS foreground-only note to a local forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'ios' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    expect(manager.list().find((f) => f.id === id)?.note).toBe(t('forward.iosForegroundOnly'))
  })

  it('adds no note to a remote forward on iOS, which needs no local listener', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'ios' })
    const id = await manager.openRemote(1n, '0.0.0.0', 8080, '127.0.0.1', 3000)

    expect(manager.list().find((f) => f.id === id)?.note).toBeNull()
  })

  it('notes the background service on Android', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'android' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    expect(manager.list().find((f) => f.id === id)?.note).toBe(t('forward.androidBackground'))
  })

  it('adds no note on desktop', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    expect(manager.list().find((f) => f.id === id)?.note).toBeNull()
  })

  it('counts accepted connections and remembers the last peer', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    const bridgeId = manager.bridgeIdFor(id)!

    manager.handleEvent({ kind: 'forwardAccepted', forwardId: bridgeId, peer: '127.0.0.1:40001' })
    manager.handleEvent({ kind: 'forwardAccepted', forwardId: bridgeId, peer: '127.0.0.1:40002' })

    const view = manager.list().find((f) => f.id === id)
    expect(view?.acceptedCount).toBe(2)
    expect(view?.lastPeer).toBe('127.0.0.1:40002')
  })

  it('ignores an accepted event for an unknown forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    expect(() =>
      manager.handleEvent({ kind: 'forwardAccepted', forwardId: 999n, peer: 'x' }),
    ).not.toThrow()
  })

  it('closes a forward and drops it from the list', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    const bridgeId = manager.bridgeIdFor(id)!

    await manager.close(id)

    expect(ssh.closedForwards).toEqual([bridgeId])
    expect(manager.list()).toEqual([])
  })

  it('rejects closing an unknown forward', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    await expect(manager.close('nope')).rejects.toMatchObject({ code: 'no_such_forward' })
  })

  it('translates a bind failure into a CoreError', async () => {
    const ssh = new FakeSsh()
    ssh.forwardLocal = async () => {
      throw new Error('forward: Address already in use')
    }
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })

    await expect(manager.openLocal(1n, '127.0.0.1:80', 'x', 1)).rejects.toMatchObject({
      code: 'forward',
    })
    expect(manager.list()).toEqual([])
  })

  it('rebuilds forwards onto the new session after a reconnect', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)
    await manager.openSocks(1n, '127.0.0.1:0')
    const before = manager.list().map((f) => f.id)

    await manager.rebuildForSession(1n, 2n)

    // Same logical forwards, re-established on the new session.
    expect(manager.list().map((f) => f.id)).toEqual(before)
    expect(ssh.localForwards).toHaveLength(2)
    expect(ssh.socksForwards).toHaveLength(2)
  })

  it('drops a forward that cannot be rebuilt rather than showing a dead one', async () => {
    const ssh = new FakeSsh()
    const manager = new ForwardManager({ ssh, platformKind: 'desktop' })
    const id = await manager.openLocal(1n, '127.0.0.1:0', 'db.internal', 5432)

    ssh.forwardLocal = async () => {
      throw new Error('forward: Address already in use')
    }
    await manager.rebuildForSession(1n, 2n)

    expect(manager.list().find((f) => f.id === id)).toBeUndefined()
  })
})
