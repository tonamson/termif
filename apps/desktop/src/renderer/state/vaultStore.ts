import {
  CoreError,
  DEFAULT_KDF_PARAMS,
  Vault,
  metaToRows,
  rowsToMeta,
  t,
  type KdfParams,
  type Platform,
  type Store,
  type VaultMeta,
} from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export type VaultPhase = 'loading' | 'needsSetup' | 'locked' | 'unlocked'

export interface VaultState {
  phase: VaultPhase
  error: string | null
}

export interface VaultStore extends Observable<VaultState> {
  boot(): Promise<void>
  setup(password: string, remember: boolean): Promise<void>
  unlock(password: string, remember: boolean): Promise<void>
  tryDeviceUnlock(): Promise<boolean>
  lock(): void
  vault(): Vault | null
  meta(): VaultMeta | null
}

export interface VaultStoreDeps {
  platform: Platform
  store: Store
  kdfParams?: KdfParams
}

/** Where the serialised vault meta lives in the local store's meta table. */
const META_KEY = 'vaultMeta'

/**
 * Owns the vault's lifecycle in the renderer. The key exists only here, in
 * memory; the main process sees the wrapped bytes and never a plaintext
 * credential (spec §4).
 */
export function createVaultStore(deps: VaultStoreDeps): VaultStore {
  const base = createStore<VaultState>({ phase: 'loading', error: null })
  const params = deps.kdfParams ?? DEFAULT_KDF_PARAMS

  let vault: Vault | null = null
  let meta: VaultMeta | null = null

  const loadMeta = async (): Promise<VaultMeta | null> => {
    const raw = await deps.store.getMetaValue(META_KEY)
    if (raw === null) return null
    try {
      // Stored in the same key/value shape the sheet's meta tab uses, so the
      // two never need separate serialisers.
      return rowsToMeta(JSON.parse(raw) as string[][])
    } catch {
      return null
    }
  }

  const saveMeta = async (value: VaultMeta): Promise<void> => {
    await deps.store.setMetaValue(META_KEY, JSON.stringify(metaToRows(value)))
  }

  const describe = (e: unknown): string =>
    e instanceof CoreError && e.code === 'vault_wrong_password'
      ? t('vault.unlock.wrong')
      : t('error.unknown', { reason: e instanceof Error ? e.message : String(e) })

  return {
    ...base,

    vault: () => vault,
    meta: () => meta,

    async boot(): Promise<void> {
      meta = await loadMeta()
      base.set({ phase: meta === null ? 'needsSetup' : 'locked', error: null })
    },

    async setup(password, remember): Promise<void> {
      const created = await Vault.create(deps.platform, password, params)
      vault = created.vault
      meta = created.meta
      await saveMeta(created.meta)

      if (remember) await created.vault.rememberOnDevice(deps.platform.secureStore)
      base.set({ phase: 'unlocked', error: null })
    },

    async unlock(password, remember): Promise<void> {
      if (meta === null) {
        base.set({ phase: 'needsSetup', error: null })
        return
      }

      try {
        const opened = await Vault.unlock(deps.platform, meta, password)
        vault = opened
        if (remember) await opened.rememberOnDevice(deps.platform.secureStore)
        base.set({ phase: 'unlocked', error: null })
      } catch (e) {
        vault = null
        base.set({ phase: 'locked', error: describe(e) })
      }
    },

    async tryDeviceUnlock(): Promise<boolean> {
      if (meta === null) return false

      const opened = await Vault.unlockFromDevice(deps.platform, meta)
      if (opened === null) return false

      vault = opened
      base.set({ phase: 'unlocked', error: null })
      return true
    },

    lock(): void {
      vault?.lock()
      vault = null
      base.set({ phase: 'locked', error: null })
    },
  }
}
