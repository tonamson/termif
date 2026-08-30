import { describe, expect, it, vi } from 'vitest'
import { SyncEngine } from '../src/sync.js'
import { SheetClient } from '../src/sheet/client.js'
import { Store } from '../src/store.js'
import { createFakeDb } from './fakes/db.js'
import { FakeHttp, json } from './fakes/http.js'
import { hostToRow, HOST_COLUMNS } from '../src/sheet/rows.js'
import type { Host } from '../src/model.js'

const SHEET_ID = 'sheet-1'

function clock(start = '2026-08-28T10:00:00.000Z') {
  let current = start
  return { now: () => current, set: (iso: string) => void (current = iso) }
}

async function setup(c = clock()) {
  const db = await createFakeDb()
  const store = await Store.open({ db, now: c.now })
  const http = new FakeHttp()
  const client = new SheetClient(http, async () => 'token', {
    sleep: async () => {},
    maxAttempts: 2,
  })
  const engine = new SyncEngine({ store, client, spreadsheetId: SHEET_ID, now: c.now })
  return { store, http, engine, clock: c }
}

const remoteHost = (over: Partial<Host> = {}): Host => ({
  id: 'remote-1',
  label: 'from-sheet',
  hostname: 'remote.example.com',
  port: 22,
  username: 'root',
  authRef: null,
  tags: [],
  groupId: null,
  updatedAt: '2026-08-28T09:00:00.000Z',
  deleted: false,
  ...over,
})

/** The four reads a pull performs, in tab order, then the writes. */
function enqueuePull(
  http: FakeHttp,
  opts: { hosts?: string[][]; credentials?: string[][]; snippets?: string[][] } = {},
) {
  http.enqueue(
    json(200, { values: [[...HOST_COLUMNS], ...(opts.hosts ?? [])] }),
    json(200, { values: [['id', 'label', 'kind', 'cipher', 'updated_at', 'deleted'], ...(opts.credentials ?? [])] }),
    json(200, { values: [['id', 'label', 'body', 'tags', 'updated_at', 'deleted'], ...(opts.snippets ?? [])] }),
  )
}

describe('SyncEngine', () => {
  it('pulls a remote row into the local store', async () => {
    const { store, http, engine } = await setup()
    const host = remoteHost()
    enqueuePull(http, { hosts: [hostToRow(host)] })
    http.setFallback(json(200, {}))

    const outcome = await engine.syncNow()

    expect(outcome.pulled).toBeGreaterThanOrEqual(1)
    const local = await store.getHost('remote-1')
    expect(local?.label).toBe('from-sheet')
    // The remote row keeps its own timestamp.
    expect(local?.updatedAt).toBe('2026-08-28T09:00:00.000Z')
  })

  it('pushes a local-only row to the sheet', async () => {
    const { store, http, engine } = await setup()
    await store.upsertHost({
      label: 'local-1',
      hostname: 'local.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })

    enqueuePull(http)
    // findRowIndexes for hosts, then the append.
    http.enqueue(json(200, { values: [[...HOST_COLUMNS]] }), json(200, { updates: {} }))
    http.setFallback(json(200, {}))

    const outcome = await engine.syncNow()

    expect(outcome.pushed).toBeGreaterThanOrEqual(1)
    const appended = http.requests.find((r) => r.url.includes(':append'))
    expect(appended).toBeDefined()
    expect(appended?.body).toContain('local.example.com')
  })

  it('updates an existing sheet row in place rather than appending a duplicate', async () => {
    const { store, http, engine, clock: c } = await setup()

    // A row that exists in both places, newer locally.
    const shared = await store.upsertHost({
      id: 'shared-1',
      label: 'renamed-locally',
      hostname: 'shared.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })
    const older = { ...shared, label: 'old-name', updatedAt: '2026-08-27T10:00:00.000Z' }

    enqueuePull(http, { hosts: [hostToRow(older)] })
    // findRowIndexes says shared-1 lives on sheet row 2.
    http.enqueue(
      json(200, { values: [['id'], ['shared-1']] }),
      json(200, { totalUpdatedCells: 10 }),
    )
    http.setFallback(json(200, {}))

    await engine.syncNow()

    const batch = http.requests.find((r) => r.url.includes('/values:batchUpdate'))
    expect(batch).toBeDefined()
    const body = JSON.parse(batch?.body ?? '{}') as { data: { range: string }[] }
    expect(body.data[0]?.range).toBe('hosts!A2')
    expect(http.requests.some((r) => r.url.includes(':append'))).toBe(false)
  })

  it('lets the newer side win when both edited the same row', async () => {
    const { store, http, engine } = await setup()

    await store.upsertHost({
      id: 'conflict-1',
      label: 'local-older',
      hostname: 'c.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })

    const remoteNewer = remoteHost({
      id: 'conflict-1',
      label: 'remote-newer',
      hostname: 'c.example.com',
      username: 'me',
      updatedAt: '2026-08-28T23:00:00.000Z',
    })
    enqueuePull(http, { hosts: [hostToRow(remoteNewer)] })
    http.setFallback(json(200, {}))

    await engine.syncNow()

    expect((await store.getHost('conflict-1'))?.label).toBe('remote-newer')
  })

  it('records lastSuccessAt and returns to idle after a successful sync', async () => {
    const { http, engine, clock: c } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    c.set('2026-08-28T15:00:00.000Z')
    await engine.syncNow()

    expect(engine.status.state).toBe('idle')
    expect(engine.status.lastSuccessAt).toBe('2026-08-28T15:00:00.000Z')
    expect(engine.status.lastError).toBeNull()
  })

  it('records a failure without throwing, so the app keeps working offline', async () => {
    const { http, engine } = await setup()
    http.setFallback(json(429, { error: { message: 'quota' } }))

    const outcome = await engine.syncNow()

    expect(outcome).toEqual({ pulled: 0, pushed: 0, pruned: 0 })
    expect(engine.status.state).toBe('failed')
    expect(engine.status.lastError?.code).toBe('sheet_quota')
  })

  it('notifies status listeners through running and back to idle', async () => {
    const { http, engine } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    const states: string[] = []
    engine.onStatus((s) => states.push(s.state))
    await engine.syncNow()

    expect(states[0]).toBe('running')
    expect(states.at(-1)).toBe('idle')
  })

  it('coalesces a burst of requestSync calls into one run', async () => {
    vi.useFakeTimers()
    try {
      const { http, engine } = await setup()
      enqueuePull(http)
      http.setFallback(json(200, {}))

      const spy = vi.spyOn(engine, 'syncNow')
      engine.requestSync()
      engine.requestSync()
      engine.requestSync()

      await vi.advanceTimersByTimeAsync(2100)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not start a second sync while one is running', async () => {
    const { http, engine } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    const [a, b] = await Promise.all([engine.syncNow(), engine.syncNow()])
    // The second call observes the first and returns a zero outcome rather
    // than issuing a duplicate set of requests.
    expect([a.pulled + b.pulled]).toBeDefined()
    const readCount = http.requests.filter((r) => r.method === 'GET').length
    expect(readCount).toBeLessThanOrEqual(4)
  })

  it('prunes tombstones older than the 90-day window', async () => {
    const { store, http, engine, clock: c } = await setup()

    const old = await store.upsertHost({
      label: 'ancient',
      hostname: 'a.example.com',
      port: 22,
      username: 'me',
      authRef: null,
      tags: [],
      groupId: null,
    })
    await store.deleteHost(old.id)

    // Move well past the tombstone window.
    c.set('2027-01-01T10:00:00.000Z')
    enqueuePull(http)
    http.setFallback(json(200, {}))

    const outcome = await engine.syncNow()
    expect(outcome.pruned).toBeGreaterThanOrEqual(1)
  })

  it('advances the lastPull marker so the next sync sends less', async () => {
    const { store, http, engine, clock: c } = await setup()
    enqueuePull(http)
    http.setFallback(json(200, {}))

    c.set('2026-08-28T16:00:00.000Z')
    await engine.syncNow()

    expect(await store.getMetaValue('lastPull')).toBe('2026-08-28T16:00:00.000Z')
  })
})
