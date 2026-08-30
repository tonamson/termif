import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { argon2id } from '@noble/hashes/argon2.js'

import { CoreError } from './errors.js'
import { SCHEMA_VERSION } from './model.js'
import type { Platform, SecureStore } from './platform.js'

// ponytail: kept locally until Task 5 deletes the vault — model no longer exports vault types
export const DEFAULT_KDF_PARAMS = { m: 65536, t: 3, p: 1 } as const
export type KdfParams = { m: number; t: number; p: number }
export type VaultMeta = {
  schemaVersion: number
  kdfSalt: string
  kdfParams: KdfParams
  vaultCheck: string
}

/** Encrypting this constant gives us something to test a password against. */
export const VAULT_CHECK_PLAINTEXT = 'termif-vault-v1'
export const DEVICE_KEY_NAME = 'termif.vaultKey'
/** AAD for the check value; a real credential's AAD is its row id. */
const VAULT_CHECK_AAD = 'vault-check'

const KEY_BYTES = 32
const NONCE_BYTES = 24
const SALT_BYTES = 16

type VaultPlatform = Pick<Platform, 'randomBytes'>

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Holds the derived vault key in memory and nothing else. Google only ever
 * sees the output of `encrypt` (spec §4).
 */
export class Vault {
  #key: Uint8Array | null

  private constructor(key: Uint8Array) {
    this.#key = key
  }

  static async create(
    platform: VaultPlatform,
    password: string,
    params: KdfParams = DEFAULT_KDF_PARAMS,
  ): Promise<{ vault: Vault; meta: VaultMeta }> {
    const salt = platform.randomBytes(SALT_BYTES)
    const key = deriveKey(password, salt, params)
    const vault = new Vault(key)

    const meta: VaultMeta = {
      schemaVersion: SCHEMA_VERSION,
      kdfSalt: toBase64Url(salt),
      kdfParams: params,
      vaultCheck: vault.#seal(VAULT_CHECK_PLAINTEXT, VAULT_CHECK_AAD, platform),
    }
    return { vault, meta }
  }

  static async unlock(
    platform: VaultPlatform,
    meta: VaultMeta,
    password: string,
  ): Promise<Vault> {
    const key = deriveKey(password, fromBase64Url(meta.kdfSalt), meta.kdfParams)
    const candidate = new Vault(key)
    if (!candidate.#checkPasses(meta)) {
      candidate.lock()
      throw new CoreError('vault_wrong_password', 'the master password did not open the vault')
    }
    return candidate
  }

  /**
   * Wraps the key with the platform keystore behind biometrics. Without this,
   * daily use on a phone pushes people toward short passwords, which loses
   * more than it gains (spec §4).
   */
  async rememberOnDevice(store: SecureStore): Promise<void> {
    await store.set(DEVICE_KEY_NAME, this.#requireKey(), true)
  }

  static async unlockFromDevice(
    platform: VaultPlatform & { secureStore: SecureStore },
    meta: VaultMeta,
  ): Promise<Vault | null> {
    const stored = await platform.secureStore.get(DEVICE_KEY_NAME)
    if (stored === null || stored.length !== KEY_BYTES) return null

    const candidate = new Vault(stored)
    // A key left over from a previous master password must not be treated as
    // valid for this vault.
    if (!candidate.#checkPasses(meta)) {
      candidate.lock()
      return null
    }
    return candidate
  }

  static async forgetOnDevice(store: SecureStore): Promise<void> {
    await store.delete(DEVICE_KEY_NAME)
  }

  isLocked(): boolean {
    return this.#key === null
  }

  /** Zeroes the key material rather than only dropping the reference. */
  lock(): void {
    if (this.#key !== null) {
      this.#key.fill(0)
      this.#key = null
    }
  }

  encrypt(plaintext: string, aad: string): string {
    return this.#seal(plaintext, aad, {
      randomBytes: (n) => {
        const b = new Uint8Array(n)
        crypto.getRandomValues(b)
        return b
      },
    })
  }

  decrypt(cipher: string, aad: string): string {
    const key = this.#requireKey()
    const raw = fromBase64Url(cipher)
    if (raw.length <= NONCE_BYTES) {
      throw new CoreError('vault_bad_ciphertext', 'ciphertext is too short to contain a nonce')
    }
    const nonce = raw.subarray(0, NONCE_BYTES)
    const payload = raw.subarray(NONCE_BYTES)

    try {
      const plain = xchacha20poly1305(key, nonce, encoder.encode(aad)).decrypt(payload)
      return decoder.decode(plain)
    } catch {
      // Wrong key, wrong AAD, or tampering — indistinguishable by design.
      throw new CoreError('vault_bad_ciphertext', 'could not decrypt: wrong key or altered data')
    }
  }

  #seal(plaintext: string, aad: string, platform: VaultPlatform): string {
    const key = this.#requireKey()
    const nonce = platform.randomBytes(NONCE_BYTES)
    const sealed = xchacha20poly1305(key, nonce, encoder.encode(aad)).encrypt(
      encoder.encode(plaintext),
    )
    const out = new Uint8Array(nonce.length + sealed.length)
    out.set(nonce, 0)
    out.set(sealed, nonce.length)
    return toBase64Url(out)
  }

  #checkPasses(meta: VaultMeta): boolean {
    try {
      return this.decrypt(meta.vaultCheck, VAULT_CHECK_AAD) === VAULT_CHECK_PLAINTEXT
    } catch {
      return false
    }
  }

  #requireKey(): Uint8Array {
    if (this.#key === null) {
      throw new CoreError('vault_locked', 'the vault is locked')
    }
    return this.#key
  }
}

/**
 * Argon2id, not PBKDF2: a human-chosen master password is weak, and only a
 * memory-hard KDF makes offline guessing expensive (spec §4).
 */
function deriveKey(password: string, salt: Uint8Array, params: KdfParams): Uint8Array {
  return argon2id(encoder.encode(password), salt, {
    m: params.m,
    t: params.t,
    p: params.p,
    dkLen: KEY_BYTES,
  })
}
