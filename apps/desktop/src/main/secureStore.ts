import { safeStorage } from 'electron'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export interface MainSecureStore {
  get(key: string): Promise<Uint8Array | null>
  set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void>
  delete(key: string): Promise<void>
}

/**
 * `safeStorage` wraps each value with a key held in the OS credential store —
 * the login keychain on macOS, DPAPI on Windows — so the file on disk is
 * useless without the logged-in user's session.
 *
 * Desktop has no biometric gate of its own, so `requireBiometrics` is accepted
 * and ignored here. Core's `SecureStore` interface carries the flag because a
 * mobile shell would honour it (spec §11); accepting and ignoring it keeps one
 * interface rather than two.
 */
export function createSecureStore(filePath: string): MainSecureStore {
  const readAll = (): Record<string, string> => {
    if (!existsSync(filePath)) return {}
    try {
      return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, string>
    } catch {
      // A corrupt file must not brick the app; treat it as empty and let the
      // user re-enter what was stored.
      return {}
    }
  }

  const writeAll = (items: Record<string, string>): void => {
    writeFileSync(filePath, JSON.stringify(items), { mode: 0o600 })
  }

  return {
    async get(key): Promise<Uint8Array | null> {
      const encoded = readAll()[key]
      if (encoded === undefined) return null
      if (!safeStorage.isEncryptionAvailable()) return null

      try {
        const plain = safeStorage.decryptString(Buffer.from(encoded, 'base64'))
        return Uint8Array.from(Buffer.from(plain, 'base64'))
      } catch {
        // Written by a different OS user or a reinstalled keychain.
        return null
      }
    },

    async set(key, value): Promise<void> {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'secure storage is unavailable on this system, so Termif will not store secrets',
        )
      }
      const items = readAll()
      const asBase64 = Buffer.from(value).toString('base64')
      items[key] = safeStorage.encryptString(asBase64).toString('base64')
      writeAll(items)
    },

    async delete(key): Promise<void> {
      const items = readAll()
      delete items[key]
      writeAll(items)
    },
  }
}
