import { parseFfiError, type SshBridge, type SshDirEntry } from '@termif/core'
import { createStore, type Observable } from './useStore.js'

/**
 * Remote paths are POSIX no matter what the local OS uses, so these are
 * deliberately not `node:path` — which would produce backslashes on Windows.
 */
export function joinPath(base: string, name: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return `${trimmed}/${name}`
}

export function parentPath(path: string): string {
  const trimmed = path.endsWith('/') && path.length > 1 ? path.slice(0, -1) : path
  const index = trimmed.lastIndexOf('/')
  if (index <= 0) return '/'
  return trimmed.slice(0, index)
}

export interface SftpState {
  path: string
  entries: SshDirEntry[]
  loading: boolean
  error: string | null
}

export interface SftpStore extends Observable<SftpState> {
  open(path: string): Promise<void>
  up(): Promise<void>
  refresh(): Promise<void>
  mkdir(name: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  remove(name: string, recursive: boolean): Promise<void>
}

export function createSftpStore(deps: { ssh: SshBridge; sessionId: bigint }): SftpStore {
  const base = createStore<SftpState>({ path: '.', entries: [], loading: false, error: null })

  const listInto = async (path: string): Promise<void> => {
    base.set((current) => ({ ...current, loading: true }))
    try {
      const entries = await deps.ssh.sftpList(deps.sessionId, path)
      // Directories first, then names. The view depends on this ordering, and
      // the bridge may not guarantee it, so pin it here.
      const sorted = [...entries].sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
      )
      base.set({ path, entries: sorted, loading: false, error: null })
    } catch (e) {
      // Keep the previous listing: emptying the pane the user was working in
      // loses their place for no gain.
      base.set((current) => ({
        ...current,
        loading: false,
        error: parseFfiError(e).message,
      }))
    }
  }

  /** Runs a mutation, then re-lists, surfacing a failure without clearing state. */
  const mutate = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      base.set((current) => ({ ...current, error: null }))
      await listInto(base.get().path)
    } catch (e) {
      base.set((current) => ({ ...current, error: parseFfiError(e).message }))
    }
  }

  return {
    ...base,

    open: listInto,

    async up(): Promise<void> {
      await listInto(parentPath(base.get().path))
    },

    async refresh(): Promise<void> {
      await listInto(base.get().path)
    },

    async mkdir(name): Promise<void> {
      const path = joinPath(base.get().path, name)
      await mutate(() => deps.ssh.sftpMkdir(deps.sessionId, path))
    },

    async rename(from, to): Promise<void> {
      const current = base.get().path
      await mutate(() =>
        deps.ssh.sftpRename(deps.sessionId, joinPath(current, from), joinPath(current, to)),
      )
    },

    async remove(name, recursive): Promise<void> {
      const path = joinPath(base.get().path, name)
      await mutate(() => deps.ssh.sftpRemove(deps.sessionId, path, recursive))
    },
  }
}
