import type { SecureStore } from '../../src/platform.js'

export class FakeSecureStore implements SecureStore {
  private readonly items = new Map<string, Uint8Array>()
  readonly biometricKeys = new Set<string>()

  async get(key: string): Promise<Uint8Array | null> {
    const value = this.items.get(key)
    return value === undefined ? null : new Uint8Array(value)
  }

  async set(key: string, value: Uint8Array, requireBiometrics: boolean): Promise<void> {
    this.items.set(key, new Uint8Array(value))
    if (requireBiometrics) this.biometricKeys.add(key)
    else this.biometricKeys.delete(key)
  }

  async delete(key: string): Promise<void> {
    this.items.delete(key)
    this.biometricKeys.delete(key)
  }
}
