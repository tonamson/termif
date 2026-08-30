import { describe, expect, it } from 'vitest'
import { mergeRows, tombstoneCutoff } from '../src/sheet/merge.js'

interface Row {
  id: string
  updatedAt: string
  value: string
  deleted?: boolean
}

const row = (id: string, updatedAt: string, value: string, deleted = false): Row => ({
  id,
  updatedAt,
  value,
  deleted,
})

const T0 = '2026-08-28T10:00:00.000Z'
const T1 = '2026-08-28T11:00:00.000Z'
const T2 = '2026-08-28T12:00:00.000Z'

describe('mergeRows', () => {
  it('pushes a row that exists only locally', () => {
    const result = mergeRows([row('a', T0, 'local')], [])
    expect(result.toPushRemotely.map((r) => r.id)).toEqual(['a'])
    expect(result.toApplyLocally).toEqual([])
  })

  it('applies a row that exists only remotely', () => {
    const result = mergeRows<Row>([], [row('a', T0, 'remote')])
    expect(result.toApplyLocally.map((r) => r.value)).toEqual(['remote'])
    expect(result.toPushRemotely).toEqual([])
  })

  it('keeps the newer side when both edited the same row', () => {
    const newerRemote = mergeRows([row('a', T0, 'local')], [row('a', T1, 'remote')])
    expect(newerRemote.toApplyLocally.map((r) => r.value)).toEqual(['remote'])
    expect(newerRemote.toPushRemotely).toEqual([])

    const newerLocal = mergeRows([row('a', T2, 'local')], [row('a', T1, 'remote')])
    expect(newerLocal.toPushRemotely.map((r) => r.value)).toEqual(['local'])
    expect(newerLocal.toApplyLocally).toEqual([])
  })

  it('does nothing when both sides are already identical in time', () => {
    const result = mergeRows([row('a', T1, 'same')], [row('a', T1, 'same')])
    expect(result.toApplyLocally).toEqual([])
    expect(result.toPushRemotely).toEqual([])
  })

  it('breaks an updatedAt tie deterministically, so all devices converge', () => {
    // Same timestamp, different content: without a tie-break, two devices
    // could each keep their own copy forever.
    const seenFromA = mergeRows([row('a', T1, 'from-a')], [row('a', T1, 'from-b')])
    const seenFromB = mergeRows([row('a', T1, 'from-b')], [row('a', T1, 'from-a')])

    const winnerA =
      seenFromA.toApplyLocally[0]?.value ?? seenFromA.toPushRemotely[0]?.value ?? 'from-a'
    const winnerB =
      seenFromB.toApplyLocally[0]?.value ?? seenFromB.toPushRemotely[0]?.value ?? 'from-b'
    expect(winnerA).toBe(winnerB)
  })

  it('lets a newer delete win over an older edit', () => {
    const result = mergeRows([row('a', T0, 'edited')], [row('a', T1, 'gone', true)])
    expect(result.toApplyLocally[0]?.deleted).toBe(true)
  })

  it('lets a newer edit win over an older delete', () => {
    // Undeleting by editing is intentional: the later action is the user's
    // most recent intent.
    const result = mergeRows([row('a', T2, 'edited-again')], [row('a', T1, 'gone', true)])
    expect(result.toPushRemotely[0]?.deleted).toBe(false)
    expect(result.toApplyLocally).toEqual([])
  })

  it('handles a mixed batch in one pass', () => {
    const local = [row('a', T2, 'local-newer'), row('b', T0, 'local-older'), row('c', T1, 'local-only')]
    const remote = [row('a', T0, 'remote-older'), row('b', T2, 'remote-newer'), row('d', T1, 'remote-only')]

    const result = mergeRows(local, remote)

    expect(result.toApplyLocally.map((r) => r.id).sort()).toEqual(['b', 'd'])
    expect(result.toPushRemotely.map((r) => r.id).sort()).toEqual(['a', 'c'])
  })

  it('does not mutate its inputs', () => {
    const local = [row('a', T0, 'local')]
    const remote = [row('a', T1, 'remote')]
    const localCopy = structuredClone(local)
    const remoteCopy = structuredClone(remote)

    mergeRows(local, remote)

    expect(local).toEqual(localCopy)
    expect(remote).toEqual(remoteCopy)
  })
})

describe('tombstoneCutoff', () => {
  it('defaults to 90 days back', () => {
    expect(tombstoneCutoff('2026-08-28T10:00:00.000Z')).toBe('2026-05-30T10:00:00.000Z')
  })

  it('accepts a custom window', () => {
    expect(tombstoneCutoff('2026-08-28T10:00:00.000Z', 1)).toBe('2026-08-27T10:00:00.000Z')
  })
})
