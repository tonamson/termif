import type { Store } from '@termif/core'
import { createStore, type Observable } from './useStore.js'

export interface UiPrefs {
  sidebarWidth: number
  collapsedGroups: string[]
  showHidden: boolean
  inspectorOpen: boolean
}

export const PREFS_KEY = 'ui.prefs'

export const DEFAULT_PREFS: UiPrefs = {
  sidebarWidth: 260,
  collapsedGroups: [],
  showHidden: false,
  inspectorOpen: false,
}

export const SIDEBAR_MIN = 200
export const SIDEBAR_MAX = 400

export interface PrefsStore extends Omit<Observable<UiPrefs>, 'set'> {
  load(): Promise<void>
  set<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]): void
  flush(): Promise<void>
  get(): UiPrefs
  subscribe(listener: () => void): () => void
}

const clamp = (value: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, value))

function sanitise(raw: unknown): UiPrefs {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_PREFS }
  const source = raw as Partial<Record<keyof UiPrefs, unknown>>

  return {
    sidebarWidth:
      typeof source.sidebarWidth === 'number'
        ? clamp(source.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX)
        : DEFAULT_PREFS.sidebarWidth,
    collapsedGroups: Array.isArray(source.collapsedGroups)
      ? source.collapsedGroups.filter((g): g is string => typeof g === 'string')
      : [],
    showHidden: source.showHidden === true,
    inspectorOpen: source.inspectorOpen === true,
  }
}

export function createPrefsStore(deps: {
  store: Store
  writeDelayMs?: number
}): PrefsStore {
  const delay = deps.writeDelayMs ?? 250
  const state = createStore<UiPrefs>({ ...DEFAULT_PREFS })

  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: Promise<void> | null = null

  const write = async (): Promise<void> => {
    await deps.store.setMetaValue(PREFS_KEY, JSON.stringify(state.get()))
  }

  return {
    ...state,

    async load(): Promise<void> {
      const raw = await deps.store.getMetaValue(PREFS_KEY)
      if (raw === null) return state.set({ ...DEFAULT_PREFS })
      try {
        state.set(sanitise(JSON.parse(raw)))
      } catch {
        state.set({ ...DEFAULT_PREFS })
      }
    },

    set(key, value): void {
      state.set({ ...state.get(), [key]: value })
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        pending = write()
      }, delay)
    },

    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
        pending = write()
      }
      await pending
      pending = null
    },
  }
}
