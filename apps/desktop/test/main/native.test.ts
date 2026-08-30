import { describe, expect, it } from 'vitest'
import { serialiseEvents } from '../../src/main/native.js'

describe('serialiseEvents', () => {
  it('converts channelData and keeps the bytes intact', () => {
    const bytes = new Uint8Array([104, 105])
    const [event] = serialiseEvents([
      { kind: 'channelData', channelId: 7n, bytes, exitStatus: null },
    ])

    expect(event).toEqual({ kind: 'channelData', channelId: '7', bytes })
  })

  it('renders bigint handles as decimal strings, since bigint does not cross IPC', () => {
    const [event] = serialiseEvents([
      { kind: 'sessionClosed', sessionId: 18446744073709551615n, reason: 'gone' },
    ])
    expect(event).toEqual({
      kind: 'sessionClosed',
      sessionId: '18446744073709551615',
      reason: 'gone',
    })
  })

  it('carries a null exitStatus through as null', () => {
    const [event] = serialiseEvents([
      { kind: 'channelClosed', channelId: 3n, exitStatus: null },
    ])
    expect(event).toEqual({ kind: 'channelClosed', channelId: '3', exitStatus: null })
  })

  it('carries a numeric exitStatus through', () => {
    const [event] = serialiseEvents([{ kind: 'channelClosed', channelId: 3n, exitStatus: 130 }])
    expect(event).toEqual({ kind: 'channelClosed', channelId: '3', exitStatus: 130 })
  })

  it('stringifies transfer counters, which can exceed Number.MAX_SAFE_INTEGER', () => {
    const [event] = serialiseEvents([
      { kind: 'transferProgress', transferId: 2n, done: 9007199254740993n, total: 9007199254740994n },
    ])
    expect(event).toEqual({
      kind: 'transferProgress',
      transferId: '2',
      done: '9007199254740993',
      total: '9007199254740994',
    })
  })

  it('passes transferDone, forwardAccepted, and log through', () => {
    const events = serialiseEvents([
      { kind: 'transferDone', transferId: 4n, error: 'sftp: denied' },
      { kind: 'forwardAccepted', forwardId: 5n, peer: '127.0.0.1:40001' },
      { kind: 'log', level: 'warn', msg: 'something' },
    ])
    expect(events).toEqual([
      { kind: 'transferDone', transferId: '4', error: 'sftp: denied' },
      { kind: 'forwardAccepted', forwardId: '5', peer: '127.0.0.1:40001' },
      { kind: 'log', level: 'warn', msg: 'something' },
    ])
  })

  it('drops an event with an unrecognised kind rather than crashing the loop', () => {
    // A newer core could emit a kind this build does not know; the drain loop
    // must survive it.
    const events = serialiseEvents([{ kind: 'somethingNew' } as never])
    expect(events).toEqual([])
  })

  it('preserves order, which per-channel byte ordering depends on', () => {
    const events = serialiseEvents([
      { kind: 'channelData', channelId: 1n, bytes: new Uint8Array([1]) },
      { kind: 'channelData', channelId: 1n, bytes: new Uint8Array([2]) },
      { kind: 'channelData', channelId: 1n, bytes: new Uint8Array([3]) },
    ])
    expect(events.map((e) => (e.kind === 'channelData' ? e.bytes[0] : null))).toEqual([1, 2, 3])
  })
})
