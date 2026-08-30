import { describe, expect, it } from 'vitest'
import { Store, Vault, type Platform, type VaultMeta } from '@termif/core'
import { createVaultStore } from '../../src/renderer/state/vaultStore.js'
import { fakePlatform } from './fakes/platform.js'

/** Minimum schema-legal cost, so the tests are not dominated by Argon2id. */
const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

async function setup() {
  const platform = await fakePlatform()
  const store = await Store.open(platform)
  const vaultStore = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
  return { platform, store, vaultStore }
}

describe('vaultStore', () => {
  it('boots into needsSetup when no meta exists yet', async () => {
    const { vaultStore } = await setup()
    await vaultStore.boot()
    expect(vaultStore.get().phase).toBe('needsSetup')
  })

  it('creates a vault on setup and lands unlocked', async () => {
    const { vaultStore } = await setup()
    await vaultStore.boot()

    await vaultStore.setup('correct horse battery staple', false)

    expect(vaultStore.get().phase).toBe('unlocked')
    expect(vaultStore.vault()).not.toBeNull()
  })

  it('persists meta so a later boot lands locked, not needsSetup', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()

    expect(second.get().phase).toBe('locked')
  })

  it('unlocks with the right password', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('right', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    await second.unlock('right', false)

    expect(second.get().phase).toBe('unlocked')
    expect(second.get().error).toBeNull()
  })

  it('reports a wrong password without leaving the locked phase', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('right', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    await second.unlock('wrong', false)

    expect(second.get().phase).toBe('locked')
    expect(second.get().error).toBeTruthy()
    expect(second.vault()).toBeNull()
  })

  it('clears a previous error on a successful unlock', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('right', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    await second.unlock('wrong', false)
    await second.unlock('right', false)

    expect(second.get().error).toBeNull()
  })

  it('remembers the key on the device when asked, and unlocks from it', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', true)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()
    const unlocked = await second.tryDeviceUnlock()

    expect(unlocked).toBe(true)
    expect(second.get().phase).toBe('unlocked')
  })

  it('does not unlock from the device when nothing was remembered', async () => {
    const { platform, store, vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', false)

    const second = createVaultStore({ platform, store, kdfParams: TEST_PARAMS })
    await second.boot()

    expect(await second.tryDeviceUnlock()).toBe(false)
    expect(second.get().phase).toBe('locked')
  })

  it('locks and drops the vault reference', async () => {
    const { vaultStore } = await setup()
    await vaultStore.boot()
    await vaultStore.setup('pw', false)

    vaultStore.lock()

    expect(vaultStore.get().phase).toBe('locked')
    expect(vaultStore.vault()).toBeNull()
  })

  it('notifies subscribers on each phase change', async () => {
    const { vaultStore } = await setup()
    const phases: string[] = []
    vaultStore.subscribe(() => phases.push(vaultStore.get().phase))

    await vaultStore.boot()
    await vaultStore.setup('pw', false)
    vaultStore.lock()

    expect(phases).toContain('needsSetup')
    expect(phases).toContain('unlocked')
    expect(phases.at(-1)).toBe('locked')
  })
})
