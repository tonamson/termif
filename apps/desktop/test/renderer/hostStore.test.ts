import { describe, expect, it } from 'vitest'
import { Store, Vault } from '@termif/core'
import { createHostStore } from '../../src/renderer/state/hostStore.js'
import { fakePlatform } from './fakes/platform.js'

const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  const { vault } = await Vault.create(platform, 'pw', TEST_PARAMS)
  const requestSync: string[] = []
  const hostStore = createHostStore({
    store,
    vault: () => vault,
    requestSync: () => requestSync.push('sync'),
  })
  return { platform, store, vault, hostStore, requestSync }
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

  it('encrypts a password credential and links it from the host', async () => {
    const { hostStore, store, vault } = await setup()
    await hostStore.save(input, { kind: 'password', label: 'web-1 password', secret: 'hunter2' })

    const host = hostStore.get().hosts[0]!
    expect(host.authRef).not.toBeNull()

    const credential = await store.getCredential(host.authRef!)
    expect(credential).not.toBeNull()
    // The stored form must not contain the plaintext.
    expect(credential!.cipher).not.toContain('hunter2')
    expect(vault.decrypt(credential!.cipher, credential!.id)).toBe('hunter2')
  })

  it('encrypts a key credential', async () => {
    const { hostStore, store, vault } = await setup()
    const pem = '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'
    await hostStore.save(input, { kind: 'key', label: 'deploy key', secret: pem })

    const host = hostStore.get().hosts[0]!
    const credential = await store.getCredential(host.authRef!)
    expect(credential?.kind).toBe('key')
    expect(vault.decrypt(credential!.cipher, credential!.id)).toBe(pem)
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

  it('requests a sync after each mutation', async () => {
    const { hostStore, requestSync } = await setup()
    await hostStore.save(input, null)
    await hostStore.remove(hostStore.get().hosts[0]!.id)
    expect(requestSync).toHaveLength(2)
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

  it('refuses to save a credential while the vault is locked', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const hostStore = createHostStore({ store, vault: () => null, requestSync: () => {} })

    await expect(
      hostStore.save(input, { kind: 'password', label: 'x', secret: 'y' }),
    ).rejects.toMatchObject({ code: 'vault_locked' })
  })

  it('still saves a host with no credential while locked', async () => {
    const platform = await fakePlatform()
    const store = await Store.open(platform)
    const hostStore = createHostStore({ store, vault: () => null, requestSync: () => {} })

    await hostStore.save(input, null)
    expect(hostStore.get().hosts).toHaveLength(1)
  })
})
