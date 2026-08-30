import { describe, expect, it } from 'vitest'
import { Store } from '../src/store.js'
import { createFakeDb } from './fakes/db.js'
import type { Host } from '../src/model.js'

/** A controllable clock, so timestamp behaviour is assertable. */
function clock(start = '2026-08-28T10:00:00.000Z') {
  let current = start
  return {
    now: () => current,
    set: (iso: string) => {
      current = iso
    },
  }
}

async function openStore(c = clock()) {
  const db = await createFakeDb()
  const store = await Store.open({ db, now: c.now })
  return { store, clock: c }
}

const hostInput = {
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  authRef: null,
  tags: ['prod'],
  groupId: null,
}

describe('Store', () => {
  it('creates a host with a generated id and a stamped updatedAt', async () => {
    const { store } = await openStore()
    const host = await store.upsertHost(hostInput)
    expect(host.id).toMatch(/^[A-Za-z0-9_-]{16,}$/)
    expect(host.updatedAt).toBe('2026-08-28T10:00:00.000Z')
    expect(host.deleted).toBe(false)
  })

  it('lists hosts excluding tombstones', async () => {
    const { store } = await openStore()
    const a = await store.upsertHost({ ...hostInput, label: 'a' })
    await store.upsertHost({ ...hostInput, label: 'b' })

    await store.deleteHost(a.id)

    const labels = (await store.listHosts()).map((h) => h.label)
    expect(labels).toEqual(['b'])
  })

  it('tombstones rather than removing, so other devices learn of the delete', async () => {
    const { store } = await openStore()
    const host = await store.upsertHost(hostInput)
    await store.deleteHost(host.id)

    // Not in the list...
    expect(await store.getHost(host.id)).toBeNull()
    // ...but still present as a tombstone for sync to push.
    const changed = await store.rowsChangedSince('2026-01-01T00:00:00.000Z')
    const row = changed.hosts.find((h) => h.id === host.id)
    expect(row?.deleted).toBe(true)
  })

  it('advances updatedAt on a local edit', async () => {
    const { store, clock: c } = await openStore()
    const host = await store.upsertHost(hostInput)

    c.set('2026-08-28T11:00:00.000Z')
    const updated = await store.upsertHost({ ...host, label: 'renamed' })

    expect(updated.updatedAt).toBe('2026-08-28T11:00:00.000Z')
    expect(updated.id).toBe(host.id)
    expect((await store.getHost(host.id))?.label).toBe('renamed')
  })

  it('preserves updatedAt for rows applied from the sheet', async () => {
    const { store, clock: c } = await openStore()
    c.set('2026-08-28T12:00:00.000Z')

    const remote: Host = {
      id: 'remote-1',
      label: 'from-sheet',
      hostname: 'other.example.com',
      port: 2222,
      username: 'root',
      authRef: null,
      tags: [],
      groupId: null,
      // Deliberately older than the clock: applying must not bump it forward,
      // or every pull would make remote rows look newer than they are.
      updatedAt: '2026-08-27T09:00:00.000Z',
      deleted: false,
    }
    await store.applyRemote('hosts', [remote])

    expect((await store.getHost('remote-1'))?.updatedAt).toBe('2026-08-27T09:00:00.000Z')
  })

  it('round-trips tags and a null groupId', async () => {
    const { store } = await openStore()
    const host = await store.upsertHost({ ...hostInput, tags: ['prod', 'eu-west', 'db'] })
    const read = await store.getHost(host.id)
    expect(read?.tags).toEqual(['prod', 'eu-west', 'db'])
    expect(read?.groupId).toBeNull()
  })

  it('reports only rows changed after the given timestamp', async () => {
    const { store, clock: c } = await openStore()
    await store.upsertHost({ ...hostInput, label: 'old' })

    c.set('2026-08-28T13:00:00.000Z')
    await store.upsertHost({ ...hostInput, label: 'new' })

    const changed = await store.rowsChangedSince('2026-08-28T12:00:00.000Z')
    expect(changed.hosts.map((h) => h.label)).toEqual(['new'])
  })

  it('stores credentials and snippets alongside hosts', async () => {
    const { store } = await openStore()
    const cred = await store.upsertCredential({
      label: 'deploy key',
      kind: 'key',
      secret: 'AAAABBBB',
    })
    const snippet = await store.upsertSnippet({
      label: 'tail nginx',
      body: 'tail -f /var/log/nginx/error.log',
      tags: ['nginx'],
    })

    expect((await store.listCredentials()).map((c) => c.id)).toEqual([cred.id])
    expect((await store.listSnippets()).map((s) => s.id)).toEqual([snippet.id])
  })

  it('notifies listeners on change and stops after unsubscribe', async () => {
    const { store } = await openStore()
    const seen: string[] = []
    const unsubscribe = store.onChange((kind) => seen.push(kind))

    await store.upsertHost(hostInput)
    await store.upsertSnippet({ label: 's', body: 'ls', tags: [] })
    unsubscribe()
    await store.upsertHost({ ...hostInput, label: 'after' })

    expect(seen).toEqual(['hosts', 'snippets'])
  })

  it('prunes tombstones older than the cutoff and keeps newer ones', async () => {
    const { store, clock: c } = await openStore()

    const old = await store.upsertHost({ ...hostInput, label: 'old' })
    await store.deleteHost(old.id)

    c.set('2026-08-28T14:00:00.000Z')
    const recent = await store.upsertHost({ ...hostInput, label: 'recent' })
    await store.deleteHost(recent.id)

    const pruned = await store.pruneTombstones('2026-08-28T12:00:00.000Z')
    expect(pruned).toBe(1)

    const changed = await store.rowsChangedSince('2026-01-01T00:00:00.000Z')
    expect(changed.hosts.map((h) => h.id)).toEqual([recent.id])
  })

  it('keeps live rows when pruning', async () => {
    const { store } = await openStore()
    const live = await store.upsertHost(hostInput)
    await store.pruneTombstones('2030-01-01T00:00:00.000Z')
    expect(await store.getHost(live.id)).not.toBeNull()
  })

  it('stores and reads meta values', async () => {
    const { store } = await openStore()
    expect(await store.getMetaValue('lastPull')).toBeNull()
    await store.setMetaValue('lastPull', '2026-08-28T10:00:00.000Z')
    expect(await store.getMetaValue('lastPull')).toBe('2026-08-28T10:00:00.000Z')
    await store.setMetaValue('lastPull', '2026-08-28T11:00:00.000Z')
    expect(await store.getMetaValue('lastPull')).toBe('2026-08-28T11:00:00.000Z')
  })
})
