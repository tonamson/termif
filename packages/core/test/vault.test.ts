import { describe, expect, it } from 'vitest'
import { DEVICE_KEY_NAME, Vault } from '../src/vault.js'
import { CoreError } from '../src/errors.js'
import { FakeSecureStore } from './fakes/secureStore.js'
import type { Platform } from '../src/platform.js'

/**
 * Argon2id at production cost makes each unlock take ~100ms+; these tests do
 * several, so they use the schema's minimum memory cost. Correctness of the
 * KDF wiring is what is under test, not its cost.
 */
const TEST_PARAMS = { m: 16384, t: 1, p: 1 } as const

function testPlatform(): Pick<Platform, 'randomBytes' | 'secureStore'> & {
  secureStore: FakeSecureStore
} {
  const secureStore = new FakeSecureStore()
  return {
    secureStore,
    randomBytes: (n: number) => {
      const b = new Uint8Array(n)
      crypto.getRandomValues(b)
      return b
    },
  }
}

describe('Vault', () => {
  it('round-trips a secret', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'correct horse battery staple', TEST_PARAMS)
    const cipher = vault.encrypt('super-secret-password', 'cred-1')
    expect(cipher).not.toContain('super-secret')
    expect(vault.decrypt(cipher, 'cred-1')).toBe('super-secret-password')
  })

  it('produces a different ciphertext each time for the same plaintext', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const a = vault.encrypt('same', 'cred-1')
    const b = vault.encrypt('same', 'cred-1')
    expect(a).not.toBe(b)
    expect(vault.decrypt(a, 'cred-1')).toBe('same')
    expect(vault.decrypt(b, 'cred-1')).toBe('same')
  })

  it('refuses to decrypt with the wrong AAD, so a row cannot be swapped', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('secret', 'cred-1')
    expect(() => vault.decrypt(cipher, 'cred-2')).toThrow()
  })

  it('refuses to decrypt a tampered ciphertext', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('secret', 'cred-1')
    // Flip a character in the middle of the payload.
    const chars = cipher.split('')
    const mid = Math.floor(chars.length / 2)
    chars[mid] = chars[mid] === 'A' ? 'B' : 'A'
    expect(() => vault.decrypt(chars.join(''), 'cred-1')).toThrow()
  })

  it('unlocks with the right password using the stored meta', async () => {
    const p = testPlatform()
    const { vault, meta } = await Vault.create(p, 'right-password', TEST_PARAMS)
    const cipher = vault.encrypt('value', 'cred-1')

    const reopened = await Vault.unlock(p, meta, 'right-password')
    expect(reopened.decrypt(cipher, 'cred-1')).toBe('value')
  })

  it('rejects the wrong password with a specific code', async () => {
    const p = testPlatform()
    const { meta } = await Vault.create(p, 'right-password', TEST_PARAMS)
    await expect(Vault.unlock(p, meta, 'wrong-password')).rejects.toMatchObject({
      code: 'vault_wrong_password',
    })
    await expect(Vault.unlock(p, meta, 'wrong-password')).rejects.toBeInstanceOf(CoreError)
  })

  it('derives the same key from the same password and salt', async () => {
    const p = testPlatform()
    const { vault: a, meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    const b = await Vault.unlock(p, meta, 'pw')
    // Cross-decrypt proves both hold the same key.
    expect(b.decrypt(a.encrypt('x', 'aad'), 'aad')).toBe('x')
  })

  it('is unusable after lock', async () => {
    const p = testPlatform()
    const { vault } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('value', 'cred-1')
    vault.lock()
    expect(vault.isLocked()).toBe(true)
    expect(() => vault.decrypt(cipher, 'cred-1')).toThrow(/locked/i)
    expect(() => vault.encrypt('x', 'cred-1')).toThrow(/locked/i)
  })

  it('remembers the key on the device behind biometrics and unlocks from it', async () => {
    const p = testPlatform()
    const { vault, meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    const cipher = vault.encrypt('value', 'cred-1')

    await vault.rememberOnDevice(p.secureStore)
    expect(p.secureStore.biometricKeys.has(DEVICE_KEY_NAME)).toBe(true)

    const fromDevice = await Vault.unlockFromDevice(p, meta)
    expect(fromDevice).not.toBeNull()
    expect(fromDevice!.decrypt(cipher, 'cred-1')).toBe('value')
  })

  it('returns null from unlockFromDevice when nothing was remembered', async () => {
    const p = testPlatform()
    const { meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    expect(await Vault.unlockFromDevice(p, meta)).toBeNull()
  })

  it('returns null from unlockFromDevice when the stored key does not match the vault', async () => {
    // A stale device key after the master password changed must not silently
    // "work" against a vault it cannot actually open.
    const p = testPlatform()
    const first = await Vault.create(p, 'old-password', TEST_PARAMS)
    await first.vault.rememberOnDevice(p.secureStore)

    const second = await Vault.create(p, 'new-password', TEST_PARAMS)
    expect(await Vault.unlockFromDevice(p, second.meta)).toBeNull()
  })

  it('writes meta that parses against the schema', async () => {
    const { vaultMetaSchema } = await import('../src/model.js')
    const p = testPlatform()
    const { meta } = await Vault.create(p, 'pw', TEST_PARAMS)
    expect(() => vaultMetaSchema.parse(meta)).not.toThrow()
  })
})
