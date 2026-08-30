import { afterEach, describe, expect, it } from 'vitest'
import { SessionManager } from '../src/sessions.js'
import { FakeSsh } from './fakes/ssh.js'
import type { Host } from '../src/model.js'

const host: Host = {
  id: 'h1',
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: 'c1',
  tags: [],
  groupId: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
  deleted: false,
}

const managers: SessionManager[] = []

function makeManager(ssh: FakeSsh, reconnect?: { delaysMs: number[] }) {
  const manager = new SessionManager({
    ssh,
    now: () => '2026-08-28T10:00:00.000Z',
    ...(reconnect === undefined ? {} : { reconnectDelaysMs: reconnect.delaysMs }),
  })
  managers.push(manager)
  return manager
}

afterEach(async () => {
  while (managers.length > 0) await managers.pop()?.stop()
})

/** Waits for `check` to hold, polling briefly — events cross a real event loop. */
async function eventually(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('condition did not become true in time')
}

describe('SessionManager', () => {
  it('connects with a password credential', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })

    expect(sessionId).toBe(1n)
    expect(ssh.connects[0]?.host).toBe('web1.example.com')
    expect(ssh.connects[0]?.password).toBe('pw')
    expect(ssh.connects[0]?.privateKeyPem).toBeUndefined()
  })

  it('connects with a key credential and passes the passphrase through', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    await manager.connect(host, { privateKeyPem: '-----BEGIN-----', passphrase: 'secret' })

    expect(ssh.connects[0]?.privateKeyPem).toBe('-----BEGIN-----')
    expect(ssh.connects[0]?.passphrase).toBe('secret')
    expect(ssh.connects[0]?.password).toBeUndefined()
  })

  it('rejects a connect with neither credential', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    await expect(manager.connect(host, {})).rejects.toMatchObject({ code: 'auth' })
  })

  it('translates a bridge error into a CoreError with its code', async () => {
    const ssh = new FakeSsh()
    ssh.connectError = new Error('host_key_unknown: unknown host key for web1.example.com')
    const manager = makeManager(ssh)
    await manager.start()

    await expect(manager.connect(host, { password: 'pw' })).rejects.toMatchObject({
      code: 'host_key_unknown',
    })
  })

  it('delivers channel data only to the subscribing tab', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tabA = await manager.openTab(sessionId, 80, 24)
    const tabB = await manager.openTab(sessionId, 80, 24)

    const seenA: string[] = []
    const seenB: string[] = []
    manager.subscribeTab(tabA, (b) => seenA.push(new TextDecoder().decode(b)))
    manager.subscribeTab(tabB, (b) => seenB.push(new TextDecoder().decode(b)))

    const channelA = manager.channelIdForTab(tabA)!
    const channelB = manager.channelIdForTab(tabB)!
    ssh.pushEvent({ kind: 'channelData', channelId: channelA, bytes: new TextEncoder().encode('to-a') })
    ssh.pushEvent({ kind: 'channelData', channelId: channelB, bytes: new TextEncoder().encode('to-b') })

    await eventually(() => seenA.length > 0 && seenB.length > 0)
    expect(seenA).toEqual(['to-a'])
    expect(seenB).toEqual(['to-b'])
  })

  it('stops delivering after unsubscribe', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tab = await manager.openTab(sessionId, 80, 24)
    const seen: string[] = []
    const unsubscribe = manager.subscribeTab(tab, (b) => seen.push(new TextDecoder().decode(b)))

    const channel = manager.channelIdForTab(tab)!
    ssh.pushEvent({ kind: 'channelData', channelId: channel, bytes: new TextEncoder().encode('first') })
    await eventually(() => seen.length === 1)

    unsubscribe()
    ssh.pushEvent({ kind: 'channelData', channelId: channel, bytes: new TextEncoder().encode('second') })
    await new Promise((r) => setTimeout(r, 60))

    expect(seen).toEqual(['first'])
  })

  it('writes and resizes against the tab’s channel', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tab = await manager.openTab(sessionId, 80, 24)
    const channel = manager.channelIdForTab(tab)!

    await manager.writeToTab(tab, new TextEncoder().encode('ls\n'))
    await manager.resizeTab(tab, 132, 43)

    expect(ssh.writes[0]?.channelId).toBe(channel)
    expect(ssh.resizes[0]).toEqual({ channelId: channel, cols: 132, rows: 43 })
  })

  it('rejects a write to an unknown tab', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()
    await expect(manager.writeToTab('nope', new Uint8Array([1]))).rejects.toMatchObject({
      code: 'no_such_tab',
    })
  })

  it('taps every drained event before handling it, including kinds it ignores', async () => {
    // Transfer and forward events share this queue. A second nextEvents loop
    // would race; a tap on the one loop is the only safe fan-out (Plan 3 boot).
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const seen: string[] = []
    const unsubscribe = manager.onBridgeEvent((event) => seen.push(event.kind))

    ssh.pushEvent({
      kind: 'transferProgress',
      transferId: 9n,
      done: 1n,
      total: 2n,
    })
    ssh.pushEvent({ kind: 'log', level: 'info', msg: 'hi' })
    await eventually(() => seen.length === 2)

    expect(seen).toEqual(['transferProgress', 'log'])

    unsubscribe()
    ssh.pushEvent({
      kind: 'transferDone',
      transferId: 9n,
      error: null,
    })
    await new Promise((r) => setTimeout(r, 60))
    expect(seen).toEqual(['transferProgress', 'log'])
  })

  it('reports a tab closing with its exit status', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    const tab = await manager.openTab(sessionId, 80, 24)
    const channel = manager.channelIdForTab(tab)!

    const closed: { tab: string; status: number | null }[] = []
    manager.onTabClosed((t, status) => closed.push({ tab: t, status }))

    ssh.pushEvent({ kind: 'channelClosed', channelId: channel, exitStatus: 130 })
    await eventually(() => closed.length === 1)

    expect(closed[0]).toEqual({ tab, status: 130 })
    expect(manager.channelIdForTab(tab)).toBeUndefined()
  })

  it('reconnects after an unexpected session close and reopens each tab', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh, { delaysMs: [1, 1, 1] })
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)
    await manager.openTab(sessionId, 100, 30)
    expect(ssh.openedShells).toHaveLength(2)

    const states: string[] = []
    manager.onSessionState((_id, state) => states.push(state))

    ssh.pushEvent({ kind: 'sessionClosed', sessionId, reason: 'network changed' })

    // Two tabs are reopened on the new session.
    await eventually(() => ssh.openedShells.length === 4, 4000)
    expect(states).toContain('reconnecting')
    expect(states).toContain('connected')
    // Each tab keeps its own geometry across the reconnect.
    expect(ssh.openedShells[2]?.cols).toBe(80)
    expect(ssh.openedShells[3]?.cols).toBe(100)
  })

  it('gives up after exhausting the reconnect schedule and reports closed', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh, { delaysMs: [1, 1] })
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)

    const states: string[] = []
    manager.onSessionState((_id, state) => states.push(state))

    ssh.failConnectsRemaining = 99
    ssh.pushEvent({ kind: 'sessionClosed', sessionId, reason: 'gone' })

    await eventually(() => states.includes('closed'), 4000)
    expect(states.filter((s) => s === 'reconnecting').length).toBeGreaterThanOrEqual(1)
  })

  it('does not reconnect a session the caller closed deliberately', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh, { delaysMs: [1] })
    await manager.start()

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)
    const shellsBefore = ssh.openedShells.length

    await manager.disconnect(sessionId)
    ssh.pushEvent({ kind: 'sessionClosed', sessionId, reason: 'disconnected by application' })
    await new Promise((r) => setTimeout(r, 80))

    expect(ssh.openedShells).toHaveLength(shellsBefore)
  })

  it('runs exactly one drain loop no matter how many tabs exist', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()
    await manager.start() // second call must be a no-op

    const sessionId = await manager.connect(host, { password: 'pw' })
    await manager.openTab(sessionId, 80, 24)
    await manager.openTab(sessionId, 80, 24)

    expect(manager.drainLoopCount).toBe(1)
  })

  it('stops the drain loop on stop', async () => {
    const ssh = new FakeSsh()
    const manager = makeManager(ssh)
    await manager.start()
    await manager.stop()
    expect(manager.drainLoopCount).toBe(0)
  })
})
