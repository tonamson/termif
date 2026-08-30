import { newId, type Host, type HostInput, type StoredCredential, type Store } from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export interface SecretInput {
  kind: 'password' | 'key'
  label: string
  secret: string
}

export interface HostState {
  hosts: Host[]
  credentials: StoredCredential[]
  query: string
  loading: boolean
}

/** `authRef` optional: a brand-new host without a credential has none yet. */
export type SaveHostInput = Omit<HostInput, 'authRef'> & { authRef?: string | null }

export interface HostStore extends Observable<HostState> {
  refresh(): Promise<void>
  setQuery(query: string): void
  visibleHosts(): Host[]
  save(input: SaveHostInput, secret: SecretInput | null): Promise<Host>
  remove(id: string): Promise<void>
}

export interface HostStoreDeps {
  store: Store
}

export function createHostStore(deps: HostStoreDeps): HostStore {
  const base = createStore<HostState>({
    hosts: [],
    credentials: [],
    query: '',
    loading: true,
  })

  const reload = async (): Promise<void> => {
    const [hosts, credentials] = await Promise.all([
      deps.store.listHosts(),
      deps.store.listCredentials(),
    ])
    base.set((current) => ({ ...current, hosts, credentials, loading: false }))
  }

  return {
    ...base,

    refresh: reload,

    setQuery(query): void {
      base.set((current) => ({ ...current, query }))
    },

    visibleHosts(): Host[] {
      const { hosts, query } = base.get()
      const needle = query.trim().toLowerCase()
      if (needle.length === 0) return hosts

      return hosts.filter((host) =>
        [host.label, host.hostname, host.username, ...host.tags]
          .join(' ')
          .toLowerCase()
          .includes(needle),
      )
    },

    async save(input, secret): Promise<Host> {
      let authRef = input.authRef ?? null

      if (secret !== null) {
        const id = authRef ?? newId()
        const credential = await deps.store.upsertCredential({
          id,
          label: secret.label,
          kind: secret.kind,
          secret: secret.secret,
        })
        authRef = credential.id
      }

      const host = await deps.store.upsertHost({ ...input, authRef })
      await reload()
      return host
    },

    async remove(id): Promise<void> {
      const host = await deps.store.getHost(id)
      await deps.store.deleteHost(id)

      // A credential exists to serve its host; leaving it behind would
      // accumulate secrets nothing references.
      if (host?.authRef != null) await deps.store.deleteCredential(host.authRef)

      await reload()
    },
  }
}
