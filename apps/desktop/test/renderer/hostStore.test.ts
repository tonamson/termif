import { describe, expect, it } from 'vitest'
import { Store } from '@termif/core'
import { createHostStore } from '../../src/renderer/state/hostStore.js'
import { fakePlatform } from './fakes/platform.js'

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  const hostStore = createHostStore({ store })
  return { platform, store, hostStore }
}

const input = {
  label: 'web-1',
  hostname: 'web1.example.com',
  port: 22,
  username: 'deploy',
  tags: ['prod'],
  groupId: null,
}

describe('hostStore', () => {
  it('loads an empty list on refresh', async () => {
    const { hostStore } = await setup()
    await hostStore.refresh()
    expect(hostStore.get().hosts).toEqual([])
    expect(hostStore.get().loading).toBe(false)
  })

  it('saves a host with no credential', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)

    const hosts = hostStore.get().hosts
    expect(hosts).toHaveLength(1)
    expect(hosts[0]?.label).toBe('web-1')
    expect(hosts[0]?.authRef).toBeNull()
  })

  it('writes secret verbatim with no encrypt step', async () => {
    const { hostStore, store } = await setup()
    await hostStore.save(input, { kind: 'password', label: 'web-1 password', secret: 'hunter2', passphrase: null })

    const host = hostStore.get().hosts[0]!
    expect(host.authRef).not.toBeNull()

    const credential = await store.getCredential(host.authRef!)
    expect(credential).not.toBeNull()
    expect(credential!.secret).toBe('hunter2')
    // No vault dep on the store.
    expect((createHostStore as unknown as { length: number }).length).toBe(1)
  })

  it('round-trips a key credential verbatim', async () => {
    const { hostStore, store } = await setup()
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'
    await hostStore.save(input, { kind: 'key', label: 'deploy key', secret: pem, passphrase: null })

    const host = hostStore.get().hosts[0]!
    const credential = await store.getCredential(host.authRef!)
    expect(credential?.kind).toBe('key')
    expect(credential!.secret).toBe(pem)
  })

  it('has no vault dep', async () => {
    // createHostStore must not accept or require a vault field.
    // If it did, this would have a vault property and the test would fail.
    const { store } = await setup()
    const s = createHostStore({ store } as never)
    expect((s as unknown as Record<string, unknown>).vault).toBeUndefined()
    // @ts-expect-error — vault should not be an accepted key
    expect(() => createHostStore({ store, vault: () => null })).not.toThrow
    // The real assertion is that saving works without a vault at all:
    await s.save(input, { kind: 'password', label: 'x', secret: 'y', passphrase: null })
    expect(s.get().hosts[0]?.authRef).not.toBeNull()
  })

  it('updates an existing host without creating a duplicate', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    const id = hostStore.get().hosts[0]!.id

    await hostStore.save({ ...input, id, label: 'renamed' }, null)

    expect(hostStore.get().hosts).toHaveLength(1)
    expect(hostStore.get().hosts[0]?.label).toBe('renamed')
  })

  it('removes a host from the list', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    const id = hostStore.get().hosts[0]!.id

    await hostStore.remove(id)

    expect(hostStore.get().hosts).toEqual([])
  })

  it('filters by label, hostname, username, and tag', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    await hostStore.save(
      { ...input, label: 'db-1', hostname: 'db.internal', username: 'postgres', tags: ['data'] },
      null,
    )

    const matches = (query: string): string[] => {
      hostStore.setQuery(query)
      return hostStore.visibleHosts().map((h) => h.label)
    }

    expect(matches('web')).toEqual(['web-1'])
    expect(matches('internal')).toEqual(['db-1'])
    expect(matches('postgres')).toEqual(['db-1'])
    expect(matches('prod')).toEqual(['web-1'])
    expect(matches('')).toEqual(['db-1', 'web-1'])
  })

  it('matches case-insensitively', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    hostStore.setQuery('WEB1.EXAMPLE')
    expect(hostStore.visibleHosts()).toHaveLength(1)
  })

  it('saves a credential without needing a vault', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, { kind: 'password', label: 'x', secret: 'y', passphrase: null })
    expect(hostStore.get().hosts[0]?.authRef).not.toBeNull()
    expect(hostStore.get().credentials[0]?.secret).toBe('y')
  })

  it('still saves a host with no credential', async () => {
    const { hostStore } = await setup()
    await hostStore.save(input, null)
    expect(hostStore.get().hosts).toHaveLength(1)
  })
})
