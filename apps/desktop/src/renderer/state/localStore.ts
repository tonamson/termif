import type { SshDirEntry } from '@termif/core'
import { createStore, type Observable } from './useStore.js'
import type { SftpState } from './sftpStore.js'

/**
 * Local paths use whatever separator the OS gave us, so the separator is data
 * rather than a constant — the same renderer runs on both.
 */
export function joinLocal(base: string, name: string, sep: string): string {
  const trimmed = base.endsWith(sep) ? base.slice(0, -sep.length) : base
  return `${trimmed}${sep}${name}`
}

export function parentLocal(path: string, sep: string): string {
  const trimmed = path.length > 1 && path.endsWith(sep) ? path.slice(0, -sep.length) : path
  const index = trimmed.lastIndexOf(sep)
  // Already at a root ('/' or 'C:\'): stay there rather than yield a bare drive.
  if (index < 0) return path
  if (index === 0) return sep
  const parent = trimmed.slice(0, index)
  return parent.endsWith(':') ? parent + sep : parent
}

export interface LocalStore extends Observable<SftpState> {
  open(path: string): Promise<void>
  up(): Promise<void>
  refresh(): Promise<void>
}

export function createLocalStore(deps: {
  list(path: string): Promise<SshDirEntry[]>
  sep: string
}): LocalStore {
  const base = createStore<SftpState>({ path: '', entries: [], loading: false, error: null })

  const listInto = async (path: string): Promise<void> => {
    base.set((current) => ({ ...current, loading: true }))
    try {
      const entries = await deps.list(path)
      const sorted = [...entries].sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
      )
      base.set({ path, entries: sorted, loading: false, error: null })
    } catch (e) {
      // Same rule as the remote pane: a failed listing must not wipe the one
      // the user was working in.
      base.set((current) => ({
        ...current,
        loading: false,
        error: e instanceof Error ? e.message : String(e),
      }))
    }
  }

  return {
    ...base,
    open: listInto,
    async up(): Promise<void> {
      await listInto(parentLocal(base.get().path, deps.sep))
    },
    async refresh(): Promise<void> {
      await listInto(base.get().path)
    },
  }
}
